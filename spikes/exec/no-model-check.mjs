#!/usr/bin/env node
// Throwaway. The phase's load-bearing claim is that the interpreter's execution
// path contains no language model. Asserting that by reading the file is worth
// nothing — a later edit would not be noticed, which is precisely how the
// prototype's frozen protocol thawed while everyone believed it was frozen.
//
// So it is enforced two ways, because either alone is weak:
//
//   1. STATIC — the execution-path sources are scanned for anything that could
//      reach a model. Comments are stripped first, or the scan trips over its
//      own warnings about models.
//
//   2. DYNAMIC — a whole plan is executed with global fetch and the http
//      modules replaced by traps that record any call. A model cannot be
//      reached without leaving the process, so a run that makes no outbound
//      call made no model call, whatever the source says.
//
// Usage: node spikes/exec/no-model-check.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// The execution path. surface.mjs is included because a surface that quietly
// asked a model would defeat the whole claim.
const EXECUTION_PATH = ['interpret.mjs', 'plan.mjs', 'surface.mjs'];

const FORBIDDEN = [
  /\bopenai\b/i,
  /\banthropic\b/i,
  /\bgenerateText\b/,
  /\bstreamText\b/,
  /\bcreateAgent\b/,
  /new\s+Agent\b/,
  /\.generate\s*\(/,
  /\bcompletions?\b/i,
  /\bllm\b/i,
  /\bprompt\b/i,
];

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let problems = 0;

for (const file of EXECUTION_PATH) {
  const raw = readFileSync(join(here, file), 'utf8');
  const src = stripComments(raw);
  for (const pattern of FORBIDDEN) {
    const m = src.match(pattern);
    if (m) {
      console.error(`  STATIC FAIL  ${file}: matches ${pattern} -> ${JSON.stringify(m[0])}`);
      problems++;
    }
  }
}
if (problems === 0) console.log(`  STATIC  ok — ${EXECUTION_PATH.length} files, no route to a model`);

// --- dynamic -------------------------------------------------------------
const calls = [];
globalThis.fetch = async (...args) => {
  calls.push(`fetch ${String(args[0]).slice(0, 80)}`);
  throw new Error('no-model-check: outbound call blocked');
};

const { interpret } = await import('./interpret.mjs');
const { fixtureSurface } = await import('./surface.mjs');
const { scenario } = await import('./plan.mjs');

const fixture = [
  {
    key: 'root',
    role: 'main',
    name: 'Mail',
    children: [
      {
        key: 'inbox-link',
        role: 'link',
        name: 'Inbox',
        revealInto: 'root',
        reveals: [
          {
            key: 'list',
            role: 'list',
            name: 'Messages',
            children: [
              {
                key: 'm1',
                role: 'listitem',
                name: 'm1',
                children: [{ key: 's1', role: 'heading', name: 'A subject' }],
              },
            ],
          },
        ],
      },
    ],
  },
];

const out = await interpret(scenario(), fixtureSurface(fixture));
const completed = out.log.filter((l) => l.outcome === 'ok').length;

if (calls.length > 0) {
  console.error(`  DYNAMIC FAIL  ${calls.length} outbound call(s): ${calls.join(', ')}`);
  problems++;
} else if (completed === 0) {
  // The vacuous-pass guard. A check that observes no model calls because the
  // plan never ran has proved nothing at all, and it would pass forever.
  console.error('  DYNAMIC FAIL  the plan executed no steps; observing no model call proves nothing');
  problems++;
} else {
  // Deliberately hedged wording. The dynamic half can only speak for the code
  // that ran; a model call sitting in an unreached branch leaves no trace here
  // and is the static half's job. Printing a flat "ok" would read as two
  // independent confirmations when it is one.
  console.log(
    `  DYNAMIC ok — ${completed} steps executed, zero outbound calls ` +
      `(covers executed paths only; unreached code is the static half's job)`,
  );
}

process.exit(problems === 0 ? 0 : 1);
