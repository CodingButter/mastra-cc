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
    // And it says it in English. Review found the previous wording telling this
    // very operator - the one who wired everything but the index - that the hub
    // "was given neither", which is both wrong and the most likely real case.
    expect(partial.reason).toContain("it needs vector, and this hub was given no such thing");
    expect(partial.reason).not.toContain("neither");
  });

  it("the parts the operator supplied are what the memory holds - not a class constructed with nothing", () => {
    // The trap this test exists for, and review found the code in it: check the
    // three parts, then call `new Subconscious()` with none of them. Both the
    // constructor name and the resolved config are true of a Subconscious built
    // out of thin air, so asserting them proves the DEPENDENCY ships a class and
    // proves nothing about this hub. The parts are therefore marked, and looked
    // for on the other side.
    const storage = { marked: "the-store" };
    const vector = { marked: "the-index" };
    const embedder = { marked: "the-embedder" };
    const state = bootSubconscious({ storage, vector, embedder });
    expect(state.on).toBe(true);
    if (!state.on) return;

    const held = state.memory as unknown as Record<string, unknown>;
    expect(held["vector"], "the vector index this hub was given is not the one the memory holds").toBe(vector);
    expect(held["embedder"], "the embedder this hub was given is not the one the memory holds").toBe(embedder);
    // The subconscious instance reaches the memory's own configuration rather
    // than being constructed beside it and dropped.
    const configured = (held["threadConfig"] as { observationalMemory?: { experimental_subconscious?: unknown } })
      .observationalMemory?.experimental_subconscious;
    expect(configured, "the subconscious was built and then not given to the memory").toBe(state.subconscious);
  });

  it("a memory that will not take a subconscious turns it OFF, in the library's own words", () => {
    // The gate is @mastra/memory's, not ours: it refuses a subconscious with no
    // vector index. Proving the hub RELAYS that refusal is what proves the hub
    // is asking the library rather than deciding for itself - the exact
    // difference between wiring and a presence check.
    // `null` is the case that reaches the library: it is present, so this
    // module's own missing-part check waves it through, and @mastra/memory is
    // what refuses. A hub that decided for itself would answer this ON.
    const state = bootSubconscious({ storage: {}, vector: null, embedder: {} });
    expect(state.on).toBe(false);
    if (state.on) return;
    expect(state.reason).toContain("would not take it");
    expect(state.reason).toContain("requires a vector store");
    // The library's own words about the operator's own configuration are carried
    // whole. This is not a provider quoting a request back; it is the store
    // saying what it is missing, and an operator who cannot read it cannot fix it.
    expect(bootSubconscious({ storage: {}, vector: {}, embedder: null }).on).toBe(false);
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
