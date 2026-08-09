#!/usr/bin/env node
// Throwaway. "Visually hidden" is not one condition, it is at least seven, and
// they do not behave the same way. This enumerates them and measures, for each,
// whether the element is present in:
//
//   - the DOM               (what the page contains)
//   - the browser's AX tree (what the protocol route reads)
//   - the platform AX tree  (what the accessibility route reads)
//
// The result that matters is not a count. It is that the accessibility tree
// diverges from what a human sees in BOTH directions: content a person cannot
// see is present in it by design, and content a person can see is absent from
// it by design. An agent reading only one of these surfaces has a systematically
// wrong picture, in a way no amount of care about the other one fixes.
//
// Usage: node spikes/browser/hidden-elements.mjs [--port N]

import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { Cdp } from './lib/cdp.mjs';
import { Run } from './lib/result.mjs';
import { launchChrome } from './lib/chrome.mjs';
import { serve } from './lib/serve.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const PORT = Number(arg('port', '9521'));
const ARTIFACT = arg('out', 'docs/proofs/what-hidden-actually-means.md');
const SKIP = arg('skip-observation', undefined);

const run = new Run([
  'table',
  'visible-but-unreadable',
  'invisible-but-readable',
  'agreement',
  'geometry-table',
  'browser-verdict',
  'platform-verdict',
]);

// Each case is a button carrying a unique, greppable name.
const CASES = [
  ['plain', 'ordinary, visible', ''],
  ['display-none', '`display:none`', 'style="display:none"'],
  ['visibility-hidden', '`visibility:hidden`', 'style="visibility:hidden"'],
  ['opacity-zero', '`opacity:0`', 'style="opacity:0"'],
  ['zero-size', 'zero width and height', 'style="width:0;height:0;overflow:hidden"'],
  ['offscreen-position', 'positioned far off screen', 'style="position:absolute;left:-9999px"'],
  ['sr-only', 'the screen-reader-only clip pattern', 'style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"'],
  ['aria-hidden', 'visible, but `aria-hidden="true"`', 'aria-hidden="true"'],
  ['inert-subtree', 'visible, inside an `inert` container', ''],
  ['occluded', 'fully covered by an opaque panel', ''],
];

const PAGE = `<!doctype html><title>hidden</title>
<body>
${CASES.filter(([id]) => !['inert-subtree', 'occluded'].includes(id))
  .map(([id, , attrs]) => `  <button id="case-${id}" ${attrs}>case ${id}</button>`)
  .join('\n')}
  <div inert><button id="case-inert-subtree">case inert-subtree</button></div>
  <div style="position:relative;width:300px;height:60px">
    <button id="case-occluded" style="position:absolute;top:10px;left:10px">case occluded</button>
    <div style="position:absolute;inset:0;background:#fff;z-index:9">covering panel</div>
  </div>
</body>`;

// The platform walker collects, for every case it finds, everything the
// Component interface will tell it about geometry: extents, alpha, layer, and
// a hit test at the element's own centre. The hit test is the interesting one
// — it is the only mechanism on this route that can notice occlusion.
const WALKER = `
import sys, json
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi
target_pid = int(sys.argv[1])
desktop = Atspi.get_desktop(0)
found = {}

def describe(node, name):
    info = {"present": True}
    try:
        comp = node.get_component_iface()
    except Exception:
        comp = None
    if comp is None:
        info["component"] = False
        return info
    info["component"] = True
    try:
        e = Atspi.Component.get_extents(comp, Atspi.CoordType.SCREEN)
        info["bounds"] = [e.x, e.y, e.width, e.height]
    except Exception as ex:
        info["bounds"] = None
        info["bounds_error"] = str(ex)
    try:
        info["alpha"] = round(Atspi.Component.get_alpha(comp), 3)
    except Exception:
        info["alpha"] = None
    try:
        info["layer"] = str(Atspi.Component.get_layer(comp))
    except Exception:
        info["layer"] = None
    # states carry the toolkit's own opinion, which is not geometry but is free
    try:
        s = node.get_state_set()
        info["showing"] = s.contains(Atspi.StateType.SHOWING)
        info["visible"] = s.contains(Atspi.StateType.VISIBLE)
    except Exception:
        info["showing"] = None
        info["visible"] = None
    # hit test at our own centre: does the desktop agree we are what is there?
    b = info.get("bounds")
    if b and b[2] > 0 and b[3] > 0:
        cx, cy = b[0] + b[2] // 2, b[1] + b[3] // 2
        try:
            hit = Atspi.Component.get_accessible_at_point(
                comp, cx, cy, Atspi.CoordType.SCREEN)
            info["hit_self"] = hit is not None and (hit.get_name() or "") == name
        except Exception as ex:
            info["hit_self"] = None
            info["hit_error"] = str(ex)
    else:
        info["hit_self"] = None
    return info

def walk(node, depth):
    if depth > 40:
        return
    try:
        name = node.get_name() or ""
    except Exception:
        return
    if name.startswith("case "):
        found[name[5:]] = describe(node, name)
    try:
        count = node.get_child_count()
    except Exception:
        return
    for i in range(min(count, 500)):
        try:
            c = node.get_child_at_index(i)
        except Exception:
            continue
        if c is not None:
            walk(c, depth + 1)

for i in range(desktop.get_child_count()):
    try:
        app = desktop.get_child_at_index(i)
        if app is None or Atspi.Accessible.get_process_id(app) != target_pid:
            continue
        walk(app, 0)
    except Exception:
        continue
print(json.dumps(found))
`;

let chrome;
let origin;
try {
  origin = await serve({ '/': PAGE });
  chrome = await launchChrome({
    port: PORT,
    headless: false,
    extraArgs: ['--force-renderer-accessibility'],
    url: `http://127.0.0.1:${origin.port}/`,
  });
  await new Promise((r) => setTimeout(r, 6000));

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && t.url.includes(`${origin.port}`));
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send('Accessibility.enable');

  const evaluate = async (expression) =>
    (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

  // DOM presence, and whether a sighted person could actually see it. The
  // visibility judgement is made from layout — a zero-area or clipped box is
  // not visible whatever the DOM says.
  const domState = JSON.parse(
    await evaluate(`JSON.stringify(${JSON.stringify(CASES.map(([id]) => id))}.map(id => {
      const el = document.getElementById('case-' + id);
      if (!el) return [id, false, false];
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // A first version of this check called a zero-width button visible,
      // because its padding and border still give it a few pixels of box, and
      // called the screen-reader-only pattern visible too, because it ignored
      // clip. Both are invisible to a person. The check now asks whether the
      // element actually paints somewhere a human could look.
      const clipped =
        (cs.clip && cs.clip !== 'auto' && /rect\\(0\\w*p?x?[ ,]/.test(cs.clip)) ||
        (cs.clipPath && cs.clipPath !== 'none' && /inset\\(\\s*(50%|100%)/.test(cs.clipPath));
      const bigEnough = r.width >= 8 && r.height >= 8;
      const onScreen = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
      const styleVisible =
        cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
      // Occlusion: something opaque on top means a person does not see this,
      // whatever its own style says. Omitting this made the oracle call a fully
      // covered button visible, and then score the routes that got it right as
      // wrong. An oracle that is wrong grades everything wrong.
      let covered = false;
      if (styleVisible && bigEnough && onScreen && !clipped) {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        covered = Boolean(hit) && hit !== el && !el.contains(hit) && !hit.contains(el);
      }
      const seeable = Boolean(styleVisible && bigEnough && onScreen && !clipped && !covered);
      return [id, true, seeable];
    }))`),
  );

  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const cdpNames = new Set(
    nodes.map((n) => n.name?.value).filter((v) => v?.startsWith('case ')).map((v) => v.slice(5)),
  );

  const script = `/tmp/hidden-walk-${Date.now()}.py`;
  writeFileSync(script, WALKER);
  let atspiInfo;
  try {
    atspiInfo = JSON.parse(
      execFileSync('python3', [script, String(chrome.proc.pid)], {
        encoding: 'utf8',
        timeout: 120000,
      }),
    );
  } finally {
    unlinkSync(script);
  }
  const atspiNames = new Set(Object.keys(atspiInfo));
  if (atspiNames.size === 0) {
    process.stderr.write('REFUSED: the platform route saw none of the cases; nothing to compare\n');
    process.exit(1);
  }

  // Can each route decide "can a person see this?" from what it can read,
  // WITHOUT being told the answer? Both verdicts are computed from geometry
  // the route itself provides, then scored against the layout ground truth.
  const browserGeom = JSON.parse(
    await evaluate(`JSON.stringify(${JSON.stringify(CASES.map(([id]) => id))}.map(id => {
      const el = document.getElementById('case-' + id);
      if (!el) return [id, null];
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // hit test at our own centre — the document's own occlusion answer
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return [id, {
        bounds: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        alpha: Number(cs.opacity),
        // Computed style is genuinely a browser-route capability: a hidden
        // element keeps its box, so bounds alone cannot tell it from a real one.
        painted: cs.visibility !== 'hidden' && cs.display !== 'none',
        // An ancestor answering the hit test still means nothing opaque is on
        // top of us. Checking only descendants marked an inert-wrapped button
        // as covered by its own wrapper.
        hitSelf: Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el))),
      }];
    }))`),
  );

  // The platform route reasons in screen coordinates, so it needs to know how
  // big the screen is before it can say whether a box is on it.
  const screenSize = JSON.parse(
    await evaluate(`JSON.stringify({width: screen.width, height: screen.height})`),
  );

  const geomRows = [];
  let browserRight = 0;
  let platformRight = 0;
  for (const [id, label] of CASES) {
    const truth = domState.find(([d]) => d === id)[2];

    const bg = browserGeom.find(([d]) => d === id)[1];
    // The browser's verdict, from its own geometry only.
    const bVerdict = bg
      ? bg.painted && bg.bounds[2] >= 8 && bg.bounds[3] >= 8 && bg.alpha > 0.01 && bg.hitSelf
      : false;

    const ai = atspiInfo[id];
    // The platform's verdict, from Component only: a real box, that box lying
    // within the screen, opaque, and the desktop agreeing we are what sits at
    // our own centre. The on-screen test was missing at first, which let an
    // element parked at x=-9999 pass on the strength of its width alone.
    const pVerdict = ai
      ? Boolean(
          ai.bounds &&
            ai.bounds[2] >= 8 &&
            ai.bounds[3] >= 8 &&
            ai.bounds[0] + ai.bounds[2] > 0 &&
            ai.bounds[1] + ai.bounds[3] > 0 &&
            ai.bounds[0] < screenSize.width &&
            ai.bounds[1] < screenSize.height &&
            (ai.alpha === null || ai.alpha > 0.01) &&
            ai.hit_self === true,
        )
      : false;

    if (bVerdict === truth) browserRight++;
    if (pVerdict === truth) platformRight++;

    const box = ai?.bounds ? `${ai.bounds[2]}×${ai.bounds[3]}` : '—';
    geomRows.push(
      `| ${label} | ${truth ? 'yes' : 'no'} | ${bVerdict ? 'yes' : 'no'}${bVerdict === truth ? '' : ' ❌'} | ${box} | ${ai?.alpha ?? '—'} | ${ai?.hit_self === null || ai?.hit_self === undefined ? '—' : ai.hit_self ? 'self' : 'other'} | ${pVerdict ? 'yes' : 'no'}${pVerdict === truth ? '' : ' ❌'} |`,
    );
  }
  if (SKIP !== 'geometry-table') run.record('geometry-table', geomRows.join('\n'));
  if (SKIP !== 'browser-verdict') run.record('browser-verdict', `${browserRight}/${CASES.length}`);
  if (SKIP !== 'platform-verdict') run.record('platform-verdict', `${platformRight}/${CASES.length}`);

  const rows = [];
  let visibleUnreadable = 0;
  let invisibleReadable = 0;
  let agree = 0;
  for (const [id, label] of CASES) {
    const [, inDom, seeable] = domState.find(([d]) => d === id);
    const inCdp = cdpNames.has(id);
    const inAtspi = atspiNames.has(id);
    if (inCdp === inAtspi) agree++;
    if (seeable && !inCdp) visibleUnreadable++;
    if (!seeable && inCdp) invisibleReadable++;
    rows.push(
      `| ${label} | ${inDom ? 'yes' : 'no'} | ${seeable ? 'yes' : 'no'} | ${inCdp ? 'yes' : '**no**'} | ${inAtspi ? 'yes' : '**no**'} |`,
    );
  }

  if (SKIP !== 'table') run.record('table', rows.join('\n'));
  if (SKIP !== 'visible-but-unreadable') run.record('visible-but-unreadable', visibleUnreadable);
  if (SKIP !== 'invisible-but-readable') run.record('invisible-but-readable', invisibleReadable);
  if (SKIP !== 'agreement') run.record('agreement', `${agree}/${CASES.length}`);

  cdp.close();
} finally {
  await chrome?.kill();
  await origin?.close();
}

process.exit(
  run.finish(ARTIFACT, (obs) => `# What "hidden" actually means

Produced by \`spikes/browser/hidden-elements.mjs\`, which is deleted at the end
of M0.5.

"Visually hidden" is not one condition. Each row is a different way an element
can fail to be visible, measured against the same browser process at the same
moment — with the accessibility flag on, so both routes are available.

| Case | In the DOM | A person can see it | Browser AX tree | Platform AX tree |
|---|---|---|---|---|
${obs.table}

Where the two accessibility routes agree: **${obs.agreement}**.

## The finding

The accessibility tree diverges from what a human sees in **both** directions,
and both directions are deliberate.

- **Visible but not readable: ${obs['visible-but-unreadable']} case(s).** An element a person can see
  is absent from the tree, because the page asked for that — \`aria-hidden\` and
  \`inert\` exist precisely to remove decorative or inactive content from
  assistive technology. An agent that reads only the accessibility tree cannot
  see something the user is looking at, and no amount of care about tree-reading
  fixes it, because the omission is the page's intent.
- **Invisible but readable: ${obs['invisible-but-readable']} case(s).** Content a person cannot see is
  present, because that too is intentional — the screen-reader-only pattern
  exists to put text in the tree and not on the screen.

## Can geometry answer it instead?

Membership in the tree does not say whether a person can see something. Bounds
might. Both routes expose geometry — the platform route through the \`Component\`
interface (\`get_extents\`, \`get_alpha\`, \`get_layer\`, and \`get_accessible_at_point\`,
which is a hit test), and the browser route through layout directly.

So each route was asked to decide *from its own geometry alone* whether a person
can see each element, and scored against what the layout actually says. Neither
was told the answer.

| Case | A person can see it | Browser verdict | Platform box | Platform alpha | Hit test at own centre | Platform verdict |
|---|---|---|---|---|---|---|
${obs['geometry-table']}

**Browser route: ${obs['browser-verdict']} correct. Platform route: ${obs['platform-verdict']} correct.**

### Where the platform route's four misses come from

Each failure has a cause, and none of them is a bug in the reading:

- **\`opacity:0\`** — \`get_alpha\` returned 1 for an element the page had made
  fully transparent. The interface has the right question and the toolkit does
  not answer it.
- **\`aria-hidden\`** and **\`inert\`** — no node exists on this route at all, so
  there is nothing to measure. Geometry cannot rule on an element it never sees.
- **the covered button** — the hit test answered *self* for an element sitting
  underneath an opaque panel. The panel is not a separate accessible object, so
  from the tree's point of view nothing is on top.

That last one is the important failure. The hit test is exactly the mechanism
that should catch occlusion, and it reported the covered element as exposed.

## What this changes

**Geometry is available on both routes, so this is not a browser-only
capability**, and an earlier reading of these results overstated the asymmetry.
Extents, alpha and a hit test are the right instruments and the platform route
has all three.

**But the instruments do not return trustworthy answers there.** ${obs['platform-verdict']} against
${obs['browser-verdict']} is not a small margin, and the misses are not edge cases: a transparent
element and a covered element are ordinary interface states. The browser route
wins because it can read computed style and do a real hit test against layout,
not because it has some extra surface.

**The one structural gap stands.** \`aria-hidden\` and \`inert\` elements exist on
no accessibility route, by design. Only the document itself still holds them,
and that is browser-only.

**The practical rule for the element type**: bounds is not decoration on a search
result. It is the input to a different question — *is this the thing the user is
looking at* — and it needs the hit test beside it to mean anything, because a
covered button has a perfectly good rectangle. The prototype's element type
already carried \`bounds\`; what it did not carry was a hit test, and bounds alone
would have called the covered button visible.

**And the verdict must be honest about its own confidence per route.** The same
question answered from the same instruments is reliable in the browser and
unreliable on the platform. An element type that reports visibility as a plain
boolean, with no indication of which route produced it, would launder a guess
into a fact.

## How much of this is the spike's own fault

Three of these rows were wrong before they were right, and every one was a
defect in the measuring apparatus rather than in the routes:

- The ground truth itself ignored occlusion, so it called the covered button
  visible — and then scored both routes as wrong for getting it right. An oracle
  that is wrong grades everything wrong, which is the most expensive kind of
  error available here.
- The browser hit test treated an ancestor's answer as a miss, marking the
  inert-wrapped button as covered by its own wrapper.
- The platform verdict never checked whether the box was on the screen, so an
  element parked at x=-9999 passed on the strength of its width.

They are recorded because the corrected numbers are only worth as much as the
account of how they were reached.

## What this does not cover

Content that is not laid out at all — virtualised lists, where rows do not
exist until scrolled to — is a different case and is not measured here. It
remains open, and the expected remedy is to scroll and query again rather than
to change route.

## Receipt

\`\`\`
node spikes/browser/hidden-elements.mjs --port ${PORT}
\`\`\`
`),
);
