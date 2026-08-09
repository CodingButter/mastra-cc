#!/usr/bin/env node
// Throwaway. Answers Q01's other half and the CDP questions:
//
//   1. Does the browser expose a debugging endpoint we can drive?
//   2. Does Target.setAutoAttach {flatten:true} surface pages, workers and
//      service workers automatically?
//   3. Does Page.addScriptToEvaluateOnNewDocument really run BEFORE page
//      script? (Asserted positively — page script reads a value only the init
//      script could have set. The planning probe used a data: URL whose inline
//      script Chrome blocked, so it proved nothing.)
//   4. Do out-of-process iframes require re-arming setAutoAttach per attached
//      session, or does the browser-level arm reach them?
//
// Usage: node spikes/browser/cdp-substrate.mjs [--profile-dir DIR] [--port N]

import { Cdp } from './lib/cdp.mjs';
import { Run } from './lib/result.mjs';
import { launchChrome } from './lib/chrome.mjs';
import { serve } from './lib/serve.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const PORT = Number(arg('port', '9411'));
const PROFILE = arg('profile-dir', undefined);
const ARTIFACT = arg('out', 'docs/proofs/what-the-browser-protocol-gives-us.md');
// Deliberate-failure switch for refusal-check.sh: skip an observation on purpose.
const SKIP = arg('skip-observation', undefined);

const run = new Run([
  'endpoint',
  'auto-attached-types',
  'init-script-before-page-script',
  'oopif-without-rearm',
  'oopif-after-rearm',
]);

// A parent page on one site embedding a child on a DIFFERENT site. Different
// ports on one host are the same site to Chrome, so two fake hostnames are
// mapped onto this one server with --host-resolver-rules.
const PAGE_SCRIPT_PROBE = `
  <script>
    // Runs at document start, as page script. If the init script really ran
    // first, this global is already set. Nothing else can have set it.
    window.__pageSawInitMarker = (window.__initMarker === 'installed-by-cdp');
    window.__pageScriptRanAt = Date.now();
  </script>`;

let chrome;
let origin;
try {
  origin = await serve({
    '/parent': `<!doctype html><title>parent</title>${PAGE_SCRIPT_PROBE}
      <body><iframe src="PLACEHOLDER"></iframe></body>`,
    '/child': `<!doctype html><title>child</title>${PAGE_SCRIPT_PROBE}<body>child</body>`,
  });
  // patch the iframe src now that the port is known
  const parentHtml = `<!doctype html><title>parent</title>${PAGE_SCRIPT_PROBE}
    <body><iframe src="http://b.test:${origin.port}/child"></iframe></body>`;
  await origin.close();
  origin = await serve(
    {
      '/parent': parentHtml,
      '/child': `<!doctype html><title>child</title>${PAGE_SCRIPT_PROBE}<body>child</body>`,
    },
    origin.port,
  );

  chrome = await launchChrome({
    port: PORT,
    profileDir: PROFILE,
    extraArgs: [
      '--site-per-process',
      `--host-resolver-rules=MAP a.test 127.0.0.1, MAP b.test 127.0.0.1`,
    ],
  });
  if (SKIP !== 'endpoint') run.record('endpoint', chrome.endpoint.Browser);

  const cdp = await Cdp.connect(chrome.endpoint.webSocketDebuggerUrl);

  // --- 2. browser-level auto-attach -------------------------------------
  const attached = [];
  cdp.on('Target.attachedToTarget', ({ targetInfo, sessionId }) =>
    attached.push({ type: targetInfo.type, url: targetInfo.url, sessionId }),
  );
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });

  const { targetId } = await cdp.send('Target.createTarget', {
    url: `http://a.test:${origin.port}/parent`,
  });
  // give the page, its subresources and any workers time to attach
  await new Promise((r) => setTimeout(r, 2500));

  const pageSession = attached.find((a) => a.type === 'page' && a.url.includes('/parent'));
  if (!pageSession) throw new Error('no page session attached at browser level');
  const types = [...new Set(attached.map((a) => a.type))].sort();
  if (SKIP !== 'auto-attached-types') run.record('auto-attached-types', types.join(','));
  run.note(`${attached.length} sessions attached at browser level: ${types.join(', ')}`);

  // --- 3. injection ordering, asserted positively ------------------------
  await cdp.send(
    'Page.addScriptToEvaluateOnNewDocument',
    { source: `window.__initMarker = 'installed-by-cdp'; window.__initRanAt = Date.now();` },
    pageSession.sessionId,
  );
  // reload so the init script applies to a fresh document, then ask the PAGE
  // script what it saw. If ordering were wrong, __pageSawInitMarker is false.
  await cdp.send('Page.enable', {}, pageSession.sessionId);
  await cdp.send('Page.reload', {}, pageSession.sessionId);
  await new Promise((r) => setTimeout(r, 1500));
  const seen = await cdp.send(
    'Runtime.evaluate',
    {
      expression: `JSON.stringify({
        pageSawInitMarker: window.__pageSawInitMarker,
        initRanAt: window.__initRanAt ?? null,
        pageScriptRanAt: window.__pageScriptRanAt ?? null,
      })`,
      returnByValue: true,
    },
    pageSession.sessionId,
  );
  const ordering = JSON.parse(seen.result.value);
  if (ordering.pageSawInitMarker !== true) {
    process.stderr.write(
      `REFUSED: page script did not observe the init marker: ${seen.result.value}\n`,
    );
    process.exit(1);
  }
  if (SKIP !== 'init-script-before-page-script') {
    const gap = ordering.pageScriptRanAt - ordering.initRanAt;
    run.record(
      'init-script-before-page-script',
      `yes — page script observed the marker${gap > 0 ? `, ${gap}ms after the init script` : ' (both within the same millisecond)'}`,
    );
  }

  // --- 4. OOPIF: does the browser-level arm reach a cross-site frame? ----
  const beforeRearm = attached.filter((a) => a.type === 'iframe').length;
  if (SKIP !== 'oopif-without-rearm') {
    run.record('oopif-without-rearm', beforeRearm > 0 ? `yes (${beforeRearm})` : 'no');
  }

  // re-arm on the PAGE's own session, which is what the docs say is required
  await cdp.send(
    'Target.setAutoAttach',
    { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
    pageSession.sessionId,
  );
  await new Promise((r) => setTimeout(r, 1500));
  const afterRearm = attached.filter((a) => a.type === 'iframe');
  if (SKIP !== 'oopif-after-rearm') {
    run.record(
      'oopif-after-rearm',
      afterRearm.length > 0 ? `yes (${afterRearm.length}: ${afterRearm[0].url})` : 'no',
    );
  }

  cdp.close();
  await cdp.send.length; // no-op, keeps lint honest about the awaited chain
  void targetId;
} finally {
  await chrome?.kill();
  await origin?.close();
}

process.exit(
  run.finish(ARTIFACT, (obs, notes) => `# What the browser protocol gives us

Answers the CDP half of **Q01** and the substrate questions behind it. Produced
by \`spikes/browser/cdp-substrate.mjs\`, which is deleted at the end of M0.5.

Run against a disposable profile. Since Chrome 136 \`--remote-debugging-port\`
is ignored unless \`--user-data-dir\` points somewhere other than the default
profile, so the separate profile is a constraint imposed by the browser, not a
design preference we adopted.

| Question | Measured |
|---|---|
| Debugging endpoint | \`${obs.endpoint}\` |
| Target types auto-attached by one browser-level arm | \`${obs['auto-attached-types']}\` |
| \`addScriptToEvaluateOnNewDocument\` runs before page script | **${obs['init-script-before-page-script']}** |
| Cross-site iframe attaches without re-arming | **${obs['oopif-without-rearm']}** |
| Cross-site iframe attaches after re-arming on the page session | **${obs['oopif-after-rearm']}** |

## How injection ordering was proven

Not by observing that the init script ran. The **page's own script** reads a
global that only the init script could have set, and the run refuses to write
this file if that read comes back false. A probe that merely confirms its own
script executed proves nothing about ordering.

## Why the iframe question matters

A subscription or recorder installed on a page does not automatically reach a
cross-site frame: those run out-of-process and are separate targets. Whatever
we install has to be re-armed per attached session, recursively, or coverage
silently stops at the first frame boundary. Same-process frames are a different
case entirely — they are execution contexts inside the parent target and get no
target of their own.

${notes.length ? `## Notes\n\n${notes.map((n) => `- ${n}`).join('\n')}\n` : ''}
## Receipt

\`\`\`
node spikes/browser/cdp-substrate.mjs --port ${PORT}
\`\`\`
`),
);
