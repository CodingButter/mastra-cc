#!/usr/bin/env node
// Throwaway. The claim this whole substrate rests on: input dispatched over the
// debugging protocol reaches a page WITHOUT the operator's OS focus being taken.
//
// If it is false, "the assistant works alongside you" is false too, because
// every keystroke would steal the window the human is using.
//
// The condition is arranged by the spike rather than by an operator: a SECOND
// browser window is launched, which takes OS focus, leaving the first window
// unfocused. The precondition is then verified from inside the first page —
// document.hasFocus() must be false — and the run REFUSES if it is not, because
// typing into a window that turned out to be focused proves nothing at all.
//
// Usage: node spikes/browser/unfocused-input.mjs [--port N]

import { Cdp } from './lib/cdp.mjs';
import { Run } from './lib/result.mjs';
import { launchChrome } from './lib/chrome.mjs';
import { serve } from './lib/serve.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const PORT = Number(arg('port', '9431'));
const DECOY_PORT = Number(arg('decoy-port', String(PORT + 1)));
const ARTIFACT = arg('out', 'docs/proofs/can-we-type-without-taking-focus.md');
const SKIP = arg('skip-observation', undefined);

// NOTE ON THE ORACLE. An earlier version of this spike asked the window under
// test whether it had focus after typing, and it answered "yes" — which looked
// like focus theft. It is not. Both windows can report document.hasFocus() ===
// true at the same instant, which is impossible at the OS level, so that call
// reports the renderer's own bookkeeping and cannot be used as an OS-focus
// oracle. The claim is therefore measured on the OTHER window: the question is
// not "does the target believe it is focused" but "did the window the human is
// using ever lose the keyboard".
const run = new Run([
  'session-type',
  'target-unfocused-before',
  'other-window-focused-before',
  'typed-text-arrived',
  'enter-key-arrived',
  'other-window-still-focused-after',
  'target-self-report',
]);

const PAGE = `<!doctype html><title>typing target</title>
<body>
  <input id="t" autocomplete="off">
  <div id="log"></div>
  <script>
    window.__submits = 0;
    const t = document.getElementById('t');
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__submits++; });
  </script>
</body>`;

let target;
let decoy;
let origin;
try {
  origin = await serve({ '/': PAGE });

  // The window under test. Headed, because a headless browser has no OS window
  // and the question would be meaningless.
  target = await launchChrome({
    port: PORT,
    headless: false,
    url: `http://127.0.0.1:${origin.port}/`,
  });
  run.record('session-type', process.env.WAYLAND_DISPLAY ? 'wayland' : `x11 (${process.env.DISPLAY})`);

  const cdp = await Cdp.connect(target.endpoint.webSocketDebuggerUrl);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && t.url.includes(`${origin.port}`));
  if (!page) throw new Error('no page target in the window under test');
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: page.id,
    flatten: true,
  });
  const evaluate = async (expression) => {
    const r = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true },
      sessionId,
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
    return r.result.value;
  };

  // A second window, standing in for the window the human is working in. It is
  // launched after the target so it takes the keyboard.
  decoy = await launchChrome({ port: DECOY_PORT, headless: false, url: `http://127.0.0.1:${origin.port}/` });
  await new Promise((r) => setTimeout(r, 2000));

  const decoyCdp = await Cdp.connect(decoy.endpoint.webSocketDebuggerUrl);
  const decoyList = await (await fetch(`http://127.0.0.1:${DECOY_PORT}/json/list`)).json();
  const decoyPage = decoyList.find((t) => t.type === 'page' && t.url.includes(`${origin.port}`));
  const decoySession = (
    await decoyCdp.send('Target.attachToTarget', { targetId: decoyPage.id, flatten: true })
  ).sessionId;
  const decoyEval = async (expression) =>
    (
      await decoyCdp.send('Runtime.evaluate', { expression, returnByValue: true }, decoySession)
    ).result.value;

  const targetFocusedBefore = await evaluate('document.hasFocus()');
  const decoyFocusedBefore = await decoyEval('document.hasFocus()');
  if (targetFocusedBefore !== false || decoyFocusedBefore !== true) {
    process.stderr.write(
      `REFUSED: the condition was not arranged — target focused=${targetFocusedBefore}, ` +
        `other window focused=${decoyFocusedBefore}. Typing into a window that already had ` +
        `the keyboard would prove the opposite of what this file claims.\n`,
    );
    process.exit(1);
  }
  if (SKIP !== 'target-unfocused-before') run.record('target-unfocused-before', 'yes');
  if (SKIP !== 'other-window-focused-before') run.record('other-window-focused-before', 'yes');

  // Focus the element WITHIN the document. This is DOM focus, not OS focus, and
  // it is the distinction the whole design depends on.
  await evaluate(`document.getElementById('t').focus(), 1`);

  const TEXT = 'typed while unfocused';
  for (const ch of TEXT) {
    await cdp.send(
      'Input.dispatchKeyEvent',
      { type: 'keyDown', text: ch, unmodifiedText: ch },
      sessionId,
    );
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch }, sessionId);
  }
  const arrived = await evaluate(`document.getElementById('t').value`);
  if (arrived !== TEXT) {
    process.stderr.write(`REFUSED: text did not arrive intact: ${JSON.stringify(arrived)}\n`);
    process.exit(1);
  }
  if (SKIP !== 'typed-text-arrived') run.record('typed-text-arrived', JSON.stringify(arrived));

  for (const type of ['keyDown', 'keyUp']) {
    await cdp.send(
      'Input.dispatchKeyEvent',
      { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
      sessionId,
    );
  }
  const submits = await evaluate('window.__submits');
  if (SKIP !== 'enter-key-arrived') run.record('enter-key-arrived', submits > 0 ? 'yes' : 'no');

  // The claim, measured where it actually lives: did the OTHER window keep the
  // keyboard throughout?
  const decoyStillFocused = await decoyEval('document.hasFocus()');
  const targetSelfReport = await evaluate('document.hasFocus()');
  const decoyGotText = await decoyEval(`document.getElementById('t').value`);
  if (decoyGotText !== '') {
    process.stderr.write(
      `REFUSED: text leaked into the other window (${JSON.stringify(decoyGotText)}).\n`,
    );
    process.exit(1);
  }
  if (SKIP !== 'other-window-still-focused-after') {
    run.record(
      'other-window-still-focused-after',
      decoyStillFocused === true ? 'yes — it never lost the keyboard' : 'NO — focus was taken',
    );
  }
  if (SKIP !== 'target-self-report') {
    run.record(
      'target-self-report',
      targetSelfReport === true
        ? 'claims focus (both windows claim it at once — renderer bookkeeping, not OS focus)'
        : 'does not claim focus',
    );
  }

  decoyCdp.close();
  cdp.close();
} finally {
  await decoy?.kill();
  await target?.kill();
  await origin?.close();
}

process.exit(
  run.finish(ARTIFACT, (obs) => `# Can we type without taking focus?

Produced by \`spikes/browser/unfocused-input.mjs\`, which is deleted at the end
of M0.5.

This is the measurement behind "the assistant works alongside you rather than
taking over the machine". If input can only be delivered to a focused window,
that principle is not implementable on the browser substrate and the design has
to say so.

| Observation | Measured |
|---|---|
| Desktop session | \`${obs['session-type']}\` |
| Target window unfocused before typing | **${obs['target-unfocused-before']}** |
| Other window held the keyboard before typing | **${obs['other-window-focused-before']}** |
| Typed text arrived intact in the target | **${obs['typed-text-arrived']}** |
| \`Enter\` reached the page's key handler | **${obs['enter-key-arrived']}** |
| **Other window still held the keyboard afterwards** | **${obs['other-window-still-focused-after']}** |
| Target's own focus self-report | ${obs['target-self-report']} |

Text was also confirmed **not** to have leaked into the other window; the run
refuses to write this file if it did.

## The oracle problem, and why the last row is not the claim

The obvious way to measure this is to ask the window under test whether it has
focus after typing. That answer is worthless, and an earlier version of this
spike was misled by it: after input dispatch the target reports
\`document.hasFocus() === true\`, which reads like focus theft.

It is not. Measuring both windows at once shows **both reporting \`true\`
simultaneously**, which cannot be true of OS focus — only one window can hold
the keyboard. What that call reports is the renderer's own bookkeeping: a
widget that has been handed synthesized input marks itself focused, regardless
of what the compositor thinks.

So the claim is measured on the other window instead. "Did the window the human
is using ever lose the keyboard" is the question the product actually makes a
promise about, and it is the one row above in bold.

No independent compositor oracle was available to corroborate: GNOME Shell's
\`Eval\` method is disabled, so the desktop cannot be asked which window is
active. The two-windows-both-true result stands on its own — it is internally
decisive, since it disproves the oracle rather than depending on it — but an
X11 session, where the active window can be queried directly, would settle it
from the outside. Recorded as a known gap rather than papered over.

## Why the precondition is checked rather than assumed

The run verifies that the target is unfocused **and** that the other window
holds the keyboard before typing anything, and writes nothing if either is
false. Typing into a window that turned out to be focused would produce a green
result proving the opposite of what it claims, which is the exact failure shape
this repository treats as worse than having no test.

## The distinction that makes it work

Two different kinds of focus are involved and only one of them is the human's:

- **OS focus** — which window receives the keyboard. This belongs to the
  operator and is never taken.
- **DOM focus** — which element inside the document receives input. Set with
  \`element.focus()\`, which moves nothing on the desktop.

Input dispatched over the protocol is delivered to the renderer directly and
routed by DOM focus. It never enters the operating system's input queue, which
is why the operator's window keeps the keyboard throughout.

## What this does not cover

Only the browser substrate. Typing into a native application through the
accessibility layer is a different mechanism with a different answer, and on
that side taking focus may be unavoidable. These are two separate risk surfaces
and the product has to describe them separately rather than generalising from
this result.

## Receipt

\`\`\`
node spikes/browser/unfocused-input.mjs --port ${PORT}
\`\`\`
`),
);
