import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { INSTRUCTIONS } from '../../../packages/desktop/dist/mastra.mjs';
import { validateTrial, validateBatchDeclaration } from './model-evidence.mjs';
const root = new URL('./', import.meta.url);
const batch = new URL('m.SQGqtM/', root);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const declaration = JSON.parse(fs.readFileSync(new URL('predeclared.json', batch)));
validateBatchDeclaration(declaration);
for (const trial of declaration.trials) {
  const directory = new URL(`${trial.id}/`, batch);
  const metadata = JSON.parse(fs.readFileSync(new URL('metadata.json', directory)));
  if (hash(INSTRUCTIONS) !== metadata.instructionsSha256) throw Error('Loaded instructions differ');
  for (const [path, expected] of Object.entries(metadata.artifactHashes)) {
    const actual = hash(fs.readFileSync(new URL(`../../../${path}`, root)));
    if (actual !== expected) throw Error(`Runtime differs: ${path}`);
    console.log(trial.id, path, actual);
  }
  console.log(trial.id, 'instructions', metadata.instructionsSha256, validateTrial(directory.pathname, {review:true, kind:trial.kind}).kind);
}
for (const [path, expected] of Object.entries(declaration.harnessHashes)) {
  const actual = hash(fs.readFileSync(new URL(path, root)));
  if (actual !== expected) throw Error(`Harness differs: ${path}`);
  console.log('harness', path, actual);
}
console.log('CURRENT: all six reviewed trials match runtime, loaded instructions and declared harness');
