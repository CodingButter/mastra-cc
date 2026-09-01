import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fail, rootFromArgs, stripComments } from "./lib.mjs";

// B11: effects are enforced before the call, not after
// (docs/01-ARCHITECTURE.md §5, docs/05-TEST-STRATEGY.md:33). The daemon's
// dispatch table declares an enforcement timing per entry; result-time
// enforcement is legitimate only for observe, because filtering a response
// does not unsend the email. This pin reads the table from source and asserts
// every non-observe entry is marked "before-call".
//
// Honesty note: the source marking pins the DECLARATION. The enforcement
// TIMING - that authority is consulted before capability, before the tree,
// before the spawn - is pinned by the ordering test in
// daemon/src/__tests__/launch-authority.test.ts for the element-scoped
// methods, and by daemon/src/__tests__/can-the-desk-be-heard.test.ts for
// acquireAccessibility, whose gate is the operator flag rather than a
// per-application permit. The pin and those tests together are B11.

const root = rootFromArgs(process.argv);
const serverPath = join(root, "daemon", "src", "server.ts");

let source;
try {
  source = stripComments(readFileSync(serverPath, "utf8"), serverPath);
} catch {
  fail("pin-b11: no dispatch table found - the pin would pass vacuously");
}

const block = source.match(/const DISPATCH[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
if (!block) fail("pin-b11: no dispatch table found - the pin would pass vacuously");

const entries = [];
for (const match of block[1].matchAll(/(\w+):\s*\{([^\n]*)\}/g)) {
  const [, method, body] = match;
  const effectClass = body.match(/effectClass:\s*"([a-z]+)"/)?.[1];
  const enforcement = body.match(/enforcement:\s*"([a-z-]+)"/)?.[1];
  if (effectClass !== undefined) entries.push({ method, effectClass, enforcement });
}

if (entries.length === 0) fail("pin-b11: the dispatch table parsed to zero entries - the pin would pass vacuously");

const nonObserve = entries.filter((e) => e.effectClass !== "observe");
if (nonObserve.length === 0) {
  fail("pin-b11: no non-observe entry in the dispatch table - the pin would pass vacuously (it exists because one does)");
}

// The element methods are named, not merely counted. Every check below is
// "every non-observe entry is marked before-call", which a table that no longer
// carries them satisfies perfectly - going green by deletion. Each performs a
// real change on a real desktop, so its presence in the table is part of what
// this pin asserts, and its CLASS is too: an edit re-declared as observe would
// be enforced at result time, which for a method that has already typed into a
// field is enforcement of nothing.
//
// The three verbs perform since M2.6 segment 2. The four operations perform
// from the moment the wire routed them rather than answering with a constant:
// before that they were listed here as before-call and the marking was true but
// idle, because nothing was ever enforced against a call that could not happen.
// They are named now for the same reason the verbs are.
const REQUIRED = {
  editElement: "edit",
  activateElement: "activate",
  submitElement: "submit",
  setElementValue: "edit",
  setElementText: "edit",
  setElementCaret: "edit",
  revealElement: "activate",
  // Machine-scoped, and named here for the same reason the rest are: the loop
  // below iterates THIS map, not the dispatch table, so a method absent from it
  // is not checked at all - the pin would pass while the guarantee went
  // missing. acquireAccessibility changes the operator's machine, which is the
  // least deniable effect this daemon has.
  acquireAccessibility: "acquire",
};
for (const [method, effectClass] of Object.entries(REQUIRED)) {
  const entry = entries.find((e) => e.method === method);
  if (entry === undefined) {
    fail(`pin-b11: the dispatch table has no "${method}" entry - it performs a real change and must be declared and enforced, not absent`);
  }
  if (entry.effectClass !== effectClass) {
    fail(`pin-b11: "${method}" is declared ${entry.effectClass}-class, expected ${effectClass}-class - the class is what decides when enforcement runs`);
  }
}

const violations = [];
for (const entry of nonObserve) {
  if (entry.enforcement !== "before-call") {
    violations.push(
      `pin-b11: "${entry.method}" is ${entry.effectClass}-class but not marked enforcement "before-call" in ${relative(root, serverPath)}`,
    );
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  process.exit(1);
}
console.log(
  `pin-b11: ok - ${entries.length} dispatch entr(ies), every non-observe entry (${nonObserve.length}) enforced before the call`,
);
