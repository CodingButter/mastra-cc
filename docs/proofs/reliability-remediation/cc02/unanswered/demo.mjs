// CC-02's last open edge, against BUILT artifacts: a daemon that says hello,
// receives a request, and never answers it. The socket stays healthy the whole
// time - which is exactly why nothing noticed before.
//
//   node docs/proofs/reliability-remediation/cc02/unanswered/demo.mjs [checkout]
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const load = (path) => import(pathToFileURL(join(root, path)));
const { connect, UnansweredRequestError } = await load('packages/transport/dist/index.mjs');
const { SCHEMA_DIGEST } = await load('packages/protocol-types/dist/index.js');

const directory = mkdtempSync(join(tmpdir(), 'cc02-unanswered-'));
const socketPath = join(directory, 'd.sock');
const received = [];
const server = createServer((socket) => {
  socket.write(`${JSON.stringify({ type: 'hello', digest: SCHEMA_DIGEST })}\n`);
  socket.on('data', (chunk) => {
    for (const line of chunk.toString('utf8').split('\n').filter(Boolean)) {
      const request = JSON.parse(line);
      if (request.method === undefined) continue;
      received.push(request.method);
      // Deliberately no reply, except for the one method that proves the line
      // is still alive after another request gave up on it.
      if (request.method === 'queryElements') {
        socket.write(`${JSON.stringify({ type: 'response', id: request.id, result: { elements: [] } })}\n`);
      }
    }
  });
});
await new Promise((r) => server.listen(socketPath, r));

// WITHOUT a budget: the caller waits, and keeps waiting.
const patient = await connect({ socketPath });
let settled = false;
void patient.typeText({ id: 'el-0123456789ab', text: 'hello' }).then(() => { settled = true; }, () => { settled = true; });
await new Promise((r) => setTimeout(r, 500));
const settledWhilePatient = settled;
console.log('no budget: request settled after 500ms?', settledWhilePatient);
// Closing the connection DOES settle it - that is the terminal path, and it is
// the caller's act, not the transport giving up on its own.
patient.close();

// WITH a budget: the request gives up, and says what it does not know.
const bounded = await connect({ socketPath, replyBudgetMs: 150 });
const started = Date.now();
const failure = await bounded.typeText({ id: 'el-0123456789ab', text: 'hello' }).catch((error) => error);
const waited = Date.now() - started;
console.log(`budget 150ms: gave up after ${waited}ms as ${failure?.name}`);
console.log('  message:', failure?.message);
const afterwards = await bounded.queryElements({});
console.log('  the same connection still answers:', JSON.stringify(afterwards));
bounded.close();

server.close();
rmSync(directory, { recursive: true, force: true });

assert.equal(settledWhilePatient, false, 'an unbudgeted request must not give up on its own');
assert.ok(failure instanceof UnansweredRequestError, 'the budgeted request should report an unanswered request');
assert.match(failure.message, /UNKNOWN/, 'the outcome must be reported as unknown');
assert.match(failure.message, /do not resend/, 'the caller must be told not to resend');
assert.doesNotMatch(failure.message, /failed/, 'calling it a failure invites the resend this exists to prevent');
assert.ok(waited >= 150 && waited < 1000, `the budget should be honoured, waited ${waited}ms`);
assert.deepEqual(afterwards, { elements: [] }, 'one request giving up must not take the connection with it');
console.log('PROOF: GREEN');
