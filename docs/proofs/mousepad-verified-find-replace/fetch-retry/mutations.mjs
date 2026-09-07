import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync(new URL('../model-rate.mjs',import.meta.url),'utf8'),tests=fs.readFileSync(new URL('./fetch-retry.test.mjs',import.meta.url),'utf8');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'fetch-mutants-'));fs.mkdirSync(`${root}/fetch-retry`);fs.writeFileSync(`${root}/fetch-retry/fetch-retry.test.mjs`,tests);
try {
 for(const [name,from,to] of [['no retry','retryBeforeResponse:true','retryBeforeResponse:false'],['unbounded retry','attempt>=RATE_POLICY.retries','attempt>=99'],['no pacing','next=startedMs+RATE_POLICY.intervalMs','next=startedMs']]){
  assert.ok(source.includes(from));fs.writeFileSync(`${root}/model-rate.mjs`,source.replaceAll(from,to));
  const r=spawnSync(process.execPath,['--test',`${root}/fetch-retry/fetch-retry.test.mjs`],{encoding:'utf8',timeout:10000});assert.equal(r.error,undefined,'timeout/runner failure is not a caught mutation');assert.equal(r.status,1);assert.match(r.stdout,/AssertionError|ERR_ASSERTION/);console.log(`caught: ${name}`);
 }
 fs.writeFileSync(`${root}/model-rate.mjs`,source);const r=spawnSync(process.execPath,['--test',`${root}/fetch-retry/fetch-retry.test.mjs`],{encoding:'utf8',timeout:10000});assert.equal(r.status,0);console.log('GREEN: 3 mutations caught in scratch copies; workspace source never modified');
}finally{fs.rmSync(root,{recursive:true,force:true});}
