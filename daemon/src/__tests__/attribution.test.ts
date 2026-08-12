import { describe, expect, it } from "vitest";
import type { Attribution, ChangeEvent, SemanticElement } from "@mastra-cc/protocol-types";
import { type Backend, type BackendChange, mintSubscriptionId, UnknownSubscriptionError } from "../backend.js";
import { OwnershipTable } from "../launch/table.js";
import { attribute, handleRequest, type LaunchContext, SubscriptionBook } from "../server.js";

// The attribution rule, exercised on all three of its answers (ADR-0039).
//
// THIS FILE IS THE ONLY PLACE `self` IS EXERCISED IN THIS MILESTONE, and it is
// exercised offline. The reason is honest rather than technical: the only
// effect verb the daemon serves today is openApplication, and an application
// that does not exist yet cannot have been subscribed to before its launch. So
// a live transcript of M2.4 shows `external` and `unattributed` and no `self`
// at all. `self` becomes reachable live when the element verbs arrive; until
// then the rule is proven here, against the same function the server calls.
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
    actions: [],
  };
  const WATCHED = "el-0123456789ab";

  it("stamps self with the launch's cause id, and abstains once the launch is over", async () => {
    let sink: ((change: BackendChange) => void) | undefined;
    let polls = 0;
    const backend: Backend = {
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
      subscribeElement: async (_id, s) => {
        sink = s;
        return { subscriptionId: mintSubscriptionId(), application: "test-app", close: async () => undefined };
      },
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
