import type { Backend } from "../backend.js";
import { describe, expect, it } from "vitest";
import { registry } from "../backends/registry.js";
import { CATALOG } from "../launch/recipes.js";
import { OwnershipTable } from "../launch/table.js";
import { BACKEND_METHODS } from "../backend.js";
import {
  EDIT_SCOPE_REFUSAL,
  MAGNITUDE_NOT_A_NUMBER_REFUSAL,
  OFFSET_NOT_A_NUMBER_REFUSAL,
  REVEAL_SCOPE_REFUSAL,
  SET_CARET_SCOPE_REFUSAL,
  SET_TEXT_SCOPE_REFUSAL,
  SET_VALUE_SCOPE_REFUSAL,
  handleRequest,
} from "../server.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// Anything the schema does not define is refused with the check named
// (ADR-0019: capability is not authority). Since M2.1 the dispatch table
// carries one activate-class entry - openApplication - whose enforcement
// timing B11 pins; since M2.3 (schema 1.2.0, ADR-0037) the edit, activate and
// submit element methods are DEFINED; everything else beyond the schema still
// dies at the gate.
//
// What changed under those three verbs, and what did not: the seam behind them
// now performs, and every session in this file is started without effect
// authority, so the scope gate still answers each call. That is why these tests
// are kept rather than rewritten - the refusal is now a DECISION rather than
// the only thing the daemon could do, and a decision has to keep answering the
// same way for a session that holds nothing. The authority-held direction, and
// the timing of the check, live in launch-authority.test.ts.

// Every method throws if called: a refusal that is decided before the call
// must be answerable with no desktop existing at all. observeOnlyEffects
// already refuses all seven effect methods by name, and the reads are what a
// gate would have to reach through to answer.
function untouchableBackend(reason: string): Backend {
  const touched = async (): Promise<never> => {
    throw new Error(reason);
  };
  return {
    ...observeOnlyEffects,
    name: "untouchable",
    queryElements: touched,
    attestElement: touched,
    subscribeElement: touched,
    applicationOfElement: () => undefined,
    unsubscribeElement: touched,
    close: touched,
  };
}

describe("the effect-class gate", () => {
  // visibility mirrors the union main.ts composes at boot: the tape's yad must
  // be findable or the openApplication handler escapes into a real spawn
  const backend = registry.replay({ visibility: new Set(["yad"]) });

  it("refuses a method the schema does not define, naming the gate", async () => {
    // destroyElement stays unknown deliberately: the destructive class has no
    // methods, and that absence is itself doctrine (ADR-0037)
    const response = await handleRequest({ type: "request", id: 1, method: "destroyElement", params: {} }, backend);
    expect(response.refusal).toContain("effect-class gate");
    expect(response.refusal).toContain("destroyElement");
    expect(response.refusal).toContain("schema");
    expect(response.result).toBeUndefined();
  });

  it("serves both observe-class methods the schema defines", async () => {
    const query = await handleRequest({ type: "request", id: 2, method: "queryElements", params: {} }, backend);
    expect(query.refusal).toBeUndefined();
    expect((query.result as { elements: unknown[] }).elements.length).toBeGreaterThan(0);

    const attest = await handleRequest(
      { type: "request", id: 3, method: "attestElement", params: { id: "el-000000000000" } },
      backend,
    );
    // an unknown id is a backend refusal inside a served method, not a gate refusal
    expect(attest.refusal).toBeUndefined();
    expect((attest.result as { refusal?: string }).refusal).toContain("el-000000000000");
  });

  it("no longer refuses openApplication at the gate when the session permits it", async () => {
    // Permitted, so the gate and the authority check both pass; the tape's
    // yad is already running and unowned, so the result is a served-method
    // refusal - which is the point: the class gate did not fire.
    const response = await handleRequest(
      { type: "request", id: 4, method: "openApplication", params: { name: "yad" } },
      backend,
      { permits: new Set(["yad"]), catalog: CATALOG, table: new OwnershipTable(), pollBudgetMs: 50, pollIntervalMs: 10 },
    );
    expect(response.refusal).toBeUndefined();
    expect(response.result).toBeDefined();
  });
});

// THE FOUR OPERATIONS, AND THE WORDS THEY REFUSE WITH.
//
// These four wire methods answered every caller with a constant while all
// three backends implemented them, and the constant said so: it claimed this
// daemon did not serve the method in this segment, and that the answer did not
// depend on the session's authority. Both sentences were true of the dispatch
// table and false of everything behind it. They are now routed to the seam, so
// the check that runs is the scope gate, and the words are the scope gate's.
//
// What is asserted here is the sentence, against the world rather than against
// itself: the seam declares each method (BACKEND_METHODS), so a refusal that
// blames the seam is a false statement on the wire, and a refusal that says
// the daemon does not serve the method is the exact sentence that would come
// back if anyone re-declared these handlers as constants. That inverse is the
// assertion this file lost when the bug was fixed, and keeping it is what
// makes the fix hard to undo quietly. A refusal names the check that actually
// ran (ADR-0008 clause 5).
describe("the four operations refuse with the check that actually ran", () => {
  const backend = registry.replay({ visibility: new Set(["yad"]) });

  const operations = [
    ["setElementValue", SET_VALUE_SCOPE_REFUSAL, "edit", { id: "el-000000000000", value: 1 }],
    ["setElementText", SET_TEXT_SCOPE_REFUSAL, "edit", { id: "el-000000000000", text: "typed" }],
    ["setElementCaret", SET_CARET_SCOPE_REFUSAL, "edit", { id: "el-000000000000", offset: 0 }],
    ["revealElement", REVEAL_SCOPE_REFUSAL, "activate", { id: "el-000000000000" }],
  ] as const;

  it("names the scope gate, the method and its class, and never blames the seam", () => {
    for (const [method, refusal, effectClass] of operations) {
      // The claim and the world in the same assertion: the seam declares the
      // method, so a refusal saying otherwise is a false statement on the wire.
      expect(BACKEND_METHODS).toContain(method);
      expect(refusal).toContain("scope gate");
      expect(refusal).toContain(method);
      expect(refusal).toContain(`${effectClass}-class`);
      expect(refusal).not.toContain("seam carries no operation");
      // the sentence the constant handlers answered with. It goes back the
      // moment the routing does, which is the point of asserting its absence.
      expect(refusal).not.toContain("does not serve it in this segment");
    }
  });

  it("refuses a session holding nothing with the byte-stable constant, and never touches the backend", async () => {
    for (const [index, [method, refusal, , params]] of operations.entries()) {
      const response = await handleRequest(
        { type: "request", id: 20 + index, method, params },
        untouchableBackend("the scope gate touched the backend"),
      );
      expect(response.refusal).toBeUndefined();
      expect((response.result as { refusal?: string }).refusal).toBe(refusal);
    }
  });

  it("lets a session holding the class through to the seam, which answers for itself", async () => {
    // The anti-vacuity half: without it, a handler that answered with the
    // scope constant unconditionally - the bug - would pass the test above.
    // The replay route refuses to be acted upon, in its own words, and that
    // sentence can only have come from the backend.
    for (const [index, [method, refusal, effectClass, params]] of operations.entries()) {
      const response = await handleRequest(
        { type: "request", id: 40 + index, method, params },
        backend,
        {
          permits: new Set<string>(),
          allows: new Set([effectClass] as const),
          catalog: CATALOG,
          table: new OwnershipTable(),
        },
      );
      const answered = (response.result as { refusal?: string }).refusal;
      expect(answered).not.toBe(refusal);
      expect(answered).toContain("a recording cannot be acted upon");
    }
  });
});

// THE TWO NUMBERS THE OPERATIONS CARRY.
//
// Both are read after the gates and neither is coerced. The reason is that
// coercion here is invisible: NaN is neither above a published maximum nor
// below a published minimum, so a magnitude that is not a number survives every
// bounds check the backends make and lands on a live control; an unusable
// offset read as absent turns an insert into a replacement of the whole field,
// and a caret placement into a jump to the end. Each is refused by its own
// constant, and the backend is never reached to produce it.
describe("the operations refuse a number that is not one, rather than coercing it", () => {
  const backend = registry.replay({ visibility: new Set(["yad"]) });
  const held = { permits: new Set<string>(), allows: new Set(["edit"] as const), catalog: CATALOG, table: new OwnershipTable() };

  const unusable = [
    [50, "setElementValue", { id: "el-000000000000", value: "1" }, MAGNITUDE_NOT_A_NUMBER_REFUSAL],
    [51, "setElementValue", { id: "el-000000000000", value: Number.NaN }, MAGNITUDE_NOT_A_NUMBER_REFUSAL],
    [52, "setElementValue", { id: "el-000000000000" }, MAGNITUDE_NOT_A_NUMBER_REFUSAL],
    [53, "setElementText", { id: "el-000000000000", text: "typed", offset: "0" }, OFFSET_NOT_A_NUMBER_REFUSAL],
    [54, "setElementCaret", { id: "el-000000000000", offset: Number.NaN }, OFFSET_NOT_A_NUMBER_REFUSAL],
  ] as const;

  it("refuses by name, with the class held, without touching the backend", async () => {
    for (const [id, method, params, refusal] of unusable) {
      const response = await handleRequest(
        { type: "request", id, method, params },
        untouchableBackend("an unusable number reached the backend"),
        held,
      );
      expect(response.refusal).toBeUndefined();
      expect((response.result as { refusal?: string }).refusal).toBe(refusal);
    }
  });

  it("carries an absent offset through as absent - the seam resolves it against the element's own text", async () => {
    // Absence is not zero and not the end: the schema makes the offset optional
    // and gives absence a meaning, so refusing it here would refuse a call the
    // schema defines. The replay route's own sentence is the evidence that this
    // reached the seam rather than being turned back by the check above.
    for (const [index, method] of ["setElementText", "setElementCaret"].entries()) {
      const params = method === "setElementText" ? { id: "el-000000000000", text: "typed" } : { id: "el-000000000000" };
      const response = await handleRequest({ type: "request", id: 60 + index, method, params }, backend, held);
      const answered = (response.result as { refusal?: string }).refusal;
      expect(answered).not.toBe(OFFSET_NOT_A_NUMBER_REFUSAL);
      expect(answered).toContain("a recording cannot be acted upon");
    }
  });
});

describe("the scope gate: a session holding no effect authority is refused by name", () => {
  const backend = registry.replay({ visibility: new Set(["yad"]) });

  it("refuses editElement with the full byte-stable constant", async () => {
    const response = await handleRequest(
      { type: "request", id: 5, method: "editElement", params: { id: "el-000000000000", value: "x" } },
      backend,
    );
    expect(response.refusal).toBeUndefined();
    // a served-method refusal, byte-stable: the constant IS the contract
    expect((response.result as { refusal?: string }).refusal).toBe(EDIT_SCOPE_REFUSAL);
  });

  it("refuses activateElement naming the scope gate, the method and its class", async () => {
    const response = await handleRequest(
      { type: "request", id: 6, method: "activateElement", params: { id: "el-000000000000", action: "click" } },
      backend,
    );
    const refusal = (response.result as { refusal?: string }).refusal;
    expect(refusal).toContain("scope gate");
    expect(refusal).toContain("activateElement");
    expect(refusal).toContain("activate-class");
  });

  it("refuses submitElement naming the scope gate, the method and its class", async () => {
    const response = await handleRequest(
      { type: "request", id: 7, method: "submitElement", params: { id: "el-000000000000", attestation: "sends nothing" } },
      backend,
    );
    const refusal = (response.result as { refusal?: string }).refusal;
    expect(refusal).toContain("scope gate");
    expect(refusal).toContain("submitElement");
    expect(refusal).toContain("submit-class");
  });

  it("never touches the backend to refuse", async () => {
    const untouchable = untouchableBackend("the scope gate touched the backend");
    for (const [id, method, params] of [
      [8, "editElement", { id: "el-000000000000", value: "x" }],
      [9, "activateElement", { id: "el-000000000000", action: "click" }],
      [10, "submitElement", { id: "el-000000000000", attestation: "commits nothing" }],
    ] as const) {
      const response = await handleRequest({ type: "request", id, method, params }, untouchable);
      expect(response.refusal).toBeUndefined();
      expect((response.result as { refusal?: string }).refusal).toContain("scope gate");
    }
  });
});
