// Read-only public API assertions. Calibration is separate, setup-only evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const [root, run, side] = process.argv.slice(2);
assert.ok(path.isAbsolute(root));
assert.equal(process.env.FIELD_PROOF_ISOLATED, '1');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let client;
let setup = false;
try {
  const artifact = path.join(root, 'packages/desktop/dist/index.mjs');
  const { connect } = await import(pathToFileURL(artifact).href);
  const socketPath = path.join(run, 's');
  for (let i = 0; i < 80 && !fs.existsSync(socketPath); i++) await sleep(100);
  client = await connect({ socketPath });
  const result = await client.queryElements({ application: 'yad', role: 'text' });
  fs.writeFileSync(path.join(run, 'public.json'), JSON.stringify(result, null, 2));
  const values = JSON.parse(fs.readFileSync(path.join(run, 'calibration-values.json')));
  assert.equal(result.elements.length, 2);
  for (const value of Object.values(values)) {
    assert.equal(result.elements.filter(e => e.name === '' && e.content.kind === 'text' && e.content.value === value).length, 1);
  }
  const artifacts = ['daemon/dist/main.mjs', 'packages/desktop/dist/index.mjs', 'packages/protocol-types/src/index.ts'].map(relative => ({ path: path.join(root, relative), sha256: hash(fs.readFileSync(path.join(root, relative))) }));
  fs.writeFileSync(path.join(run, 'metadata.json'), JSON.stringify({ side, root, commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirtyDiffSha256: hash(execFileSync('git', ['-C', root, 'diff', 'HEAD'])), schemaSha256: hash(fs.readFileSync(path.join(root, 'protocol/schema.json'))), digestHandshake: 'connect succeeded with artifact-root client', artifacts }, null, 2));
  setup = true;
  console.log('SETUP_OK: matched hello and both unchanged unnamed calibrated fields');
  if (side === 'base' && result.elements.every(e => !Object.hasOwn(e, 'labelObservation'))) {
    console.log('BASE_RED: expected explicit labelObservation is missing');
    process.exitCode = 0;
  } else {
    for (const [label, value] of Object.entries(values)) {
      const field = result.elements.find(e => e.content.kind === 'text' && e.content.value === value);
      assert.deepEqual(field.labelObservation, { kind: 'available', labels: [label] });
    }
    assert.equal(side, 'candidate', 'base unexpectedly exposes the expected labels');
    console.log('CANDIDATE_GREEN: explicit associations match independently calibrated fields');
  }
} catch (error) {
  console.error(setup ? 'PROOF_FAILURE' : 'INVALID_SETUP', error);
  process.exitCode = 1;
} finally { client?.close(); }
