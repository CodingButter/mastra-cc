import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const runner=fileURLToPath(new URL('../model-batch.mjs',import.meta.url));
for(const budget of ['0','23','25','33','NaN',''])test(`batch refuses undeclared budget ${JSON.stringify(budget)} before installing or creating evidence`,()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'budget-refusal-')),batch=path.join(root,'batch');
 try{const result=spawnSync(process.execPath,[runner,'--run',batch],{env:{...process.env,MOUSEPAD_MAX_STEPS:budget},encoding:'utf8',timeout:5000});assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,/unapproved step budget/);assert.equal(fs.existsSync(batch),false);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
