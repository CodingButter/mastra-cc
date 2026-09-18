// CC-02, the adapter half: "an uncertain first attempt cannot become duplicate
// insertion through adapter retries".
//
// Built artifacts only: the real AtspiBackend over the recorded GTK dialog
// tape, a real daemon on a Unix socket, the real transport and the real
// Mastra tool. Keyboard emissions are counted at the D-Bus seam
// (GenerateKeyboardEvent), the one place a duplicate would have to appear.
//
// Two ways a layer above the backend could type twice, both counted:
//   UNVERIFIED: the backend answers with the text attempted and unverified
//               (ADR-0098) - a wrapper that read that as "failed" would retry.
//   LOST:       the re-read after the emission dies on the bus for one call
//               and the daemon has no result to give - a wrapper that caught
//               the error and tried again would find a working line.
//
//   node demo.mjs <checkout>
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const load = (path) => import(pathToFileURL(join(root, path)));
const { AtspiBackend, OwnershipTable, replayChannel, startServer } = await load('daemon/dist/index.mjs');
const { MastraCC } = await load('packages/desktop/dist/mastra.mjs');

function seam(dieOnce) {
  const tape = replayChannel('gtk-dialog');
  const generated = [];
  let emitted = false, died = false;
  const channel = {
    async call(exchange) {
      if (exchange.member === 'GenerateKeyboardEvent') { generated.push(exchange.body ?? []); emitted = true; return []; }
      if (exchange.member === 'GrabFocus') return [false];
      if (dieOnce && emitted && !died && exchange.member === 'GetRoleName') { died = true; throw new Error('org.freedesktop.DBus.Error.NoReply: the read-back never came'); }
      return tape.call(exchange);
    },
    watch: (s, k, a) => tape.watch(s, k, a),
    close: () => tape.close(),
  };
  return { channel, generated };
}

async function trial(name, dieOnce) {
  const socketPath = join(mkdtempSync(join(tmpdir(), 'cc02-adapter-')), 'daemon.sock');
  const launch = { permits: new Set(), allows: new Set(['observe', 'rawInput']), keys: { route: 'proof' }, catalog: {}, table: new OwnershipTable(), visibility: 'all' };
  const s = seam(dieOnce);
  const server = await startServer({ socketPath, backend: new AtspiBackend(s.channel, new Set(['yad'])), launch });
  const desk = new MastraCC({ socketPath });
  const tools = desk.getTools();
  const seen = await tools.queryElements.execute({}, {});
  const button = seen.elements.find((e) => e.role === 'button');
  assert.ok(button, 'the recorded dialog has a button');
  let outcome;
  try {
    const answer = await tools.typeText.execute({ id: button.id, text: 'example.com' }, {});
    outcome = { resolved: true, unverified: answer.element?.diagnostic?.['mastra-cc/typing-unverified'] !== undefined };
  } catch (error) {
    outcome = { resolved: false, error: String(error.message).slice(0, 80) };
  }
  await desk.close();
  await new Promise((r) => server.close(r));
  const emissions = s.generated.length;
  console.log(JSON.stringify({ trial: name, ...outcome, emissions, strings: s.generated }));
  return { ...outcome, emissions };
}

const unverified = await trial('UNVERIFIED', false);
const lost = await trial('LOST', true);
const pass = unverified.resolved && unverified.unverified && unverified.emissions === 1 && !lost.resolved && lost.emissions === 1;
console.log(pass ? 'PROOF: GREEN' : 'PROOF: RED');
process.exit(pass ? 0 : 1);
