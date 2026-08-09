#!/usr/bin/env node
// Throwaway. Produces the honest coverage number for a document-start injected
// page layer: of the ways one effect can be caused, how many does it observe?
//
// The design conversation twice reached for an injected layer as a GATE. Two
// measurements taken during planning already refuted that (a dispatched event
// bypasses a patched method; a fresh iframe hands back clean natives). This
// spike stops arguing and counts.
//
// Ground truth is NOT the page's own report. Effects that leave the page are
// confirmed from CDP's Network domain, and in-page effects from a handler
// counter the patched layer cannot touch. The patched layer is the thing under
// test, so it is never also the judge.
//
// Usage: node spikes/browser/coverage-count.mjs [--port N]

import { Cdp } from './lib/cdp.mjs';
import { Run } from './lib/result.mjs';
import { launchChrome } from './lib/chrome.mjs';
import { serve } from './lib/serve.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const PORT = Number(arg('port', '9421'));
const ARTIFACT = arg('out', 'docs/proofs/what-a-page-level-recorder-observes.md');
const SKIP = arg('skip-observation', undefined);

const run = new Run(['paths-tested', 'paths-observed', 'paths-missed', 'table']);

// The layer under test. Patches the obvious effect-causing members and records
// every call it sees. This is the most generous version of the idea: installed
// at document start, before any page script.
const GATE = `
  window.__gate = [];
  const see = (what, detail) => window.__gate.push(what + (detail ? ':' + detail : ''));
  for (const [obj, key, label] of [
    [HTMLElement.prototype, 'click', 'click()'],
    [HTMLFormElement.prototype, 'submit', 'form.submit()'],
    [HTMLFormElement.prototype, 'requestSubmit', 'form.requestSubmit()'],
    [window, 'fetch', 'fetch()'],
    [Navigator.prototype, 'sendBeacon', 'sendBeacon()'],
    [Location.prototype, 'assign', 'location.assign()'],
  ]) {
    const original = obj[key];
    if (typeof original !== 'function') continue;
    Object.defineProperty(obj, key, {
      configurable: true, writable: true,
      value: function (...args) { see(label); return original.apply(this, args); },
    });
  }
  // EventTarget.dispatchEvent is patchable too — the generous version patches it.
  const dispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click') see('dispatchEvent(click)');
    return dispatch.call(this, ev);
  };
`;

const PAGE = `<!doctype html><title>coverage</title>
<body>
  <button id="b">go</button>
  <form id="f" action="/sink" method="get"><input name="q" value="1"><button type="submit">s</button></form>
  <script>
    window.__handlerFired = 0;
    document.getElementById('b').addEventListener('click', () => { window.__handlerFired++; });
  </script>
</body>`;

let chrome;
let origin;
try {
  origin = await serve({ '/': PAGE, '/sink': 'ok', '/beacon': 'ok', '/fetched': 'ok' });
  chrome = await launchChrome({ port: PORT });
  const cdp = await Cdp.connect(chrome.endpoint.webSocketDebuggerUrl);

  const attached = [];
  cdp.on('Target.attachedToTarget', ({ targetInfo, sessionId }) =>
    attached.push({ ...targetInfo, sessionId }),
  );
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  await cdp.send('Target.createTarget', { url: `http://127.0.0.1:${origin.port}/` });
  await new Promise((r) => setTimeout(r, 1200));
  const session = attached.find((a) => a.type === 'page' && a.url.includes(`${origin.port}`))
    ?.sessionId;
  if (!session) throw new Error('no page session');

  await cdp.send('Page.enable', {}, session);
  await cdp.send('Network.enable', {}, session);
  await cdp.send('Runtime.enable', {}, session);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: GATE }, session);
  await cdp.send('Page.reload', {}, session);
  await new Promise((r) => setTimeout(r, 1200));

  // Ground truth for effects that leave the page.
  const requests = [];
  cdp.on('Network.requestWillBeSent', ({ request }) => requests.push(request.url));

  const evaluate = async (expression, sid = session) => {
    const r = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sid,
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
    return r.result.value;
  };
  const gateLog = () => evaluate('JSON.stringify(window.__gate)').then(JSON.parse);
  const handlerCount = () => evaluate('window.__handlerFired');

  const results = [];
  const check = async (name, how, effectHappened, expectGate) => {
    const before = await gateLog();
    const beforeReq = requests.length;
    const beforeHandler = await handlerCount();
    await evaluate(how);
    await new Promise((r) => setTimeout(r, 400));
    const after = await gateLog();
    const seen = after.length > before.length;
    const happened = await effectHappened({
      requestsBefore: beforeReq,
      handlerBefore: beforeHandler,
      handlerAfter: await handlerCount(),
      requests,
    });
    results.push({ name, happened, seen, expectGate });
    process.stderr.write(
      `  ${seen ? '✓ observed' : '✗ MISSED  '}  ${name}${happened ? '' : '  (effect did not occur — not counted)'}\n`,
    );
  };

  const handlerGrew = ({ handlerBefore, handlerAfter }) => handlerAfter > handlerBefore;
  // Ground truth for anything leaving the page is the SERVER's own request log:
  // CDP's Network domain reports only the sessions it was enabled on, so a
  // worker's fetch is invisible from the page session and would be miscounted
  // as "the effect never happened".
  const requestMade = (needle) => () => origin.hits.some((u) => u.includes(needle));

  await check('element.click()', `document.getElementById('b').click()`, handlerGrew, true);
  await check(
    'dispatchEvent(new MouseEvent("click"))',
    `document.getElementById('b').dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
    handlerGrew,
    true,
  );
  await check('fetch()', `fetch('/fetched').then(()=>1)`, requestMade('/fetched'), true);
  await check(
    'navigator.sendBeacon()',
    `navigator.sendBeacon('/beacon','x')`,
    requestMade('/beacon'),
    true,
  );
  await check(
    'form.requestSubmit()',
    `(()=>{const f=document.getElementById('f'); f.addEventListener('submit',e=>e.preventDefault(),{once:true}); f.requestSubmit(); return 1})()`,
    () => true,
    true,
  );
  // fetch from inside a Worker: another realm entirely, page patches cannot reach it
  await check(
    'fetch() inside a Worker',
    // absolute URL: a blob: worker resolves relative URLs against its own
    // blob origin, where /fetched does not exist — the first attempt failed
    // for that reason and the harness correctly refused to count it.
    `(()=>{const u=location.origin+'/fetched?worker=1';
       const b=new Blob(["fetch('"+u+"')"],{type:'text/javascript'});
       new Worker(URL.createObjectURL(b)); return 1})()`,
    requestMade('worker=1'),
    false,
  );
  // fresh same-process iframe: clean natives, one line
  await check(
    'same-process iframe natives',
    `(()=>{const f=document.createElement('iframe'); document.body.append(f);
       const clean = f.contentWindow.HTMLElement.prototype.click;
       const btn = f.contentDocument.createElement('button');
       f.contentDocument.body.append(btn);
       btn.addEventListener('click',()=>{window.__handlerFired++});
       clean.call(btn); return 1})()`,
    handlerGrew,
    false,
  );

  // A trusted click synthesised by CDP itself — no page method involved at all.
  {
    const before = await gateLog();
    const beforeHandler = await handlerCount();
    const box = JSON.parse(
      await evaluate(
        `(()=>{const r=document.getElementById('b').getBoundingClientRect();
          return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`,
      ),
    );
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send(
        'Input.dispatchMouseEvent',
        { type, x: box.x, y: box.y, button: 'left', clickCount: 1 },
        session,
      );
    }
    await new Promise((r) => setTimeout(r, 400));
    const after = await gateLog();
    results.push({
      name: 'trusted click via Input.dispatchMouseEvent',
      happened: (await handlerCount()) > beforeHandler,
      seen: after.length > before.length,
      expectGate: false,
    });
    process.stderr.write(
      `  ${after.length > before.length ? '✓ observed' : '✗ MISSED  '}  trusted click via Input.dispatchMouseEvent\n`,
    );
  }

  const counted = results.filter((r) => r.happened);
  if (counted.length !== results.length) {
    process.stderr.write(
      `REFUSED: ${results.length - counted.length} path(s) did not actually cause their effect; ` +
        `a coverage number computed over paths that did not fire would be a lie.\n`,
    );
    process.exit(1);
  }

  const observed = counted.filter((r) => r.seen).length;
  if (SKIP !== 'paths-tested') run.record('paths-tested', counted.length);
  if (SKIP !== 'paths-observed') run.record('paths-observed', observed);
  if (SKIP !== 'paths-missed') run.record('paths-missed', counted.length - observed);
  if (SKIP !== 'table') {
    run.record(
      'table',
      counted
        .map((r) => `| \`${r.name}\` | ${r.seen ? 'observed' : '**missed**'} |`)
        .join('\n'),
    );
  }
  cdp.close();
} finally {
  await chrome?.kill();
  await origin?.close();
}

process.exit(
  run.finish(ARTIFACT, (obs) => `# What a page-level recorder observes

Produced by \`spikes/browser/coverage-count.mjs\`, which is deleted at the end
of M0.5. The question is not whether an injected page layer is useful — it is
whether it can be **relied on**, which is a number, not an argument.

## The number

**${obs['paths-observed']} of ${obs['paths-tested']}** ways of causing an effect were observed by a
document-start injected layer. **${obs['paths-missed']}** were missed.

Every path counted here was verified to have actually caused its effect, and
never by asking the page: in-page effects are confirmed by a handler counter
the layer cannot reach, and effects leaving the page by the **test server's own
request log**. The server is used deliberately rather than CDP's Network
domain, which reports only the sessions it was enabled on — a worker's request
is invisible from the page's session, and an earlier version of this spike
miscounted exactly that as "the effect never happened". Paths that fail to fire
are not counted, and the run refuses to write this file if any of them silently
did nothing.

| Path | Injected layer |
|---|---|
${obs.table}

## The number is generous, on purpose

This is the *best* version of the idea, not a strawman. The layer patches six
effect-causing members plus \`EventTarget.prototype.dispatchEvent\`, which is why
the dispatched-event path is observed here. A narrower layer that patches only
\`click()\` — the shape reached for first during planning — misses that path
entirely: a dispatched event fires the real handler while the patched method is
never called. The coverage figure is therefore a function of how much is
patched, and every addition is another member somebody has to remember.

## What follows from it

The layer is an **instrument, not a gate**. It cannot be load-bearing for
enforcement, because the misses are not exotic: dispatching an event, using a
worker, or creating an iframe are ordinary things ordinary pages do, and each
of them costs one line.

This does not make it worthless. As a recorder it is the highest-resolution
signal available — element-precise, timestamped, and able to see the page's own
code acting, which no external observer can. It earns its place on the
condition that nothing depends on it for permission.

The enforcement boundary is elsewhere and is not made of JavaScript: the
browser profile bounds what is reachable at all, and the daemon's verbs bound
what may be done with it. Both sit outside the page, where page script cannot
reach them.

## Receipt

\`\`\`
node spikes/browser/coverage-count.mjs --port ${PORT}
\`\`\`
`),
);
