// WHAT THE HUB IS ALLOWED TO REMEMBER.
//
// Two claims, and only two, because only two can be honestly made at this
// version of @mastra/memory:
//
//   1. A subconscious with nowhere to write says so. It does not pretend.
//   2. What it would be handed carries identity and no content.
//
// The third claim the plan drafted - an observation written and read back
// across a flush boundary - is NOT here, and Phase 0 recorded why before this
// file was written rather than discovering it here: the subconscious requires a
// vector store and an embedder, neither ships in the three dependencies this
// milestone is authorised to add, and a test that "spans a flush boundary" with
// no store behind it would be a green measuring nothing.
//
// Claim 2 is testable without any of that, because the stripping happens on THIS
// side of the call. That is the half that is real, and it is the half ADR-0026
// actually obliges.

import { leakedTerms } from "@mastra-cc/daemon";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { announce, bootSubconscious } from "../memory/subconscious.js";
import { STRIPPED_KEYS, strippedView, type HubActivity } from "../memory/stripped.js";

// The desktop's own words. Every one of them is the kind of string an element
// carries in the real world and none of them may reach a record that outlives
// the turn.
const SUBJECT = "Reply to Dave about the unpaid invoice";
const TYPED = "the account number is 4417 9812 3345";

const ACTIVITY: HubActivity = {
  element: [{ id: "el-a174b78401c1", role: "text", name: SUBJECT, value: TYPED }],
  application: "thunderbird",
  scope: "edit",
  outcome: "performed",
};

describe("the subconscious keeps a stripped view", () => {
  it("a subconscious with nowhere to write says so, and does not quietly remember nothing", () => {
    const nothing = bootSubconscious(undefined);
    expect(nothing.on).toBe(false);
    if (nothing.on) return;
    // It names what is missing. "Memory unavailable" is a sentence an operator
    // can do nothing with.
    expect(nothing.reason).toContain("storage");
    expect(nothing.reason).toContain("vector");
    expect(nothing.reason).toContain("embedder");
    expect(announce(nothing)).toContain("OFF");

    // A PARTIAL store is still off, and still says which part. This is the case
    // that would otherwise slip through: storage configured, vector forgotten.
    const partial = bootSubconscious({ storage: {}, embedder: {} });
    expect(partial.on).toBe(false);
    if (partial.on) return;
    expect(partial.reason).toContain("vector");
    expect(partial.reason).not.toContain("storage");
  });

  it("with everything it needs, the subconscious is on and is a real one", () => {
    const state = bootSubconscious({ storage: {}, vector: {}, embedder: {} });
    expect(state.on).toBe(true);
    if (!state.on) return;
    // Not a stand-in: the published Subconscious, resolving its own config.
    expect(state.subconscious.constructor.name).toBe("Subconscious");
    expect(state.subconscious.resolved.observation.map((agent) => agent.name)).toContain("capture");
  });

  it("2a: the stripped view carries exactly four fields - the set is frozen, not merely free of a name key", () => {
    const view = strippedView(ACTIVITY);
    expect(Object.keys(view).sort()).toEqual([...STRIPPED_KEYS].sort());
    // The identity that DOES travel is the identity, whole: an observation that
    // could not say which element it was about would be a memory of nothing.
    expect(view.element).toEqual([{ id: "el-a174b78401c1", role: "text" }]);
    expect(Object.keys(view.element[0]!).sort()).toEqual(["id", "role"]);
    expect(view.scope).toBe("edit");
    expect(view.outcome).toBe("performed");
  });

  it("2b: no word the desktop said about itself reaches the view", () => {
    // Segment 1's detector, against a different record. One implementation of
    // the question, per ADR-0003 - and the cross-package case, where the two
    // records are built by different code with the same obligation.
    const record = JSON.stringify(strippedView(ACTIVITY));
    expect(leakedTerms(record, [SUBJECT, TYPED])).toEqual([]);
    // Nor any FRAGMENT of them: a view that kept the first forty characters of a
    // subject line would pass a whole-string check.
    expect(leakedTerms(record, [SUBJECT.slice(0, 20), TYPED.slice(0, 20), "invoice", "4417"])).toEqual([]);
    // Non-vacuous: the detector finds a planted term, so the empty answers above
    // mean it looked and found nothing rather than that it cannot look.
    expect(leakedTerms(`${record} ${SUBJECT}`, [SUBJECT])).toEqual([SUBJECT]);
  });

  it("there is one way in - a second path that builds an observation would not be stripped by this one", () => {
    // The claim this file makes is not "strippedView strips", it is "everything
    // that reaches long-term memory goes through strippedView". A function is
    // only a boundary if it is the only door, and nothing at runtime can prove
    // that about code nobody has written yet. So the module is read: the
    // observation type is constructed in exactly one place.
    const source = readFileSync(join(__dirname, "..", "memory", "stripped.ts"), "utf8");
    const constructions = source.match(/: StrippedObservation \{/g) ?? [];
    expect(constructions, "more than one function builds a StrippedObservation").toHaveLength(1);
    // And it is built field by field, never by spreading the activity: a spread
    // keeps whatever was added to HubActivity since the delete list was written.
    expect(source).not.toMatch(/\.\.\.activity/);
  });
});
