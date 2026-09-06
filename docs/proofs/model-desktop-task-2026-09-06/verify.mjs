#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

try {
  if (process.argv.length !== 3) throw new Error('Usage: node verify.mjs RUN');
  const run = process.argv[2];
  const expected = JSON.parse(readFileSync(join(run, 'expected.json'), 'utf8'));
  if (!/^RCPT-[0-9a-f]{8}$/.test(expected.receiptNumber) ||
      typeof expected.totalPaid !== 'string' || !/^\d+\.\d{2}$/.test(expected.totalPaid)) {
    throw new Error('Invalid fixture expectations');
  }
  const submission = readFileSync(join(run, 'submission.txt'));
  const wanted = Buffer.from(`${expected.receiptNumber}|${expected.totalPaid}|\n`);
  if (!submission.equals(wanted)) {
    throw new Error('Submission must exactly match both printed values and contain no extra output');
  }
  console.log('PASS: actual submission exactly matches independent fixture expectations');
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
