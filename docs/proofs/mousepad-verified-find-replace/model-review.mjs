import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateTrace } from './model-evidence.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function inside(root, file) {
  const real = fs.realpathSync(file);
  assert.ok(real.startsWith(fs.realpathSync(root) + path.sep), `path escapes root: ${file}`);
  return real;
}
export function checked(root, record) {
  assert.ok(record && typeof record.path === 'string' && /^[a-f0-9]{64}$/.test(record.sha256), 'missing artifact hash');
  const file = inside(root, path.resolve(root, record.path));
  assert.equal(digest(fs.readFileSync(file)), record.sha256, `artifact hash mismatch: ${record.path}`);
  return file;
}
export function validateVisual(dir, review, trace, trial) {
  assert.equal(review.trialId, trial.id, 'review trial mismatch');
  assert.ok(typeof review.reviewer === 'string' && review.reviewer.trim(), 'missing reviewer');
  const inspected = Date.parse(review.inspectedAt);
  const ended = Number(fs.readFileSync(`${dir}/session-ended-ms.txt`, 'utf8'));
  assert.ok(Number.isFinite(ended) && ended > 0 && Number.isFinite(inspected) && inspected >= ended && inspected <= Date.now(), 'inspection must follow capture');
  assert.equal(review.eventsSha256, digest(fs.readFileSync(`${dir}/events.jsonl`)), 'review journal mismatch');
  assert.equal(review.trialSha256, digest(fs.readFileSync(`${dir}/trial.json`)), 'review declaration mismatch');
  assert.equal(review.savedSha256, digest(fs.readFileSync(`${dir}/document.txt`)), 'review saved bytes mismatch');
  assert.equal(review.verificationCall, trace.verification, 'review verification call mismatch');
  assert.deepEqual(review.limitations, [], 'unresolved review limitations');
  assert.equal(review.recording?.path, 'screen.mkv', 'missing recording');
  const media = [checked(dir, review.recording)];
  assert.deepEqual(review.checkpoints?.map(c => c.stage), ['pre-action', 'filled', 'result', 'verified'], 'missing checkpoints');
  const seen = new Set();
  for (const checkpoint of review.checkpoints) {
    const file = checked(dir, checkpoint); assert.ok(!seen.has(file), 'aliased checkpoints'); seen.add(file); media.push(file);
    assert.ok(typeof checkpoint.comparison === 'string' && checkpoint.comparison.trim(), 'missing checkpoint comparison');
    assert.equal(checkpoint.matches, true, 'checkpoint mismatch');
    if (checkpoint.stage === 'filled') {
      assert.equal(checkpoint.searchValue, trial.source); assert.equal(checkpoint.replacementValue, trial.replacement);
    }
    if (checkpoint.stage === 'verified') assert.equal(checkpoint.evidenceCall, trace.verification);
  }
  for (const file of media) assert.ok(fs.statSync(file).mtimeMs <= inspected, 'inspection predates media');
  return 'COMPLETE';
}
export function reviewBatch(batch, root) {
  batch = fs.realpathSync(batch);
  const declaration = json(`${batch}/declaration.json`);
  assert.deepEqual(declaration.trials.map(t => t.id), ['t1', 't2', 't3'], 'exactly three distinct trial IDs');
  const dirs = declaration.trials.map(t => inside(batch, `${batch}/${t.id}`));
  assert.equal(new Set(dirs).size, 3, 'aliased trial directories');
  const required = ['daemon/dist/main.mjs', 'protocol/schema.json', 'pnpm-lock.yaml', 'packages/desktop/instructions/AGENT-INSTRUCTIONS.md',
    ...fs.readdirSync(path.join(root, 'docs/proofs/mousepad-verified-find-replace')).filter(f => /\.(mjs|sh)$/.test(f)).map(f => `docs/proofs/mousepad-verified-find-replace/${f}`)];
  for (const file of required) checked(root, {path: file, sha256: declaration.artifacts[file]});
  for (const [file, sha256] of Object.entries(declaration.artifacts)) checked(root, {path: file, sha256});
  assert.equal(digest(fs.readFileSync(`${batch}/installed/consumer-lock.json`)), declaration.consumerLockSha256, 'consumer lock changed');
  const results = declaration.trials.map((trial, i) => {
    const dir = dirs[i];
    assert.deepEqual(json(`${dir}/trial.json`), trial, 'actual trial differs from declaration');
    assert.equal(trial.kind, 'mousepad-literal-replacement'); assert.equal(trial.count, 3);
    assert.equal(trial.segments.length, 4);
    for (const [file, value, sha] of [['before.txt', trial.segments.join(trial.source), trial.beforeSha256], ['expected.txt', trial.segments.join(trial.replacement), trial.expectedSha256]]) {
      assert.equal(fs.readFileSync(`${dir}/${file}`, 'utf8'), value); assert.equal(digest(Buffer.from(value)), sha);
    }
    const metadata = json(`${dir}/metadata.json`);
    assert.equal(metadata.handshake, 'accepted');
    assert.equal(metadata.instructionsSha256, declaration.artifacts['packages/desktop/instructions/AGENT-INSTRUCTIONS.md'], 'stale loaded instructions');
    for (const [key, value] of Object.entries({model:'google/gemini-2.5-flash', temperature:0, maxSteps:24, modelDeadlineMs:180000})) {
      assert.equal(metadata[key], value); assert.equal(declaration[key], value);
    }
    const consumer = inside(batch, `${batch}/installed/consumer`);
    assert.equal(fs.realpathSync(metadata.consumer), consumer);
    for (const name of ['@mastra-cc/desktop','@mastra-cc/desktop/mastra','@mastra/core/agent','@mastra-cc/transport','@mastra-cc/protocol-types']) inside(consumer, metadata.imports[name]);
    const attempt = json(`${dir}/attempt.json`); assert.equal(attempt.code, 0, 'failed model'); assert.equal(attempt.reason, null, 'resource-invalid');
    const events = fs.readFileSync(`${dir}/events.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(events.some(e => e.event === 'model-started' && e.time >= declaration.created), 'model must start after declaration');
    const trace = validateTrace(events, trial, fs.readFileSync(`${dir}/document.txt`), fs.readFileSync(`${dir}/expected.txt`));
    const result = {trialId:trial.id, machine:trace.machine, independentOracle:trace.oracle, visual:'REVIEW_PENDING', humanApproval:'PENDING'};
    if (fs.existsSync(`${dir}/review.json`)) {
      const review = json(`${dir}/review.json`);
      assert.equal(review.batchDeclarationSha256, digest(fs.readFileSync(`${batch}/declaration.json`)), 'review runtime/harness declaration mismatch');
      assert.equal(review.metadataSha256, digest(fs.readFileSync(`${dir}/metadata.json`)), 'review metadata mismatch');
      result.visual = validateVisual(dir, review, trace, trial);
    }
    return result;
  });
  return {verdict:results.every(r => r.visual === 'COMPLETE') ? 'GREEN' : 'REVIEW_PENDING', results, humanApproval:'PENDING'};
}
