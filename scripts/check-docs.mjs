#!/usr/bin/env node
/**
 * Gate for the documents in this repository.
 *
 * Checked in, not run by hand from somewhere else — the same rule the documents
 * themselves state (ADR-0001). Node, with no dependency, because the repository
 * ships no Python and a gate should not be the one thing that drags a second
 * runtime into CI (ADR-0030).
 *
 * Three checks:
 *   links     every relative markdown link resolves to a file on disk
 *   index     every ADR file is listed in the ADR index, and vice versa
 *   coverage  every numbered doc named in the README exists
 *
 * Exit 0 when clean, 1 with a report otherwise.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const FENCE = /```[\s\S]*?```/g;

// Directories whose markdown is not ours to check. `.git` and `.mastracode`
// are bookkeeping; `node_modules` is other people's documentation, and their
// dead links are their business — scanning it turns this gate into a report on
// five hundred dependency READMEs and buries any real problem.
const SKIP_DIRS = new Set(['.git', '.mastracode', 'node_modules']);

function markdownFiles(dir = ROOT, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) markdownFiles(join(dir, entry.name), found);
    } else if (entry.name.endsWith('.md')) {
      found.push(join(dir, entry.name));
    }
  }
  return found.sort();
}

function linkTargets(body) {
  return [...body.matchAll(LINK)].map((m) => m[1]);
}

function checkLinks(files) {
  const problems = [];
  for (const path of files) {
    const body = readFileSync(path, 'utf8').replace(FENCE, '');
    for (const target of linkTargets(body)) {
      if (/^(https?:\/\/|mailto:|#)/.test(target)) continue;
      const filePart = target.split('#')[0];
      if (!filePart) continue;
      if (!existsSync(resolve(dirname(path), filePart))) {
        problems.push(`${relative(ROOT, path)}: dead link -> ${target}`);
      }
    }
  }
  return problems;
}

function checkAdrIndex() {
  const decisions = join(ROOT, 'docs', '02-DECISIONS');
  const index = join(decisions, 'README.md');
  if (!existsSync(index)) return [`missing ADR index: ${relative(ROOT, index)}`];

  const onDisk = new Set(
    readdirSync(decisions).filter((n) => /^\d{4}-.*\.md$/.test(n)),
  );
  const listed = new Set(
    linkTargets(readFileSync(index, 'utf8'))
      .map((t) => t.split('#')[0])
      .filter((t) => /^\d{4}-[a-z0-9-]+\.md$/.test(t)),
  );

  const problems = [];
  for (const name of [...onDisk].filter((n) => !listed.has(n)).sort()) {
    problems.push(`ADR not listed in index: ${name}`);
  }
  for (const name of [...listed].filter((n) => !onDisk.has(n)).sort()) {
    problems.push(`index lists a missing ADR: ${name}`);
  }

  const numbers = [...onDisk].map((n) => Number(n.slice(0, 4))).sort((a, b) => a - b);
  const expected = numbers.map((_, i) => i + 1);
  if (numbers.join() !== expected.join()) {
    problems.push(`ADR numbering has a gap or a duplicate: ${numbers.join(', ')}`);
  }
  return problems;
}

function checkCoverage() {
  const required = [
    'docs/00-PRODUCT.md',
    'docs/01-ARCHITECTURE.md',
    'docs/02-DECISIONS/README.md',
    'docs/03-LESSONS.md',
    'docs/04-INTEGRATION-PLAN.md',
    'docs/05-TEST-STRATEGY.md',
    'docs/06-OPERATIONS.md',
    'docs/07-ROADMAP.md',
    'docs/08-GLOSSARY.md',
    'README.md',
    'CONTRIBUTING.md',
  ];
  return required
    .filter((r) => !existsSync(join(ROOT, r)))
    .map((r) => `missing required document: ${r}`);
}

const files = markdownFiles();
if (files.length === 0) {
  console.log('check-docs: found no markdown files - the check itself is broken');
  process.exit(1);
}

const problems = [...checkCoverage(), ...checkLinks(files), ...checkAdrIndex()];
if (problems.length > 0) {
  console.log(`check-docs: ${problems.length} problem(s) across ${files.length} files\n`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}

console.log(`check-docs: ok - ${files.length} files, every relative link resolves`);
