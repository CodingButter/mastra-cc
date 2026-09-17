import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

// Public built library entry; deterministic event source and notification sink.
// No native desktop, provider, persistence, or package installation claim.
const root = resolve(process.argv[2] ?? '.');
const { DesktopSignals } = await import(pathToFileURL(resolve(root, 'packages/desktop/dist/mastra.mjs')));
const providers = [];
async function setup() {
  let push;
  const sent = [];
  let sourceReads = 0;
  const client = new Proxy({ then: undefined, onChangeEvent(callback) { push = callback; return () => {}; } }, {
    get(target, property) { if (property in target) return target[property]; sourceReads++; throw new Error(`unexpected desktop request: ${String(property)}`); },
  });
  const provider = new DesktopSignals({ client: async () => client, target: { threadId: 'proof', resourceId: 'synthetic' } });
  provider.connect({ async sendNotificationSignal(notification) { sent.push(notification); } });
  providers.push(provider); await provider.start();
  return { push, sent, provider, reads: () => sourceReads };
}
const event = (id = 'sub-1', at = 1) => ({ subscriptionId: id, id: 'el-0123456789ab', role: 'textbox', kind: 'changed', attribution: 'external', priority: 'low', at });
try {
  const trailing = await setup();
  trailing.push(event('sub-1', 99999999));
  const attemptsAtBoundary = trailing.sent.length;
  await sleep(25);
  trailing.push(event('sub-1', 1));
  await sleep(1100);
  const finalWake = trailing.sent.length === 2 && trailing.sent[1].attributes.at === 1;
  console.log(JSON.stringify({ scenario: 'marked-observation-boundary-before-last-change', attemptsAtBoundary, notificationAttempts: trailing.sent.length, finalWake, desktopReads: trailing.reads() }));
  trailing.provider.stop();

  const churn = await setup();
  for (let i = 0; i < 1000; i++) churn.push(event(`sub-${i}`, i));
  const leading = churn.sent.length;
  await sleep(1100);
  const overflow = churn.sent.some(x => x.summary.includes('coalesced'));
  console.log(JSON.stringify({ scenario: '1000-unique-watch-burst', leadingAttempts: leading, overflowInvalidation: overflow, desktopReads: churn.reads() }));
  churn.provider.stop();
  const stopped = churn.sent.length; await sleep(1100);
  assert.equal(churn.sent.length, stopped, 'no queued notification after stop');
  assert.equal(trailing.reads() + churn.reads(), 0, 'no desktop reads during maintenance');
  assert.equal(finalWake, true, 'suppressed final change needs a follow-up notification attempt');
  assert.equal(leading, 32, 'aggregate leading wake budget');
  assert.equal(overflow, true, 'evicted dirty pointers need broad invalidation');
  console.log('PROOF: GREEN — built public library bounds attempts and sends a trailing invalidation; synthetic source and sink');
} catch (error) {
  console.error(`PROOF: RED — ${error.message}`); process.exitCode = 1;
} finally { for (const provider of providers) provider.stop(); }
