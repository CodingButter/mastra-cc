import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),file=path.join(root,'daemon/src/backends/atspi/channel.ts'),original=fs.readFileSync(file,'utf8');
const needle='    wire.includes("disconnected from message bus")\n  );';
assert.equal(original.split(needle).length,2);
const test='src/__tests__/one-application-that-died-is-not-a-desk-that-died.test.ts';
const report=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'reopen-timeout-mutation-')),'report.json');
try {
 fs.writeFileSync(file,original.replace(needle,'    wire.includes("disconnected from message bus") || wire.includes("org.freedesktop.DBus.Error.NoReply")\n  );'));
 const run=spawnSync(path.join(root,'tools/node_modules/.bin/vitest'),['run',test,'--reporter=json','--outputFile',report],{cwd:path.join(root,'daemon'),encoding:'utf8',timeout:30000});
 assert.equal(run.error,undefined);assert.equal(run.signal,null);
 const results=JSON.parse(fs.readFileSync(report,'utf8'));
 assert.ok(results.testResults.flatMap(t=>t.assertionResults).some(t=>t.status==='failed'&&t.title==='does not infer process death from an unanswered or timed-out call'));
 console.log('RED: restoring bare-NoReply peer death fails the targeted timeout assertion');
} finally {fs.writeFileSync(file,original);}
const green=spawnSync(path.join(root,'tools/node_modules/.bin/vitest'),['run',test],{cwd:path.join(root,'daemon'),encoding:'utf8',timeout:30000});
assert.equal(green.error,undefined);assert.equal(green.status,0,green.stdout+green.stderr);
console.log('GREEN: restored classifier passes the complete peer-death suite');
