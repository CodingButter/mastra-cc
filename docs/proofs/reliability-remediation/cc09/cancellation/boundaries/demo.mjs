// CC-09 boundaries inside single-call effects and the capture subprocess.
// A chord, a string, a press are one registry call each; nothing stops them
// mid-call, but each has a boundary BEFORE it: a driver that closed while
// the aim was under way is answered with nothing sent. A screen grab is a
// look, not an emission: the child is killed when the driver closes.
// Real daemon over a real Unix socket (built artifacts); scripted registry
// so the demo can count emissions; a fake xwd that would take 30 s.
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2] ?? '.');
const { AtspiBackend, replayChannel, startServer, OwnershipTable } = await import(pathToFileURL(join(root, 'daemon/dist/index.mjs')));
const { SCHEMA_DIGEST } = await import(pathToFileURL(join(root, 'packages/protocol-types/dist/index.js')));

const dir = mkdtempSync(join(tmpdir(), 'cc09-boundaries-'));
writeFileSync(join(dir, 'xwd'), '#!/bin/sh\nsleep 30\n', { mode: 0o700 });
process.env.PATH = `${dir}:${process.env.PATH}`;
process.env.DISPLAY = ':cc09-boundaries';

const tape = replayChannel('gtk-dialog');
const sent = [];
let releaseFocus;
let focusHeld = new Promise((r) => { releaseFocus = r; });
const backend = new AtspiBackend({
  async call(x) {
    if (x.member === 'GrabFocus') { await focusHeld; return [true]; }
    if (x.member === 'GenerateKeyboardEvent' || x.member === 'GenerateMouseEvent') { sent.push(x.member); return []; }
    if (x.member === 'GetExtents') return [[10, 10, 40, 30]];
    if (x.member === 'ScrollTo') return [];
    return tape.call(x);
  },
  watch: (a, b, c) => tape.watch(a, b, c), close: () => tape.close(),
}, 'all');

const socketPath = join(dir, 'daemon.sock');
const launch = { permits: new Set(), allows: new Set(['rawInput']), keys: { route: 'proof' }, catalog: {}, table: new OwnershipTable(), visibility: 'all' };
const server = await startServer({ socketPath, backend, launch });
const stderrLines = [];
const origError = console.error; console.error = (line) => { stderrLines.push(String(line)); };

async function peer() {
  const messages = []; let buffer = '', id = 0;
  const socket = createConnection(socketPath);
  socket.on('data', (d) => { buffer += d; let e; while ((e = buffer.indexOf('\n')) >= 0) { messages.push(JSON.parse(buffer.slice(0, e))); buffer = buffer.slice(e + 1); } });
  await new Promise((res, rej) => { socket.once('connect', res); socket.once('error', rej); });
  const wait = async (p) => { for (;;) { const m = messages.find(p); if (m) return m; await new Promise((r) => setTimeout(r, 2)); } };
  socket.write(JSON.stringify({ type: 'hello', digest: SCHEMA_DIGEST }) + '\n'); await wait((m) => m.type === 'hello');
  return { close: () => socket.destroy(), request(method, params = {}) { const rid = ++id; socket.write(JSON.stringify({ type: 'request', id: rid, method, params }) + '\n'); return wait((m) => m.id === rid); } };
}

try {
  const observer = await peer();
  const { result } = await observer.request('queryElements', { role: 'label' });
  const id = result.elements[0].id;
  observer.close();

  // 1. A chord whose driver closes during the focus grab: nothing sent.
  let a = await peer();
  void a.request('sendKeyChord', { id, chord: 'Escape' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 30));
  a.close();
  await new Promise((r) => setTimeout(r, 10));
  releaseFocus();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(sent, [], 'a chord aimed for a closed driver was sent');
  const stopped = stderrLines.find((l) => /sendKeyChord stopped before its first emission/.test(l));
  assert(stopped, `daemon did not log the pre-emission stop: ${JSON.stringify(stderrLines)}`);
  console.log(JSON.stringify({ case: 'chord: driver closed during the aim', sent: sent.length, daemon: stopped.replace(/^daemon: /, '') }));

  // 2. A screen grab whose driver closes mid-grab: the 30 s child is killed.
  focusHeld = Promise.resolve();
  const b = await peer();
  const started = Date.now();
  void b.request('captureElement', { id }).catch(() => {});
  await new Promise((r) => setTimeout(r, 50));
  b.close();
  const deadline = Date.now() + 3000;
  let logged;
  while (Date.now() < deadline && !(logged = stderrLines.find((l) => /captureElement stopped before its first emission/.test(l)))) await new Promise((r) => setTimeout(r, 5));
  const elapsed = Date.now() - started;
  assert(logged, `the grab was not stopped within 3 s: ${JSON.stringify(stderrLines)}`);
  assert(elapsed < 3000, `grab took ${elapsed} ms`);
  console.log(JSON.stringify({ case: 'capture: driver closed mid-grab (fake xwd sleeps 30 s)', stoppedAfterMs: elapsed, daemon: logged.replace(/^daemon: /, '') }));

  // 3. A successor is admitted afterwards and its chord is sent.
  const c = await peer();
  const answer = await c.request('sendKeyChord', { id, chord: 'Escape' });
  assert.equal(answer.refusal, undefined, `successor refused: ${answer.refusal}`);
  assert.deepEqual(sent, ['GenerateKeyboardEvent']);
  c.close();
  console.log(JSON.stringify({ case: 'successor after both', sent: sent.length }));
  console.log('PROOF: GREEN — a driver that closed during the aim gets no emission; a screen grab is killed when its driver closes; a successor is admitted; real daemon over a real socket, scripted registry');
} catch (error) {
  console.log(`PROOF: RED — ${error.message}`); process.exitCode = 1;
} finally {
  console.error = origError;
  await backend.close(); server.close(); rmSync(dir, { recursive: true, force: true });
  setTimeout(() => process.exit(), 200).unref();
}
