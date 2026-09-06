import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const uncooperative = process.argv.includes('--uncooperative');
const artifact = resolve(process.argv.slice(2).find((arg) => arg !== '--uncooperative') ?? process.env.TRANSPORT_ARTIFACT ?? `${root}/packages/transport/dist/index.mjs`);
console.log(`ARTIFACT ${artifact}\nSHA256 ${createHash('sha256').update(await readFile(artifact)).digest('hex')}\nRUNTIME ${process.version}`);
const { connect, TransportConnectionError } = await import(pathToFileURL(artifact).href);
const require = createRequire(`${root}/packages/transport/package.json`);
const { WebSocketServer } = require('ws');
const timers = new Set();
const servers = new Set();
const sockets = new Set();
const clients = new Set();
const directory = await mkdtemp(`${tmpdir()}/startup-proof-`);
const delay = (ms) => new Promise((resolve) => {
  const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms);
  timers.add(timer);
});
async function capped(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
      timers.add(timer);
    })]);
  } finally { clearTimeout(timer); timers.delete(timer); }
}
function track(socket, state) {
  sockets.add(socket);
  socket.on('error', () => {});
  socket.on('close', () => { sockets.delete(socket); state.closed = true; state.closedAt = performance.now(); });
}
async function peer(kind, healthy = false) {
  const state = { closed: false, accepted: 0, requests: [], hellos: 0, lateAttempts: 0 };
  let late = () => { throw new Error('peer never accepted client traffic'); };
  const wss = new WebSocketServer({ noServer: true });
  const receive = (text, send) => {
    for (const line of text.split('\n').filter(Boolean)) {
      const message = JSON.parse(line);
      if (message.type === 'hello') {
        state.hellos++;
        late = () => { state.lateAttempts++; send(`${JSON.stringify({ type: 'hello', digest: message.digest })}\n`); };
        if (healthy) late();
      } else {
        state.requests.push(message);
        if (healthy) send(`${JSON.stringify({ type: 'response', id: message.id, result: { applications: [] } })}\n`);
      }
    }
  };
  wss.on('connection', (ws) => {
    ws.on('error', () => {});
    ws.on('message', (data) => receive(data.toString(), (line) => ws.send(line, () => {})));
  });
  const server = net.createServer((socket) => {
    state.accepted++;
    track(socket, state);
    let buffer = '';
    const read = (chunk) => {
      buffer += chunk.toString(kind === 'unix' ? 'utf8' : 'latin1');
      if (kind === 'unix') {
        const end = buffer.lastIndexOf('\n');
        if (end >= 0) { receive(buffer.slice(0, end + 1), (line) => socket.write(line, () => {})); buffer = buffer.slice(end + 1); }
      } else if (buffer.includes('\r\n\r\n')) {
        socket.off('data', read);
        const key = /Sec-WebSocket-Key: (.+)\r\n/i.exec(buffer)?.[1];
        assert.ok(key, 'received real WebSocket upgrade request');
        const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
        late = () => {
          state.lateAttempts++;
          socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`, () => {});
        };
        if (kind === 'uncooperative') {
          late();
          let frames = Buffer.from(buffer.slice(buffer.indexOf('\r\n\r\n') + 4), 'latin1');
          let fragments = [];
          const consume = (chunk) => {
            frames = Buffer.concat([frames, chunk]);
            while (frames.length >= 2) {
              const opcode = frames[0] & 15;
              const masked = (frames[1] & 128) !== 0;
              let length = frames[1] & 127;
              let header = 2;
              if (length === 126) {
                if (frames.length < 4) return;
                length = frames.readUInt16BE(2); header = 4;
              } else if (length === 127) {
                if (frames.length < 10) return;
                const size = frames.readBigUInt64BE(2);
                assert.ok(size <= BigInt(Number.MAX_SAFE_INTEGER));
                length = Number(size); header = 10;
              }
              const end = header + (masked ? 4 : 0) + length;
              if (frames.length < end) return;
              assert.ok(masked, 'client WebSocket frames must be masked');
              if (opcode === 0 || opcode === 1 || opcode === 2) {
                const payload = Buffer.from(frames.subarray(header + 4, end));
                for (let i = 0; i < payload.length; i++) payload[i] ^= frames[header + (i % 4)];
                fragments.push(payload);
                if (frames[0] & 128) {
                  receive(Buffer.concat(fragments).toString('utf8'), () => {});
                  fragments = [];
                }
              }
              if (opcode === 8) state.closeFrameAt = performance.now();
              frames = frames.subarray(end);
            }
          };
          socket.on('data', consume);
          consume(Buffer.alloc(0));
        } else if (kind !== 'raw') {
          const upgrade = () => {
            const headers = Object.fromEntries(buffer.split('\r\n').slice(1).filter((line) => line.includes(':')).map((line) => {
              const colon = line.indexOf(':'); return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
            }));
            wss.handleUpgrade({ method: 'GET', headers, url: '/' }, socket, Buffer.alloc(0), (ws) => wss.emit('connection', ws));
          };
          if (kind === 'delayed-ws') void delay(4000).then(upgrade);
          else upgrade();
        } else socket.on('data', (data) => state.requests.push({ unexpectedBytes: data.length }));
      }
    };
    socket.on('data', read);
  });
  servers.add({ server, wss });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(kind === 'unix' ? `${directory}/peer-${servers.size}.sock` : { host: '127.0.0.1', port: 0 }, resolve);
  });
  const options = kind === 'unix' ? { socketPath: server.address() } : { url: `ws://127.0.0.1:${server.address().port}` };
  return { state, options, late: () => late() };
}
async function stalled(kind) {
  const p = await peer(kind);
  const start = performance.now();
  let fulfilled = false;
  const outcome = connect(p.options).then((client) => {
    fulfilled = true; clients.add(client); return { client };
  }, (error) => ({ error, elapsed: performance.now() - start }));
  const result = await capped(outcome, 13000, `ASSERTION FAILED [${kind}]: connect did not reject by deadline (13000ms cap)`);
  assert.ok(result.error instanceof TransportConnectionError, `${kind}: rejection must be TransportConnectionError`);
  assert.ok(result.elapsed >= 9000 && result.elapsed <= 13000, `${kind}: elapsed ${result.elapsed.toFixed(0)}ms outside 9000–13000ms`);
  assert.equal(p.state.accepted, 1, `${kind}: exactly one connection; no automatic retry`);
  if (kind !== 'raw') assert.equal(p.state.hellos, 1, `${kind}: client sent schema hello`);
  await capped((async () => { while (!p.state.closed) await delay(20); })(), 1500, `${kind}: server did not observe connection closed`);
  p.late();
  await delay(150);
  assert.equal(p.state.lateAttempts, 1);
  assert.equal(await outcome, result, `${kind}: late activity changed settlement`);
  assert.equal(fulfilled, false, `${kind}: late activity rescued connection`);
  assert.deepEqual(p.state.requests, [], `${kind}: requests/effects must not be dispatched`);
  console.log(`PASS ${kind}: TransportConnectionError in ${result.elapsed.toFixed(0)}ms; peer closed; no requests/retry; late activity cannot rescue`);
}
async function probeUncooperative() {
  const p = await peer('uncooperative');
  const start = performance.now();
  const result = await capped(connect(p.options).then((client) => {
    clients.add(client); return { client };
  }, (error) => {
    const rejectedAt = performance.now();
    return { error, rejectedAt, elapsed: rejectedAt - start };
  }), 13000, 'uncooperative: caller did not reject within 13s');
  console.log(`OBSERVED uncooperative caller rejection: ${result.elapsed?.toFixed(0) ?? 'none'}ms`);
  assert.ok(result.error instanceof TransportConnectionError);
  assert.ok(result.elapsed >= 9000 && result.elapsed <= 13000);
  while (!p.state.closed && performance.now() - result.rejectedAt < 1500) await delay(20);
  console.log(`OBSERVED uncooperative close frame: ${p.state.closeFrameAt === undefined ? 'not received (allowed)' : `${(p.state.closeFrameAt - start).toFixed(0)}ms`}; underlying TCP close: ${p.state.closed ? `${(p.state.closedAt - result.rejectedAt).toFixed(0)}ms after rejection` : 'NOT observed within 1500ms after rejection'} (before harness cleanup)`);
  assert.ok(p.state.closed && p.state.closedAt - result.rejectedAt <= 1500, 'uncooperative: underlying TCP must close within 1.5s after rejection, before harness cleanup');
  assert.equal(p.state.accepted, 1, 'uncooperative: no automatic retry');
  assert.equal(p.state.hellos, 1, 'uncooperative: exactly one decoded schema hello');
  assert.deepEqual(p.state.requests, [], 'uncooperative: no decoded application requests');
  console.log('PASS uncooperative: bounded rejection AND TCP close; no requests/retry; peer never replies to WebSocket frames');
}
async function healthy(kind) {
  const p = await peer(kind, true);
  const client = await capped(connect(p.options), 2000, 'fresh healthy connect stalled');
  clients.add(client);
  assert.deepEqual(await capped(client.listApplications(), 2000, 'initial request stalled'), { applications: [] });
  await delay(10500);
  assert.deepEqual(await capped(client.listApplications(), 2000, 'request after startup deadline stalled'), { applications: [] });
  assert.deepEqual(p.state.requests.map((request) => request.method), ['listApplications', 'listApplications']);
  assert.equal(p.state.closed, false);
  console.log(`PASS ${kind} explicit fresh-connect recovery: matching digest; listApplications before and after 10.5s; startup deadline cleared`);
}
let exitCode = 0;
try {
  if (uncooperative) await probeUncooperative();
  else {
    for (const kind of ['unix', 'raw', 'ws', 'delayed-ws']) await stalled(kind);
    await Promise.all([probeUncooperative(), ...['unix', 'ws'].map(healthy)]);
    console.log('PASS all startup assertions (transport peers only; no desktop effects)');
  }
} catch (error) {
  exitCode = 1;
  console.error(`FAIL ${error.stack ?? error}`);
} finally {
  for (const client of clients) client.close();
  for (const timer of timers) clearTimeout(timer);
  for (const { wss } of servers) for (const ws of wss.clients) ws.terminate();
  for (const socket of sockets) socket.destroy();
  const cleanup = Promise.all([...servers].flatMap(({ server, wss }) => [
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => wss.close(resolve)),
  ])).then(() => rm(directory, { recursive: true, force: true }));
  if (exitCode !== 0) {
    // Only a failed negative control may force exit despite retained handles.
    try { await capped(cleanup, 1000, 'failure cleanup exceeded 1s'); }
    finally { process.exit(exitCode); }
  }
  await cleanup;
  console.log('CLEANUP complete; awaiting natural process exit (outer timeout detects retained handles)');
}
