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
// CONTAINMENT_HOME is that class's implementation. It was empty until the
// milestone that built the class, and it is no longer: schema 1.11.0 carries a
// closed keyChordNames vocabulary, daemon/src/server.ts dispatches sendKeyChord
// as rawInput-class, and the delivery itself lives at the one path below. This
// is the visible act ADR-0004 wanted and ADR-0046 preserved - the set grew in a
// diff, with the class, and not before.
//
// One path, deliberately. The daemon's own key route reaches AT-SPI rather than
// any of the banned tools, so nothing in the tree needs this exemption TODAY -
// and that is the point of listing the class rather than the tools it happens
// to use: the day a second platform's route needs XTest or uinput, it may only
// be written here, and writing it anywhere else is still a red pin. Listed as
// an exact directory of the class, so a raw-input helper stashed in a sibling
// module inherits nothing.
const CONTAINMENT_HOME = ["daemon/src/backends/atspi/rawinput"];

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
// The third stand-in is the delivery measurement. It presses ONE key the way a
// person's keyboard presses it, to answer a question the daemon cannot ask about
// itself: when a key sent through the product's route fails to arrive, is that
// the route or the desk? Without a human-shaped control the negative result is
// an anecdote - and that negative result is why nothing in this build delivers a
// key at all (docs/proofs/04-a-key-addressed-to-one-element.md). It performs no
// step of any errand; the daemon's own attempts go through the wire.
const HUMAN_STAND_INS = [
  "infra/webtop/signals/proof.sh",
  "infra/webtop/errands/run-errands.sh",
  "infra/webtop/04-a-key-addressed-to-one-element/measure-delivery.sh",
];

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
  // This line now has a mutation entry, and this commit is the one that owes it.
  // While CONTAINMENT_HOME was empty the skip was unscoreable - every path is
  // outside an empty set either way - so the entry waited for the commit that
  // gave the class a path, exactly as the note here used to promise.
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
if (CONTAINMENT_HOME.length === 0) fail("pin-b8: the raw-input class exists (ADR-0046, ADR-0067) but no path is contained - containment would be vacuous");
console.log(
  `pin-b8: ok - ${files.length} file(s), no raw input tool outside the raw-input class (${home}), ` +
    `${HUMAN_STAND_INS.length} proof harness(es) standing in for a human: ${HUMAN_STAND_INS.join(", ")}`,
);
