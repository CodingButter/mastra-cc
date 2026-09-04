import { afterEach, describe, expect, it, vi } from "vitest";
import { type AuditEntry, useAuditLog } from "../audit.js";
import { type Backend, IncompleteObservationError } from "../backend.js";
import { OwnershipTable } from "../launch/table.js";
import { BACKEND_UNREADABLE_REFUSAL, handleRequest, type LaunchContext, UNKNOWN_ROLE_REFUSAL } from "../server.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// A BAD ROLE IS A REFUSAL, AND THE DAEMON SAYS WHY (ADR-0071).
//
// Two things the dogfood of 2026-09-02 found masked under one constant: a role
// the schema does not name crashed inside the AT-SPI role table, and a walk
// that met its budget threw - and both reached the wire as "the desktop could
// not be read", with nothing in the daemon's own log to tell them apart. The
// first is now refused by name before any backend is asked; the second still
// gets the constant on the wire, and the operator's stderr gets the cause.

// A backend whose queryElements records what it was asked, or throws what it
// was told to throw. Nothing else on it is reachable from these requests.
function backendThat(behaviour: { asked: unknown[]; throws?: unknown }): Backend {
  return {
    name: "role-fixture",
    ...observeOnlyEffects,
    queryElements: async (params: unknown) => {
      behaviour.asked.push(params);
      if (behaviour.throws !== undefined) throw behaviour.throws;
      return { elements: [] };
    },
    applicationOfElement: () => undefined,
    close: () => undefined,
  } as unknown as Backend;
}

function query(params: Record<string, unknown>, backend: Backend) {
  return handleRequest({ type: "request", id: 1, method: "queryElements", params }, backend, {
    permits: new Set(),
    catalog: DEFANGED_CATALOG,
    table: new OwnershipTable(),
    visibility: "all",
  } as unknown as LaunchContext);
}

function refusalIn(answer: { refusal?: string; result?: unknown }): string | undefined {
  return answer.refusal ?? (answer.result as { refusal?: string } | undefined)?.refusal;
}

// An in-memory record so the sink-failure path in audit.ts can never write to
// console.error and make the log-line count below flaky.
function remember(): AuditEntry[] {
  const entries: AuditEntry[] = [];
  useAuditLog({ path: "(memory)", record: (entry) => entries.push(entry) });
  return entries;
}

afterEach(() => {
  useAuditLog(undefined);
  vi.restoreAllMocks();
});

describe("a bad role is a refusal", () => {
  // P2-T1
  it("refuses a role the schema does not name, before any backend is asked", async () => {
    const asked: unknown[] = [];

    const answer = await query({ role: "heading" }, backendThat({ asked }));

    expect(refusalIn(answer)).toBe(UNKNOWN_ROLE_REFUSAL);
    expect(asked).toEqual([]);
  });

  // P2-T2
  it("refuses a role that is not a string the same way, as a malformed parameter", async () => {
    const asked: unknown[] = [];
    const entries = remember();

    const answer = await query({ role: 123 }, backendThat({ asked }));

    expect(refusalIn(answer)).toBe(UNKNOWN_ROLE_REFUSAL);
    expect(asked).toEqual([]);
    // The class is stripped from the wire but recorded in the receipt.
    expect(answer).not.toHaveProperty("result.refusalClass");
    expect(entries.map((entry) => entry.outcome)).toEqual(["refused:MalformedParameter"]);
  });

  // P2-T3
  it("lets every role the schema names through, and a question with no role", async () => {
    for (const params of [{ role: "window" }, { role: "generic" }, { role: "application" }, {}]) {
      const asked: unknown[] = [];

      const answer = await query(params, backendThat({ asked }));

      expect(refusalIn(answer)).toBeUndefined();
      expect(asked).toEqual([params]);
    }
  });
});

describe("the daemon says why", () => {
  // P2-T4
  it("keeps the constant on the wire and writes the cause to its own stderr", async () => {
    remember();
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const answer = await query({ role: "window" }, backendThat({ asked: [], throws: new IncompleteObservationError("x") }));

    expect(answer).toEqual({ type: "response", id: 1, refusal: BACKEND_UNREADABLE_REFUSAL });
    expect(stderr).toHaveBeenCalledTimes(1);
    const line = stderr.mock.calls[0]?.join(" ") ?? "";
    expect(line).toContain("queryElements");
    expect(line).toContain("IncompleteObservationError");
    expect(line).toContain("x");
  });

  it("names a thrown non-error as an Error with its text", async () => {
    remember();
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const answer = await query({ role: "window" }, backendThat({ asked: [], throws: "boom" }));

    expect(answer).toEqual({ type: "response", id: 1, refusal: BACKEND_UNREADABLE_REFUSAL });
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls[0]?.join(" ")).toContain("Error: boom");
  });

  // P2-T5
  it("records the incomplete read and role refusal as classified refusals", async () => {
    const entries = remember();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await query({ role: "window" }, backendThat({ asked: [], throws: new IncompleteObservationError("x") }));
    await query({ role: "heading" }, backendThat({ asked: [] }));

    expect(entries.map((entry) => [entry.scope, entry.outcome])).toEqual([
      ["observe", "refused:IncompleteObservation"],
      ["observe", "refused:MalformedParameter"],
    ]);
  });
});
