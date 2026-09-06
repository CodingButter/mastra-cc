// Public observation only, through the built daemon/client. No model or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connect } from '../../../packages/desktop/dist/index.mjs';
assert.equal(process.env.FIELD_PROOF_ISOLATED, '1');
const [socketPath, application, output] = process.argv.slice(2);
for (let i = 0; i < 80 && !fs.existsSync(socketPath); i++) await sleep(100);
const client = await connect({ socketPath });
try {
  const result = await client.queryElements({ application });
  assert.ok(result.elements.length > 0);
  fs.writeFileSync(output, JSON.stringify({ application, result }, null, 2) + '\n');
} finally { client.close(); }
