import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { collect, fail, rootFromArgs, stripComments } from "./lib.mjs";

// B8: raw input tools appear ONLY inside the raw-input operation class, and
// nowhere else in the tree - including as a shelled-out command.
//
// The outright ban this pin was born with (0004:34) was struck 2026-08-17 by
// ADR-0046, which replaced it with containment: raw input is the most
// restricted operation class rather than an absent one, and decision 8 of that
// record re-specifies this pin as "a grep-for-absence becomes a grep-for-
// containment" (0046:46).
//
// CONTAINMENT_HOME is that class's implementation. It is empty today because
// the class does not exist yet: no dispatch entry in daemon/src/server.ts
// carries it, and protocol/schema.json has no raw-input vocabulary. While the
// set is empty, containment and absence are the same assertion, and this pin
// behaves exactly as the ban did. The milestone that builds the class adds its
// path here, in a diff - which is the visible act ADR-0004 wanted and ADR-0046
// preserved. An empty set is not a hole: it is the honest state of a class
// nobody has built.
const CONTAINMENT_HOME = [];

// One exemption, and it is not part of the class. B8's subject is the PRODUCT:
// the daemon and the package must never synthesise input. A proof harness is the
// opposite direction - it stands in for the human at the keyboard, so that a
// change arrives at the daemon attributed `external` rather than `self`. Without
// a human-shaped actor there is no honest way to prove the desk can wake an agent
// (docs/proofs/the-desk-wakes-the-agent.md); a script opening its own protocol
// dial would produce a self-attributed change and prove the opposite of the
// claim.
//
// Listed as EXACT FILES, never a directory prefix, so the exemption cannot grow
// quietly: a new harness that wants raw input has to appear in this diff.
const HUMAN_STAND_INS = ["infra/webtop/signals/proof.sh"];

const BANNED_TOOL = /\b(xdotool|wmctrl|uinput)\b/;

const root = rootFromArgs(process.argv);
const files = collect(
  root,
  ["daemon", "packages", "apps", "tools", "scripts", "infra"],
  [".ts", ".js", ".mjs", ".cjs", ".sh", ".service"],
);

if (files.length === 0) fail("pin-b8: no files matched - the pin would pass vacuously");

const violations = [];
for (const file of files) {
  const path = relative(root, file);
  // NO MUTATION ENTRY GUARDS THIS LINE, and that is not an oversight. While
  // CONTAINMENT_HOME is empty, deleting the skip changes nothing a test could
  // observe: every path is outside an empty set either way. The guarantee
  // becomes scoreable in the same commit that gives the class a path, and the
  // mutation belongs to that commit. A red manufactured before then would be
  // scoring a rule with no subject.
  if (CONTAINMENT_HOME.some((home) => path === home || path.startsWith(`${home}/`))) continue;
  if (HUMAN_STAND_INS.includes(path)) continue;
  const source = stripComments(readFileSync(file, "utf8"), file);
  const match = source.match(BANNED_TOOL);
  if (match) {
    violations.push(
      `pin-b8: raw input tool "${match[1]}" referenced at ${path}, outside the raw-input class (ADR-0046:46)`,
    );
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  process.exit(1);
}
const home = CONTAINMENT_HOME.length === 0 ? "no raw-input class exists yet" : CONTAINMENT_HOME.join(", ");
console.log(
  `pin-b8: ok - ${files.length} file(s), no raw input tool outside the raw-input class (${home}), ` +
    `${HUMAN_STAND_INS.length} proof harness(es) standing in for a human: ${HUMAN_STAND_INS.join(", ")}`,
);
