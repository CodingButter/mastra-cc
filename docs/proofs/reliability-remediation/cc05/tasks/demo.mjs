// CC-05's second half, against BUILT artifacts: two agent loops sharing one
// MastraCC - which is one connection, and therefore ONE driver as far as the
// daemon can tell - each typing its own goal's text into the same field.
//
// The desk records what it was actually asked to type, in order. Interleaving
// is not an abstract risk here: it is visible as a sequence of edits that no
// single goal would ever have asked for.
//
// Both arrangements run and both transcripts are printed. The point is the
// difference, not either number alone.
//
//   node docs/proofs/reliability-remediation/cc05/tasks/demo.mjs [checkout]
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const load = (path) => import(pathToFileURL(join(root, path)));
const { startServer, OwnershipTable } = await load('daemon/dist/index.mjs');
const { MastraCC, DeskBusyError } = await load('packages/desktop/dist/mastra.mjs');

const directory = mkdtempSync(join(tmpdir(), 'cc05-tasks-'));
const FIELD = 'el-0123456789ab';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A desk that writes down every edit it is asked to make, in arrival order. */
function recordingDesk() {
  const typed = [];
  const element = { id: FIELD, role: 'textbox', name: 'field', actions: [], states: [], content: { kind: 'text', value: '' } };
  return {
    typed,
    backend: {
      name: 'recording',
      applicationOfElement: () => 'test-app',
      focusedElement: async () => undefined,
      queryElements: async () => ({ elements: [element] }),
      readElementContent: async () => ({ element }),
      setElementText: async (params) => {
        typed.push(params.text);
        // A real toolkit does not answer instantly, and the gap is exactly
        // where the other loop's await resumes.
        await sleep(15);
        return { element };
      },
      close: () => undefined,
    },
  };
}

async function desk() {
  const socketPath = join(mkdtempSync(join(directory, 'run-')), 'd.sock');
  const recording = recordingDesk();
  const server = await startServer({
    socketPath,
    backend: recording.backend,
    launch: {
      permits: new Set(['test-app']),
      allows: new Set(['observe', 'edit']),
      table: new OwnershipTable(),
      visibility: 'all',
    },
  });
  const instance = new MastraCC({ socketPath });
  return {
    recording,
    instance,
    async close() {
      await instance.close();
      await new Promise((r) => server.close(r));
    },
  };
}

/** One goal: three edits of its own text, with its own thinking between them. */
async function goal(tools, label) {
  for (let step = 1; step <= 3; step += 1) {
    await tools.setElementText.execute({ id: FIELD, text: `${label}-${step}` }, {});
    await sleep(5);
  }
}

// WITHOUT the lease: two loops, one connection, no task held by anyone.
const bare = await desk();
await Promise.all([goal(bare.instance.getTools(), 'invoice'), goal(bare.instance.getTools(), 'holiday')]);
const interleaved = bare.recording.typed.slice();
await bare.close();

// WITH the lease: each loop asks for the desk, and the second waits its turn.
const leased = await desk();
const refused = [];
const run = (label) =>
  leased.instance
    .withTask(label, () => goal(leased.instance.getTools(), label))
    .catch((failure) => {
      if (!(failure instanceof DeskBusyError)) throw failure;
      refused.push(label);
    });
await Promise.all([run('invoice'), run('holiday')]);
const serialized = leased.recording.typed.slice();

// And the case the lease exists for: a rival loop that never asked for the
// desk, dispatching an effect while a task holds it.
let letRivalGo = () => undefined;
const rivalTurn = new Promise((resolve) => { letRivalGo = resolve; });
const rivalTools = leased.instance.getTools();
// Built and started OUTSIDE the task: a second agent loop is its own call
// stack, resuming when its own await returns, not a continuation of the task.
const rivalLoop = rivalTurn
  .then(() => rivalTools.setElementText.execute({ id: FIELD, text: 'from nowhere' }, {}))
  .then(() => 'sent')
  .catch((failure) => failure);
await leased.instance.withTask('invoice', async () => {
  letRivalGo();
  await rivalLoop;
});
const rival = await rivalLoop;
const rivalSent = leased.recording.typed.includes('from nowhere');
await leased.close();
rmSync(directory, { recursive: true, force: true });

const contiguous = (typed, label) => {
  const positions = typed.map((text, index) => [text, index]).filter(([text]) => text.startsWith(label)).map(([, index]) => index);
  return positions.every((position, index) => index === 0 || position === positions[index - 1] + 1);
};

console.log('without the lease, the desk was asked to type:', interleaved.join(' '));
console.log('   invoice contiguous:', contiguous(interleaved, 'invoice'), ' holiday contiguous:', contiguous(interleaved, 'holiday'));
console.log('with the lease, the desk was asked to type:   ', serialized.join(' '));
console.log('   invoice contiguous:', contiguous(serialized, 'invoice'), ' holiday contiguous:', contiguous(serialized, 'holiday'));
console.log('   tasks refused as busy:', refused.length);
console.log("a rival loop's effect while a task held the desk:", rival instanceof DeskBusyError ? `refused (${rival.holder})` : rival);
console.log('   did it reach the desk:', rivalSent);

assert.equal(interleaved.length, 6, 'both goals should have made all their edits');
assert.ok(
  !contiguous(interleaved, 'invoice') || !contiguous(interleaved, 'holiday'),
  'the unleased arrangement was supposed to interleave; if it did not, the demo proves nothing and the timing needs to be worse',
);
assert.equal(serialized.length, 6, 'both goals should still make all their edits under the lease');
assert.ok(contiguous(serialized, 'invoice') && contiguous(serialized, 'holiday'), 'each task should hold the desk for its whole run');
assert.equal(refused.length, 0, 'two tasks is well within the waiting bound');
assert.ok(rival instanceof DeskBusyError, "a rival loop's effect should be refused while a task holds the desk");
assert.equal(rivalSent, false, 'the refused effect should never have reached the desk');
console.log('PROOF: GREEN');
