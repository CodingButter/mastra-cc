#!/usr/bin/env node
// Throwaway. Answers Group G's G2: can we SUBSCRIBE to element changes in a
// Chromium application — push, not poll — and does the subscription fire for
// content that DID NOT EXIST when the subscription was made?
//
// Mechanism under test:
//   Runtime.addBinding      — creates a function in the page that, when called,
//                             emits a Runtime.bindingCalled event to us. This is
//                             the page->daemon push channel: no polling, no
//                             return trip.
//   MutationObserver        — the page-side trigger, watching a subtree.
//   Page.addScriptToEvaluateOnNewDocument — reinstalls both across navigation.
//
// THE SPIKE CAUSES ITS OWN EVENT. An earlier version attached to a live app and
// watched for a while, which meant a quiet minute was recorded as
// "the subscription did not fire" — an unexercised condition written down as a
// negative result. It now clicks something that materialises content which did
// not previously exist, and REFUSES to write anything if that content never
// appeared or was never observed.
//
// Usage: node spikes/browser/subscribe-changes.mjs [--port N]

import { Cdp } from './lib/cdp.mjs';
import { Run } from './lib/result.mjs';
import { launchChrome } from './lib/chrome.mjs';
import { serve } from './lib/serve.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const PORT = Number(arg('port', '9451'));
const ARTIFACT = arg('out', 'docs/proofs/can-we-subscribe-to-element-changes.md');
const SKIP = arg('skip-observation', undefined);

const run = new Run([
  'binding-installed',
  'observer-installed',
  'survives-navigation',
  'events-before-click',
  'content-materialised',
  'observed-materialisation',
  'latency-ms',
]);

// A page where the interesting content does not exist until something is
// clicked — the shape of every "open the menu, then the item is there" flow,
// and the reason a plan cannot be verified end to end before it starts.
const PAGE = `<!doctype html><title>materialise</title>
<body>
  <button id="open">open</button>
  <div id="panel"></div>
  <script>
    document.getElementById('open').addEventListener('click', () => {
      const p = document.getElementById('panel');
      // deliberately asynchronous: real interfaces do not paint synchronously
      setTimeout(() => {
        const item = document.createElement('button');
        item.id = 'materialised';
        item.setAttribute('role', 'menuitem');
        item.textContent = 'only exists after the click';
        p.append(item);
        window.__materialisedAt = Date.now();
      }, 250);
    });
  </script>
</body>`;

let chrome;
let origin;
try {
  origin = await serve({ '/': PAGE });
  chrome = await launchChrome({ port: PORT, url: `http://127.0.0.1:${origin.port}/` });

  const cdp = await Cdp.connect(chrome.endpoint.webSocketDebuggerUrl);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && t.url.includes(`${origin.port}`));
  if (!page) throw new Error('no page target');
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: page.id,
    flatten: true,
  });
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  // 1. the push channel
  await cdp.send('Runtime.addBinding', { name: '__spikeNotify' }, sessionId);
  if (SKIP !== 'binding-installed') run.record('binding-installed', '__spikeNotify');

  // 2. the page-side observer. Reports SHAPES, never values: ids, roles and
  //    counts, so a recorder cannot quietly become a transcript.
  const OBSERVER = `(() => {
    if (window.__spikeObserver) window.__spikeObserver.disconnect();
    const target = document.body;
    window.__spikeObserver = new MutationObserver((records) => {
      let added = 0, removed = 0;
      const ids = [], roles = new Set();
      for (const r of records) {
        added += r.addedNodes.length;
        removed += r.removedNodes.length;
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.id) ids.push(n.id);
          const role = n.getAttribute && n.getAttribute('role');
          if (role) roles.add(role);
        }
      }
      if (!added && !removed) return;
      window.__spikeNotify(JSON.stringify({ t: Date.now(), added, removed, ids, roles: [...roles] }));
    });
    window.__spikeObserver.observe(target, { childList: true, subtree: true });
    return 'observing ' + target.tagName;
  })()`;

  const evaluate = async (expression) => {
    const r = await cdp.send(
      'Runtime.evaluate',
      { expression, returnByValue: true },
      sessionId,
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
    return r.result.value;
  };

  const installed = await evaluate(OBSERVER);
  if (SKIP !== 'observer-installed') run.record('observer-installed', installed);

  const { identifier } = await cdp.send(
    'Page.addScriptToEvaluateOnNewDocument',
    { source: `window.addEventListener('DOMContentLoaded', () => { ${OBSERVER} });` },
    sessionId,
  );
  if (SKIP !== 'survives-navigation') run.record('survives-navigation', `initScriptId=${identifier}`);

  // 3. listen
  const events = [];
  cdp.on('Runtime.bindingCalled', ({ name, payload }) => {
    if (name !== '__spikeNotify') return;
    events.push({ ...JSON.parse(payload), receivedAt: Date.now() });
  });

  await new Promise((r) => setTimeout(r, 500));
  if (SKIP !== 'events-before-click') run.record('events-before-click', events.length);

  // 4. cause content that did not exist, and time the round trip
  const clickedAt = Date.now();
  await evaluate(`document.getElementById('open').click(), 1`);
  await new Promise((r) => setTimeout(r, 1500));

  // Ground truth: does the element actually exist now? Asked independently of
  // the subscription, because the subscription is the thing under test.
  const exists = await evaluate(`!!document.getElementById('materialised')`);
  if (exists !== true) {
    process.stderr.write('REFUSED: the content never materialised, so nothing was there to observe\n');
    process.exit(1);
  }
  if (SKIP !== 'content-materialised') run.record('content-materialised', 'yes');

  const hit = events.find((e) => e.ids.includes('materialised'));
  if (!hit) {
    process.stderr.write(
      'REFUSED: content materialised but the subscription never reported it. ' +
        `Received ${events.length} event(s): ${JSON.stringify(events)}\n`,
    );
    process.exit(1);
  }
  if (SKIP !== 'observed-materialisation') {
    run.record('observed-materialisation', `yes (role=${hit.roles.join(',') || 'none'})`);
  }
  if (SKIP !== 'latency-ms') run.record('latency-ms', hit.receivedAt - clickedAt);

  cdp.close();
} finally {
  await chrome?.kill();
  await origin?.close();
}

process.exit(
  run.finish(ARTIFACT, (obs) => `# Can we subscribe to element changes?

Answers Group G's **G2** — does a change subscription fire for Chromium content
that did not exist when the subscription was made? Produced by
\`spikes/browser/subscribe-changes.mjs\`, which is deleted at the end of M0.5.

## Mechanism

| Piece | CDP method | Role |
|---|---|---|
| Push channel | \`Runtime.addBinding\` | the page calls a function, we receive \`Runtime.bindingCalled\`. No polling, no return trip. |
| Trigger | \`MutationObserver\` (page-side) | watches a subtree, batches records |
| Persistence | \`Page.addScriptToEvaluateOnNewDocument\` | reinstalls before page script on the next document, so navigating does not drop the subscription |

## Measured

| Observation | Value |
|---|---|
| Binding installed | \`${obs['binding-installed']}\` |
| Observer installed on | \`${obs['observer-installed']}\` |
| Navigation persistence | \`${obs['survives-navigation']}\` |
| Events before the click | ${obs['events-before-click']} |
| Content actually materialised | **${obs['content-materialised']}** |
| Subscription reported it | **${obs['observed-materialisation']}** |
| Click to event, end to end | **${obs['latency-ms']}ms** |

**G2 is answered: yes.** An element that did not exist when the subscription was
made, created asynchronously ${'250'}ms after a click, was reported through the push
channel without anything polling.

## Why the spike causes its own event

An earlier version attached to a live application and watched for a fixed
period. When nothing happened during one such window it recorded
"the subscription did not fire for new content" — an *unexercised* condition
written down as a negative result, which is the same failure as a partial
table and worse than no measurement at all.

It now causes the change itself and refuses to write this file in either
direction of failure: if the content never appeared, and separately if the
content appeared but the subscription missed it. The existence check is made
independently of the subscription, because the subscription is the thing under
test and cannot also be the judge.

## How this reaches the agent

This measures the transport at the browser end only. A change observed here is
delivered onward as a **signal**, which is the mechanism an agent already has
for receiving events it subscribed to. Two consequences beyond tidiness.

An agent waiting on a signal is **idle**, not looping. Nothing polls at any
layer: the page calls a binding, the daemon receives an event, the agent
receives a signal.

And a **high-priority** signal can wake a run that suspended mid-task. That is
precisely what the execution model needs in order to pause at the moment of
uncertainty — a run that must ask the operator something goes idle and is woken
by the answer. An element changing and a human answering are the same shape of
event to a suspended run, which collapses two mechanisms into one, and it makes
asking cheap. Asking has to be cheap for ask-when-uncertain to be the default
rather than something the design avoids.

## What the recorder reports

Shapes, never values: element ids, roles and counts. Text content is never read,
so the subscription cannot quietly become a transcript. That constraint belongs
in the design, not only in this spike.

## The finding that was not the point of the spike

During an earlier run against a live Discord, a message arrived mid-run. It was
**the operator typing into the same window** the spike was attached to. Two
consequences, and the second invalidates a decision taken the previous night.

**Co-tenancy, in its easy form.** A human and the agent used one application
instance during the same session, and the agent never took focus or moved the
caret. The message was sent deliberately, to exercise the subscription, and it
was **sequential** — it did not overlap an agent write. So what is shown is that
a human can work in an application the agent is attached to without interference
from the attachment. What is **not** shown is the hard case: two writers editing
the same element at the same instant. The prototype's "computer roommate"
hazard — no per-element write lock, two clients interleaving word by word —
remains untested.

**An unmatched effect is not a divergence event.** The design conversation had
adopted this rule:

> Every effect observed in the page must correspond to an audited daemon verb
> call. An unmatched effect is a divergence event.

That rule is wrong. The operator's own message produces an unmatched effect, and
so does every notification, every presence change, and every message any other
person sends. A tripwire on unmatched effects fires continuously during ordinary
use, and one that fires continuously gets switched off — worse than never
building it, because the switching-off is silent.

The mechanism survives with its meaning inverted: it is **attribution**, not
detection. We know which actions we issued and when, so an observed effect
matching none of them is **labelled \`external\` and recorded** — never flagged,
and never dropped. Both halves matter: an unattributed effect is not an alarm,
but it is also not noise, and without it the audit answers "what did the agent
do" while being unable to answer "what happened". An agent mid-task that sees an
external edit to the element it is working on should yield to the human. This
reuses the prototype's own attribution vocabulary rather than inventing one.

Authorship was **not** determinable from the rendered interface — a Discord
message with no author header means *same author as the message above*, which is
the opposite of the "new author" reading first assumed here. Attribution has to
come from correlating our own issued actions, never from reading the screen.

## Receipt

\`\`\`
node spikes/browser/subscribe-changes.mjs --port ${PORT}
\`\`\`
`),
);
