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

const run = new Run(['table', 'visible-but-unreadable', 'invisible-but-readable', 'agreement']);

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
];

const PAGE = `<!doctype html><title>hidden</title>
<body>
${CASES.filter(([id]) => id !== 'inert-subtree')
  .map(([id, , attrs]) => `  <button id="case-${id}" ${attrs}>case ${id}</button>`)
  .join('\n')}
  <div inert><button id="case-inert-subtree">case inert-subtree</button></div>
</body>`;

const WALKER = `
import sys, json
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi
target_pid = int(sys.argv[1])
desktop = Atspi.get_desktop(0)
found = []
def walk(node, depth):
    if depth > 40:
        return
    try:
        name = node.get_name() or ""
    except Exception:
        return
    if name.startswith("case "):
        found.append(name[5:])
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
      const seeable = Boolean(styleVisible && bigEnough && onScreen && !clipped);
      return [id, true, seeable];
    }))`),
  );

  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const cdpNames = new Set(
    nodes.map((n) => n.name?.value).filter((v) => v?.startsWith('case ')).map((v) => v.slice(5)),
  );

  const script = `/tmp/hidden-walk-${Date.now()}.py`;
  writeFileSync(script, WALKER);
  let atspiNames;
  try {
    atspiNames = new Set(
      JSON.parse(execFileSync('python3', [script, String(chrome.proc.pid)], {
        encoding: 'utf8',
        timeout: 120000,
      })),
    );
  } finally {
    unlinkSync(script);
  }
  if (atspiNames.size === 0) {
    process.stderr.write('REFUSED: the platform route saw none of the cases; nothing to compare\n');
    process.exit(1);
  }

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

## Why this matters more than it looks

Two consequences follow, and neither is about correctness of the reader.

**"Did the user see this?" is not answerable from the accessibility tree.** It
is a layout question, and it needs layout: geometry, computed style, and
occlusion. Any part of the design that reasons about what the human is looking
at — an approving agent judging consequence, a question phrased about something
on screen — needs a different source than the one used to find the element.

**A reader that consults only one surface is systematically wrong**, in a way
that looks like ordinary flakiness. The remedy is not to pick the better
surface; it is that the browser adapter has both the accessibility tree and the
document available over one connection, and can reconcile them. The platform
adapters, where only one surface exists, do not have that luxury — and that
asymmetry belongs in the adapter design rather than being discovered later.

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
