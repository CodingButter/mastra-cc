import { describe, expect, it } from "vitest";
import type { Backend } from "../backend.js";
import type { LaunchCatalog } from "../launch/recipes.js";
import { OwnershipTable } from "../launch/table.js";
import { handleRequest, type LaunchContext } from "../server.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// AN OWNED APPLICATION WITH NOTHING TO SHOW IS OPENED AGAIN.
//
// Measured on the demo desk, 2026-09-05: an agent closed Chromium's last
// window. The process stayed alive - it always does - but with no window there
// was nothing on the accessibility bus answering to "Chromium", and the
// ownership table still held the launch. Every openApplication after that took
// the idempotent path, started nothing, polled for thirty seconds and refused
// as unreadable. A live process the caller could neither reach nor restart: the
// errand ended there.
//
// The rule this pins is that OWNERSHIP IS NOT PRESENCE. "Ours is already
// running, so do not spawn a second one" is a claim about the desk, and the
// desk is the thing that settles it - so the check now asks the backend rather
// than the table alone. What must NOT move is the refusal that protects a
// stranger's copy: an application this daemon does not own, and can see, is
// still refused rather than launched over.

// A desk that publishes an application only while `showing` says it does, and
// counts the launches so a test can tell "started again" from "waited".
function desk(showing: () => boolean) {
  const backend = {
    name: "reopen-fixture",
    ...observeOnlyEffects,
    queryElements: async (params: { role?: string; name?: string }) => {
      if (params.role !== "application" || !showing()) return { elements: [] };
      return { elements: [{ id: "app-1", role: "application", name: "Chromium", actions: [] }] };
    },
    attestElement: async () => ({}),
    applicationOfElement: () => undefined,
    focusedElement: async () => undefined,
    close: () => undefined,
  } as unknown as Backend;
  // The recipe is defanged to a sleep: what is under test is WHETHER a launch
  // is attempted, and a test that really started a browser would be the blast
  // radius issue #20 exists about. A launch shows up as a second entry in the
  // ownership table, which is the record the launch path writes.
  const catalog: LaunchCatalog = { chromium: { argv: ["sleep", "1"], env: {} } };
  return { backend, catalog };
}

async function open(backend: Backend, context: LaunchContext) {
  const answer = await handleRequest(
    { type: "request", id: 1, method: "openApplication", params: { name: "chromium" } },
    backend,
    context,
  );
  return answer.result as { refusal?: string; application?: { name: string } };
}

function context(catalog: LaunchCatalog, table: OwnershipTable): LaunchContext {
  return { permits: new Set(["chromium"]), catalog, table, pollBudgetMs: 40, pollIntervalMs: 10 };
}

describe("opening an application this daemon already owns", () => {
  it("starts it again when it owns the launch but the desk shows nothing", async () => {
    // The measured deadlock: owned, alive, and publishing nothing.
    let showing = false;
    const { backend, catalog } = desk(() => showing);
    const table = new OwnershipTable();
    table.record(process.pid, "chromium");
    // The window arrives the way a real one does: after the launch, during the
    // poll. Nothing here shortens the poll's job - it still has to see it.
    setTimeout(() => {
      showing = true;
    }, 15);

    const answer = await open(backend, context(catalog, table));

    expect(answer.refusal).toBeUndefined();
    expect(answer.application?.name).toBe("Chromium");
    expect([...table.entries()]).toHaveLength(2);
  });

  it("does not start a second copy when the one it owns is there to be worked in", async () => {
    // The idempotent re-open, unchanged: a readable application of ours is the
    // answer, and spawning beside it would be a second browser nobody asked for.
    const { backend, catalog } = desk(() => true);
    const table = new OwnershipTable();
    table.record(process.pid, "chromium");

    const answer = await open(backend, context(catalog, table));

    expect(answer.refusal).toBeUndefined();
    expect([...table.entries()]).toHaveLength(1);
  });

  it("still refuses a copy it does not own, rather than launching over someone else's browser", async () => {
    // The protection that must not move with the fix (ADR-0027): a stranger's
    // application is refused, never started beside and never killed.
    const { backend, catalog } = desk(() => true);
    const table = new OwnershipTable();

    const answer = await open(backend, context(catalog, table));

    expect(answer.refusal).toMatch(/already running/i);
    expect([...table.entries()]).toHaveLength(0);
  });
});
