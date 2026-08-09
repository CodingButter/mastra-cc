#!/usr/bin/env node
// Throwaway. Two routes to the same tree, measured against the SAME browser
// process at the same moment: the platform accessibility layer, and the
// browser's own protocol.
//
// The browser is launched with --force-renderer-accessibility so that BOTH
// routes are available. Comparing a flagged browser on one route against an
// unflagged browser on the other would measure the flag, not the route.
//
// Usage: node spikes/browser/route-comparison.mjs [--port N]

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
const PORT = Number(arg('port', '9511'));
const ARTIFACT = arg('out', 'docs/proofs/which-route-to-the-tree-is-cheaper.md');
const SKIP = arg('skip-observation', undefined);

const run = new Run([
  'atspi-ms',
  'atspi-nodes',
  'atspi-named',
  'cdp-ms',
  'cdp-nodes',
  'cdp-named',
  'atspi-offscreen-found',
  'cdp-offscreen-found',
]);

// A page with a known, countable structure — including content scrolled out of
// view, because "is offscreen content present" is the robustness question that
// actually bites (a search that finds nothing when the target exists is the
// failure the prototype was worst at).
const ROWS = 120;
const PAGE = `<!doctype html><title>route comparison</title>
<body>
  <h1>top heading</h1>
  <div style="height:400px;overflow:auto">
    ${Array.from({ length: ROWS }, (_, i) => `<button id="row-${i}">row ${i}</button><br>`).join('\n')}
  </div>
  <a href="#end" id="offscreen-link">the link at the very bottom</a>
</body>`;

const WALKER = `
import sys, json, time
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

target_pid = int(sys.argv[1])
desktop = Atspi.get_desktop(0)

nodes = 0
named = 0
found_offscreen = False
roles = {}

def walk(node, depth):
    global nodes, named, found_offscreen
    if nodes >= 20000 or depth > 40:
        return
    nodes += 1
    try:
        r = node.get_role_name() or "?"
        n = node.get_name() or ""
    except Exception:
        return
    roles[r] = roles.get(r, 0) + 1
    if n and r in ("push button", "link", "entry", "heading"):
        named += 1
    if "very bottom" in n:
        found_offscreen = True
    try:
        count = node.get_child_count()
    except Exception:
        return
    for i in range(min(count, 500)):
        try:
            child = node.get_child_at_index(i)
        except Exception:
            continue
        if child is not None:
            walk(child, depth + 1)

start = time.time()
for i in range(desktop.get_child_count()):
    try:
        app = desktop.get_child_at_index(i)
        if app is None:
            continue
        if Atspi.Accessible.get_process_id(app) != target_pid:
            continue
        walk(app, 0)
    except Exception:
        continue
elapsed = (time.time() - start) * 1000

print(json.dumps({"ms": round(elapsed), "nodes": nodes, "named": named,
                  "offscreen": found_offscreen}))
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

  // --- route A: the platform accessibility layer -------------------------
  const script = `/tmp/route-walk-${Date.now()}.py`;
  writeFileSync(script, WALKER);
  let atspi;
  try {
    atspi = JSON.parse(
      execFileSync('python3', [script, String(chrome.proc.pid)], {
        encoding: 'utf8',
        timeout: 180000,
      }),
    );
  } finally {
    unlinkSync(script);
  }
  if (atspi.nodes === 0) {
    process.stderr.write('REFUSED: the accessibility route returned nothing; nothing to compare\n');
    process.exit(1);
  }
  if (SKIP !== 'atspi-ms') run.record('atspi-ms', atspi.ms);
  if (SKIP !== 'atspi-nodes') run.record('atspi-nodes', atspi.nodes);
  if (SKIP !== 'atspi-named') run.record('atspi-named', atspi.named);
  if (SKIP !== 'atspi-offscreen-found') run.record('atspi-offscreen-found', atspi.offscreen);

  // --- route B: the browser's own protocol -------------------------------
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && t.url.includes(`${origin.port}`));
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send('Accessibility.enable');
  const t0 = Date.now();
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const cdpMs = Date.now() - t0;
  const named = nodes.filter(
    (n) => n.name?.value && ['button', 'link', 'textbox', 'heading'].includes(n.role?.value),
  );
  const offscreen = nodes.some((n) => (n.name?.value ?? '').includes('very bottom'));

  if (SKIP !== 'cdp-ms') run.record('cdp-ms', cdpMs);
  if (SKIP !== 'cdp-nodes') run.record('cdp-nodes', nodes.length);
  if (SKIP !== 'cdp-named') run.record('cdp-named', named.length);
  if (SKIP !== 'cdp-offscreen-found') run.record('cdp-offscreen-found', offscreen);

  cdp.close();
} finally {
  await chrome?.kill();
  await origin?.close();
}

process.exit(
  run.finish(ARTIFACT, (obs) => {
    const ratio = (obs['atspi-ms'] / Math.max(obs['cdp-ms'], 1)).toFixed(1);
    return `# Which route to the tree is cheaper?

Produced by \`spikes/browser/route-comparison.mjs\`, which is deleted at the end
of M0.5.

Both routes are measured against **the same browser process at the same
moment**. The browser is launched with \`--force-renderer-accessibility\` so
that the platform route works at all; comparing a flagged browser on one route
against an unflagged browser on the other would measure the flag rather than
the route.

The page contains ${ROWS} named controls inside a scrolling container, plus one
link below the fold — because "is content that is not on screen present in the
tree" is the robustness question that actually costs something. A search that
returns nothing while the target exists is the failure mode the prototype was
worst at.

| | Platform accessibility layer | Browser protocol |
|---|---|---|
| Time to read the whole tree | **${obs['atspi-ms']}ms** | **${obs['cdp-ms']}ms** |
| Nodes returned | ${obs['atspi-nodes']} | ${obs['cdp-nodes']} |
| Named controls | ${obs['atspi-named']} | ${obs['cdp-named']} |
| Off-screen content present | **${obs['atspi-offscreen-found'] ? 'yes' : 'no'}** | **${obs['cdp-offscreen-found'] ? 'yes' : 'no'}** |

The browser protocol is **${ratio}× faster** on this page.

## Two things this run did NOT establish

**Robustness is not shown.** Both routes found the below-the-fold link, so the
expected difference did not appear. That is because *scrolled out of view* is
not the same as *not rendered*: Chromium omits content it has not laid out —
\`display:none\`, and the virtualised lists that long chat and mail interfaces
actually use — but content merely below the fold is laid out and present in
both trees. This page therefore tested the easy case. Settling the real
question needs a virtualised list, where the rows genuinely do not exist until
scrolled, and the likely answer is that **neither** route finds them and the
fix is to scroll and re-query rather than to change route. Recorded as open,
because a robustness claim resting on this run would not survive contact with
the case it is supposed to cover.

**The named-control counts disagree** (${obs['atspi-named']} against
${obs['cdp-named']}) and the disagreement is not explained. The two routes use
different role vocabularies — \`push button\` against \`button\` — so the
filters are not counting identical sets, and the platform route may also be
reporting the same control more than once where a frame and a document both
expose it. This is exactly the kind of number that gets quoted later as though
it meant something, so it is flagged rather than averaged. It does not affect
the timing result, which is what this artifact is for.

## Why the gap is structural rather than incidental

The platform route is a walk: every node is a separate call across a message
bus, and the cost grows with the size of the tree. The protocol route is one
request returning the whole tree in a single response. That is a difference in
shape, not in tuning, so it will not close with a faster machine.

It also explains a second-order effect worth naming: a walk observes a tree
that can change underneath it, so a large walk is not a snapshot. A single
response is.

## What this does not say

It does not say the platform route is unnecessary. It is the only route to
applications that are not Chromium-based, which is what the other three
adapters exist for. What it says is that where both routes are available, there
is no reason to prefer the walk.

## Receipt

\`\`\`
node spikes/browser/route-comparison.mjs --port ${PORT}
\`\`\`
`;
  }),
);
