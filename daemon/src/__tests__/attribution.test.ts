import { describe, expect, it } from "vitest";
import type { Attribution, ChangeEvent, SemanticElement } from "@mastra-cc/protocol-types";
import { type Backend, type BackendChange, mintSubscriptionId, UnknownSubscriptionError } from "../backend.js";
import { OwnershipTable } from "../launch/table.js";
import { attribute, handleRequest, type LaunchContext, SubscriptionBook } from "../server.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// The attribution rule, exercised on all three of its answers (ADR-0039).
//
// `self` was, for one milestone, reachable only through openApplication: an
// application that does not exist yet cannot have been subscribed to before
// its own launch, so a live M2.4 transcript showed `external` and
// `unattributed` and no `self` at all. The element verbs are the case that
// changes it - a verb performed on an element inside an application already
// being watched - and the last describe below exercises exactly that, through
// the server, against a subscription that was open before the verb was called.
//
// That path needed a fact the server could not previously ask for. A cause id
// alone does not produce `self`: attribute() answers `self` only when the
// cause NAMES the application, and an element verb carries an id, not a name.
// The seam answers it now (Backend.applicationOfElement), and the test below
// is what proves the wiring rather than assuming it - a verb that mints a
// cause and names nothing leaves its own change `unattributed`, which is the
// bug this describe exists to catch.
//
// The third answer is the one the milestone is really about. An effect is
// LABELLED, never flagged: `external` is news, not an alarm (ADR-0032 clause
// 4), and `unattributed` is the daemon declining to guess.

function stamp(changeApplication: string, cause?: { causeId: string; application?: string }): Attribution {
  return attribute(changeApplication, cause).attribution;
}

describe("the server stamps what caused a change, and abstains when it cannot tell", () => {
  it("labels a change external when no verb of ours was in flight", () => {
    // The operator typed, a notification arrived, a colleague's message
    // landed. Nothing of ours caused it, and the daemon says exactly that.
    expect(stamp("chrome")).toBe("external");
    expect(attribute("chrome").causeId).toBeUndefined();
  });

  it("labels a change self, with the cause id, when our verb named that application", () => {
    const cause = { causeId: "cause-abc123", application: "chrome" };
    const stamped = attribute("chrome", cause);
    expect(stamped.attribution).toBe("self");
    expect(stamped.causeId).toBe("cause-abc123");
  });

  it("matches the application by the same name rule the rest of the daemon uses", () => {
    // NFKC, exactly as every other name comparison in the daemon: an
    // attribution that compared raw bytes would call our own effect
    // unattributed whenever the tree spelled the name in a decomposed or
    // mathematical-bold form (the M0.5 lesson, backends/atspi/names.ts).
    expect(stamp("\u{1D41C}hrome", { causeId: "cause-1", application: "chrome" })).toBe("self");
  });

  it("labels a change unattributed - never external - when a verb is in flight elsewhere", () => {
    // A verb is open, but it names a different application than the one the
    // change happened in. We cannot say it was ours, and we cannot say it was
    // not: `external` would claim knowledge the daemon does not have.
    const stamped = attribute("chrome", { causeId: "cause-xyz", application: "yad" });
    expect(stamped.attribution).toBe("unattributed");
  });

  it("carries no cause id when it abstains, because there is no cause to name", () => {
    // causeId is present if and only if the attribution is self. Its absence
    // anywhere else is the contract, not an omission.
    expect(attribute("chrome", { causeId: "cause-xyz", application: "yad" }).causeId).toBeUndefined();
    expect(attribute("chrome", undefined).causeId).toBeUndefined();
  });

  it("abstains rather than guessing when a verb is in flight that names nothing", () => {
    // A verb whose target the server cannot resolve to an application leaves
    // every concurrent change undecidable. The daemon does not fall back on
    // "probably us" or "probably not us".
    expect(stamp("chrome", { causeId: "cause-1" })).toBe("unattributed");
  });
});

// The wiring, end to end through the real server: a change that arrives inside
// the application a launch is opening, WHILE that launch is still running.
// This is the offline stand-in for a live `self` - the only effect verb this
// milestone serves is openApplication, and an application that did not exist
// yet cannot have been watched before its own launch.
describe("a change inside the application our launch is opening is attributed to that launch", () => {
  const APPLICATION: SemanticElement = {
    id: "app-000000000001",
    role: "application",
    name: "test-app",
    states: ["enabled", "visible"],
    content: { kind: "unavailable", reason: "not-exposed" },
    actions: [],
  };
  const WATCHED = "el-0123456789ab";

  it("stamps self with the launch's cause id, and abstains once the launch is over", async () => {
    let sink: ((change: BackendChange) => void) | undefined;
    let polls = 0;
    const backend: Backend = {
      ...observeOnlyEffects,
      // The poll that waits for the launched application is where the change
      // is injected: it happens while the verb is open, which is exactly the
      // window a real one would land in.
      queryElements: async () => {
        polls += 1;
        if (polls === 1) return { elements: [] };
        sink?.({ id: WATCHED, role: "textbox", kind: "appeared" });
        return { elements: [APPLICATION] };
      },
      name: "launching",
      attestElement: async () => ({}),
      readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
      subscribeElement: async (_id, s) => {
        sink = s;
        return { subscriptionId: mintSubscriptionId(), application: "test-app", close: async () => undefined };
      },
      applicationOfElement: () => undefined,
      unsubscribeElement: async () => {
        throw new UnknownSubscriptionError("nothing to end");
      },
      close: async () => undefined,
    };
    const events: ChangeEvent[] = [];
    const book = new SubscriptionBook((event) => events.push(event));
    const table = new OwnershipTable();
    const launch: LaunchContext = {
      permits: new Set(["test-app"]),
      catalog: { "test-app": { argv: ["sleep", "30"], env: {} } },
      table,
      pollBudgetMs: 2000,
      pollIntervalMs: 5,
    };
    await handleRequest(
      { type: "request", id: 1, method: "subscribeElement", params: { id: WATCHED, priority: "high" } },
      backend,
      launch,
      book,
    );
    const opened = await handleRequest(
      { type: "request", id: 2, method: "openApplication", params: { name: "test-app" } },
      backend,
      launch,
      book,
    );
    try {
      expect((opened.result as { application?: SemanticElement }).application?.name).toBe("test-app");
      expect(events).toHaveLength(1);
      expect(events[0].attribution).toBe("self");
      expect(events[0].causeId).toMatch(/^cause-[0-9a-f]{12}$/);

      // ...and the moment the launch is over, the same change is news again:
      // the daemon is quiet, so nothing of ours caused it.
      sink?.({ id: WATCHED, role: "textbox", kind: "changed" });
      expect(events).toHaveLength(2);
      expect(events[1].attribution).toBe("external");
      expect(events[1].causeId).toBeUndefined();
    } finally {
      await book.closeAll();
      for (const entry of table.entries()) process.kill(entry.pid, "SIGKILL");
    }
  });
});

// The element verbs, attributed. This is the case openApplication could never
// reach: a watch that was already open when the verb ran, inside the same
// application the verb touched.
describe("a change caused by an element verb is attributed to that verb", () => {
  const WATCHED = "el-0123456789ab";
  const EDITED: SemanticElement = {
    id: WATCHED,
    role: "textbox",
    name: "Recipient",
    states: ["enabled", "visible"],
    content: { kind: "unavailable", reason: "not-exposed" },
    actions: [],
  };

  // A backend that knows which application its elements live in, and reports a
  // change from inside the edit - the way a real one does, because the write
  // lands before the read-back returns.
  function editing(application: string | undefined) {
    let sink: ((change: BackendChange) => void) | undefined;
    const backend: Backend = {
      ...observeOnlyEffects,
      name: "editing",
      queryElements: async () => ({ elements: [EDITED] }),
      attestElement: async () => ({ element: EDITED }),
      readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
      subscribeElement: async (_id, s) => {
        sink = s;
        return { subscriptionId: mintSubscriptionId(), application: "test-app", close: async () => undefined };
      },
      applicationOfElement: () => application,
      unsubscribeElement: async () => undefined,
      editElement: async () => {
        sink?.({ id: WATCHED, role: "textbox", kind: "changed" });
        return { element: EDITED };
      },
      close: async () => undefined,
    };
    return backend;
  }

  async function editUnder(backend: Backend): Promise<ChangeEvent[]> {
    const events: ChangeEvent[] = [];
    const book = new SubscriptionBook((event) => events.push(event));
    const launch: LaunchContext = {
      permits: new Set(),
      catalog: {},
      table: new OwnershipTable(),
      allows: new Set(["edit"]),
    };
    await handleRequest(
      { type: "request", id: 1, method: "subscribeElement", params: { id: WATCHED, priority: "high" } },
      backend,
      launch,
      book,
    );
    const edited = await handleRequest(
      { type: "request", id: 2, method: "editElement", params: { id: WATCHED, value: "someone@example.com" } },
      backend,
      launch,
      book,
    );
    expect((edited.result as { element?: SemanticElement }).element?.id).toBe(WATCHED);
    await book.closeAll();
    return events;
  }

  it("stamps self with the verb's cause id when the backend names the application", async () => {
    const events = await editUnder(editing("test-app"));
    expect(events).toHaveLength(1);
    expect(events[0].attribution).toBe("self");
    // Minted per call, never derived from the request id (ADR-0039).
    expect(events[0].causeId).toMatch(/^cause-[0-9a-f]{12}$/);
  });

  it("abstains rather than guessing when the backend cannot name the application", async () => {
    // An id this backend never answered names nothing. The verb is open and a
    // cause is minted, so the daemon knows a change MIGHT be ours and refuses
    // to decide: `unattributed`, never `self` (which would claim it was) and
    // never `external` (which would claim it was not).
    const events = await editUnder(editing(undefined));
    expect(events).toHaveLength(1);
    expect(events[0].attribution).toBe("unattributed");
    expect(events[0].causeId).toBeUndefined();
  });

  it("leaves a change in a different application unattributed while our verb is open", async () => {
    // The verb names one application; the watch reports another. Nothing binds
    // this change to our verb, and the daemon says so.
    const events = await editUnder(editing("some-other-app"));
    expect(events).toHaveLength(1);
    expect(events[0].attribution).toBe("unattributed");
    expect(events[0].causeId).toBeUndefined();
  });
});
