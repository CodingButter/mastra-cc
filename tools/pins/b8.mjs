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
// CONTAINMENT_HOME is that class's implementation, and it is EMPTY AGAIN - not
// because the class was never built, but because the route it was built on
// turned out not to deliver. Schema 1.11.0 carries the closed keyChordNames
// vocabulary and daemon/src/server.ts dispatches sendKeyChord as rawInput-class;
// what no longer exists is any code that puts a key on a machine. The
// accessibility interface the delivery was written against accepts Enter and
// every arrow and delivers none of them, measured against a control keystroke
// that moved the same window in the same second
// (docs/proofs/04-a-key-addressed-to-one-element.md), so the emitting file was
// withdrawn rather than left in the tree pressing keys into the void.
//
// The consequence is that this pin is at its STRICTEST reading right now: with
// no home, a raw-input tool may appear nowhere in the product at all, which is
// the exact truth about this build. The day a route is written that can carry a
// chord - XTest, uinput, or a second platform's own interface - its directory is
// listed here, in that diff, with the mutation that scores this skip. That is
// the visible act ADR-0004 wanted and ADR-0046 preserved, and it is owed again.
const CONTAINMENT_HOME = [];

// Two exemptions, and neither is part of the class. B8's subject is the PRODUCT:
// the daemon and the package must never synthesise input. A proof harness is the
// opposite direction - it stands in for the human at the keyboard, so that a
// change arrives at the daemon attributed `external` rather than `self`. Without
// a human-shaped actor there is no honest way to prove the desk can wake an agent
// (docs/proofs/the-desk-wakes-the-agent.md); a script opening its own protocol
// dial would produce a self-attributed change and prove the opposite of the
// claim.
//
// The second stand-in is the errand harness. It never performs a step of an
// errand - the agent does that through the protocol, and a transcript where the
// keyboard did the work would be worthless. It types for exactly one reason: to
// leave the desk in the state a PERSON left it in before the errand starts. E6
// ("close the editor without saving") has no confirmation dialog to recognise
// unless someone made an unsaved edit first, and only a human-shaped actor can
// make that edit without the agent attributing it to itself.
//
// Listed as EXACT FILES, never a directory prefix, so the exemption cannot grow
// quietly: a new harness that wants raw input has to appear in this diff. It is
// also why each harness keeps its raw input in its shell wrapper - B8 scans .mjs
// as well, so a driver that shelled out would need a third entry. The mutation on
// this list only proves the exemptions are load-bearing; that they cannot WIDEN
// into a prefix is the `sneak.sh` case in pins.test.mjs.
const HUMAN_STAND_INS = ["infra/webtop/signals/proof.sh", "infra/webtop/errands/run-errands.sh"];

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
  // Unscoreable while the set is empty - every path is outside an empty set
  // either way - so this skip carries no mutation entry today, and the entry
  // returns with the delivering route that gives the class a path again. A red
  // manufactured before then would be scoring a rule with no subject.
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
// No home is a real state and it is said out loud rather than treated as an
// error: the class is defined on the wire and nothing in the product can put a
// key on a machine, so the ban is total. The guard that used to insist on a
// path came from the commit that had one.
const home = CONTAINMENT_HOME.length === 0 ? "nothing delivers a key in this build" : CONTAINMENT_HOME.join(", ");
console.log(
  `pin-b8: ok - ${files.length} file(s), no raw input tool outside the raw-input class (${home}), ` +
    `${HUMAN_STAND_INS.length} proof harness(es) standing in for a human: ${HUMAN_STAND_INS.join(", ")}`,
);
