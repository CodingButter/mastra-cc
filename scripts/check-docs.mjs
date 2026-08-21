#!/usr/bin/env node
/**
 * Gate for the documents in this repository.
 *
 * Checked in, not run by hand from somewhere else — the same rule the documents
 * themselves state (ADR-0001). Node, with no dependency, because the repository
 * ships no Python and a gate should not be the one thing that drags a second
 * runtime into CI (ADR-0030).
 *
 * Five checks — `index` reports both a missing entry and a gap or duplicate in
 * the ADR numbering, and each was proven to fail on purpose (the first three
 * before the Python original was deleted, `proofs` when issue #16 closed,
 * `citations` against the four sites M3's review found by hand):
 *   links     every relative markdown link resolves to a file on disk
 *   index     every ADR file is listed in the ADR index, and vice versa,
 *             and the numbering is contiguous
 *   coverage  every numbered doc named in the README exists
 *   proofs    every artifact in docs/proofs/ is listed in the proofs index
 *   citations a document naming a JSON file and a name beside it must not
 *             cite a name that file has never contained
 *
 * Known limits, both of which fail loudly rather than passing vacuously: a link
 * target containing a closing parenthesis is truncated at it, and an unclosed
 * code fence stops fence-stripping so its remaining content is read as prose.
 * Either produces a reported dead link, never a silent skip.
 *
 * Exit 0 when clean, 1 with a report otherwise.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
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

// Symlinks are followed rather than skipped, so a linked-in directory of
// documents is still checked; `seen` keeps a cycle from looping forever.
function markdownFiles(dir = ROOT, found = [], seen = new Set(), broken = []) {
  const real = realpathSync(dir);
  if (seen.has(real)) return { found: found.sort(), broken };
  seen.add(real);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    let isDir;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      // A dangling symlink: report it rather than dying on it. lstat would have
      // said "link" and hidden it; stat throws. Neither is a silent skip.
      broken.push(`${relative(ROOT, path)}: symlink points at nothing`);
      continue;
    }
    if (isDir) {
      if (!SKIP_DIRS.has(entry.name)) markdownFiles(path, found, seen, broken);
    } else if (entry.name.endsWith('.md')) {
      found.push(path);
    }
  }
  return { found: found.sort(), broken };
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

// Issue #16's defect: this gate proved every link RESOLVES and never that the
// proofs index COVERS its own directory, so a committed measurement could sit
// unlisted and the index would still read as complete (M2.5's review caught
// three). Same shape as the ADR index check: everything on disk is listed.
// The inverse direction - the index naming a missing file - is already a dead
// link, which checkLinks reports.
function checkProofsIndex() {
  const proofs = join(ROOT, 'docs', 'proofs');
  const index = join(proofs, 'README.md');
  if (!existsSync(index)) return [`missing proofs index: ${relative(ROOT, index)}`];

  // Recursive, so a measurement filed in a subdirectory cannot hide from the
  // check the roadmap describes as covering "a file in docs/proofs/".
  const onDisk = readdirSync(proofs, { recursive: true })
    .map(String)
    .filter((n) => n.endsWith('.md') && n !== 'README.md');
  if (onDisk.length === 0) {
    return ['proofs directory holds no artifacts - the coverage check has nothing to check, which is itself wrong'];
  }
  const listed = new Set(
    linkTargets(readFileSync(index, 'utf8')).map((t) => t.split('#')[0]),
  );
  return onDisk
    .filter((n) => !listed.has(n))
    .sort()
    .map((n) => `proof artifact not listed in the proofs index: ${n}`);
}

// M3's whole-feature review found the same false citation four times, in four
// rounds, each time by a person reading. Three ADRs cited operation classes as
// living in `protocol/schema.json` under `enums.operationClass`, and a fourth
// cited an action enum under `enums.action`; `git log -S'enums' --
// protocol/schema.json` returns nothing, so no commit has ever put an `enums`
// container in that file. The reviewer's own conclusion is the reason this
// exists: the fifth copy should be found by a tool, not by a reader.
//
// WHAT IT CLAIMS, AND NOT MORE. It asks one question: does the cited name
// occur ANYWHERE in that file, as a key or as a value. Not "does the path
// resolve" — `types.action.fields.name` is real, and a document writing it as
// `action.name` is telling the truth about the shape while naming it loosely;
// reddening that teaches people to delete the check. Values count as well as
// keys, because `launch` is a member of `capabilityNames` rather than a key,
// and a document citing it is right. For a dotted name only the head is
// judged, for the same reason. What survives every one of those allowances is
// the defect this was written for: a name the file has never contained at all.
const CITED_JSON = /`([A-Za-z0-9_./-]+\.json)`/g;
const CITED_KEY = /`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)`/g;
// A dotted name ending in a file extension is a filename, not a key into one.
const LOOKS_LIKE_A_FILE = /\.(py|ts|tsx|js|mjs|cjs|json|md|yaml|yml|sh|txt|jsonl|toml|lock|mts|mod)$/;
// Measured, not guessed: across this repository's documents every genuine
// citation puts the two within ninety characters of each other ("`x.json`
// under `y`", or a table row naming both), and every coincidental pairing —
// a roadmap paragraph mentioning `tools/mutations.json` and, four thousand
// characters later, an AT-SPI method name — is far outside it.
const CITATION_PROXIMITY = 90;

function namesAnywhere(node, found = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) namesAnywhere(item, found);
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      found.add(key);
      namesAnywhere(value, found);
    }
  } else if (typeof node === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(node)) {
    // A vocabulary member is a name this file carries: `launch` lives in
    // `capabilityNames` as a value, and a document citing it is correct.
    found.add(node);
  }
  return found;
}

// Paragraph scope, not line scope: prose hard-wraps, and ADR-0037 states its
// citation with the path on one line and the key on the next. A line-scoped
// version of this check reads that site as clean.
function paragraphs(body) {
  const lines = body.split('\n');
  const blocks = [];
  let start = 0;
  lines.forEach((line, i) => {
    if (line.trim() === '') {
      if (i > start) blocks.push({ line: start + 1, text: lines.slice(start, i).join(' ') });
      start = i + 1;
    }
  });
  if (start < lines.length) blocks.push({ line: start + 1, text: lines.slice(start).join(' ') });
  return blocks;
}

function checkCitations(files) {
  const problems = [];
  const namesByFile = new Map();
  let examined = 0;

  for (const path of files) {
    const body = readFileSync(path, 'utf8').replace(FENCE, '');
    for (const block of paragraphs(body)) {
      // A line that says a citation is wrong has to quote the wrong citation
      // to say so. Every correction this check was written for reads like
      // that, and reddening the fixes would be the check eating its own tail.
      if (/\*\*not\*\*|\bnot\b `|corrected|correction|no such|never carried|has ever/i.test(block.text)) continue;

      const cited = [...block.text.matchAll(CITED_JSON)];
      if (cited.length === 0) continue;
      const keys = [...block.text.matchAll(CITED_KEY)].filter((m) => !LOOKS_LIKE_A_FILE.test(m[1]));

      for (const file of cited) {
        for (const key of keys) {
          const [first, second] = file.index < key.index ? [file, key] : [key, file];
          if (second.index - (first.index + first[0].length) > CITATION_PROXIMITY) continue;

          const onDisk = resolve(ROOT, file[1]);
          if (!existsSync(onDisk)) continue; // A path that does not exist is a dead link, and that is checkLinks' report to make.

          if (!namesByFile.has(onDisk)) {
            try {
              namesByFile.set(onDisk, namesAnywhere(JSON.parse(readFileSync(onDisk, 'utf8'))));
            } catch {
              namesByFile.set(onDisk, null); // Unparseable: cannot judge, and will not pretend to.
            }
          }
          const present = namesByFile.get(onDisk);
          if (present === null) continue;

          examined += 1;
          const head = key[1].split('.')[0];
          const wrong = `${relative(ROOT, path)}:${block.line}: cites \`${key[1]}\` in \`${file[1]}\`, which contains no \`${head}\``;
          // One line, deletable, carrying the whole judgement - so the mutation
          // table can take it away and watch this check stop being one.
          if (!present.has(head)) problems.push(wrong);
        }
      }
    }
  }

  // Vacuity: this repository documents its protocol by naming keys in it. A
  // run that judged nothing is a broken check, not a clean one.
  if (examined === 0) {
    problems.push('citations: no document cites a key in a JSON file - the check examined nothing, which is itself wrong');
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
    'docs/09-QUESTIONS.md',
    'README.md',
    'CONTRIBUTING.md',
  ];
  return required
    .filter((r) => !existsSync(join(ROOT, r)))
    .map((r) => `missing required document: ${r}`);
}

const { found: files, broken } = markdownFiles();
if (files.length === 0) {
  console.log('check-docs: found no markdown files - the check itself is broken');
  process.exit(1);
}

const problems = [...broken, ...checkCoverage(), ...checkLinks(files), ...checkAdrIndex(), ...checkProofsIndex(), ...checkCitations(files)];
if (problems.length > 0) {
  console.log(`check-docs: ${problems.length} problem(s) across ${files.length} files\n`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}

console.log(`check-docs: ok - ${files.length} files, every relative link resolves`);
