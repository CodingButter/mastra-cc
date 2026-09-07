// Missing-observation proof only; native calibration performs edits, never a model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [run, installation, side] = process.argv.slice(2);
try {
  assert.ok(['candidate', 'base'].includes(side));
  execFileSync(process.execPath, [path.join(here, 'inspect-evidence.mjs'), run, installation], { stdio: 'inherit' });
  console.log('SETUP_OK: installed imports, matching handshake, native calibration and saved/public readback');
  const stages = ['dialog', 'filled', 'recreated-dialog'];
  let missing = 0;
  const ledger = [];
  for (const stage of stages) {
    const events = JSON.parse(fs.readFileSync(path.join(run, `${stage}-public.json`)));
    const query = events.find(e => e.type === 'call' && e.name === 'queryElements' && e.arguments.role === 'text');
    assert.ok(query);
    const result = events.find(e => e.type === 'result' && e.call === query.call);
    assert.ok(result?.result.elements?.length >= 3, 'public editable controls must actually be present');
    const available = result.result.elements.filter(e => e.compositeObservation?.kind === 'available');
    if (side === 'base') {
      assert.ok(result.result.elements.every(e => !Object.hasOwn(e, 'compositeObservation')), 'base must omit the new observation, not fail or report unavailable');
      missing++;
      continue;
    }
    assert.equal(available.length, 2);
    for (const label of ['Search for:', 'Replace with:']) {
      const elements = available.filter(e => e.compositeObservation.label === label);
      assert.equal(elements.length, 1);
      const element = elements[0];
      assert.deepEqual(element.labelObservation, { kind: 'available', labels: [] });
      assert.deepEqual(element.compositeObservation, { kind: 'available', provenance: 'immediate-combo-parent', parentRole: 'combo box', relation: 'labelled-by', label, immediateChildCount: 2, editableChildCount: 1, siblingRole: 'menu' });
      const read = events.find(e => e.type === 'call' && e.call > query.call && e.name === 'readElementContent' && e.arguments.id === element.id);
      assert.ok(read, 'publicly discovered ID must receive an actual content read');
      const answer = events.find(e => e.type === 'result' && e.call === read.call);
      assert.equal(answer.result.content.kind, 'text');
      if (stage === 'filled') assert.equal(answer.result.content.value, label === 'Search for:' ? 'TOKEN_41' : 'VALUE_73');
      ledger.push({ stage, label, id: element.id, queryCall: query.call, readCall: read.call });
    }
  }
  if (side === 'base') assert.equal(missing, stages.length);
  const verdict = side === 'base' ? 'BASE_RED' : 'CANDIDATE_GREEN';
  fs.writeFileSync(path.join(run, 'deterministic.json'), JSON.stringify({ verdict, claim: 'explicit bounded composite observation delivery, not general task impossibility or agent completion', ledger }, null, 2));
  console.log(`${verdict}: bounded composite observation ${side === 'base' ? 'absent after valid setup' : 'delivered through installed generated tools'}`);
} catch (error) {
  console.error(`INVALID_OR_VERIFICATION_FAILURE: ${error.message}; never causal RED`);
  process.exitCode = 1;
}
