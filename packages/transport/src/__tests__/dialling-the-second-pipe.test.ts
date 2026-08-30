import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Backend, WebSocketListener } from "@mastra-cc/daemon";
import { AtspiBackend, replayChannel, startWebSocketServer } from "@mastra-cc/daemon";
import { connect } from "../index.js";

// The same client, dialled at a URL instead of a path. Everything after the
// address is resolved is the SHARED code: one framing loop, one handshake, one
// digest check, one close. This file is what makes that claim falsifiable from
// the outside - it drives a real daemon listener over a real websocket and
// asks for the whole round trip, event included.
//
// The digest refusal is deliberately NOT re-tested here. It runs after the
// wire is up, in the shared code both dials reach, and digest-agreement.test.ts
// already drives it - re-asserting it against a second address would test the
// same branch twice and imply the two dials each carry their own copy.

const WATCHED = "el-0123456789ab";

// The committed tape answers reads; the watch half is grafted on because a
// recording holds no live subtree. Object.create keeps the class's methods -
// spreading a ReplayBackend would quietly drop half the backend.
function watchableReplay() {
  let sink: ((change: { id: string; kind: "changed"; attribution: "external" }) => void) | null = null;
  const closed: string[] = [];
  const base: Backend = new AtspiBackend(replayChannel("gtk-dialog"), "all");
  const backend = Object.assign(Object.create(base) as Backend, {
    subscribeElement: async (_id: string, deliver: (change: unknown) => void) => {
      sink = deliver as typeof sink;
      return {
        subscriptionId: "sub-websocket",
        application: "tape",
        close: async () => {
          closed.push("sub-websocket");
          sink = null;
        },
      };
    },
    applicationOfElement: () => undefined,
    unsubscribeElement: async () => {
      closed.push("sub-websocket");
      sink = null;
    },
  });
  return {
    backend,
    closed,
    change: () => sink?.({ id: WATCHED, kind: "changed", attribution: "external" }),
  };
}

const world = watchableReplay();
let listener: WebSocketListener;
let url: string;

beforeAll(async () => {
  listener = await startWebSocketServer({ port: 0, backend: world.backend });
  url = `ws://127.0.0.1:${listener.port}`;
});

afterAll(() => listener.close());

describe("the transport dials a URL and gets the wire it gets over a socket", () => {
  it("completes the handshake, calls a method, receives an event and closes", async () => {
    const client = await connect({ url });

    const { elements } = await client.queryElements({});
    expect(elements.length, "the recorded world answered nothing over the websocket").toBeGreaterThan(0);

    const events: { id: string }[] = [];
    client.onChangeEvent((event) => events.push(event));
    const subscription = await client.subscribeElement({ id: WATCHED, priority: "high" });
    expect(subscription.subscription?.subscriptionId).toBe("sub-websocket");

    world.change();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.map((event) => event.id), "no pushed event arrived over the websocket").toContain(WATCHED);

    client.close();
  });

  it("refuses a dial that names two addresses instead of one", async () => {
    const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-both-")), "daemon.sock");
    await expect(connect({ socketPath, url })).rejects.toThrow(/both given/);
  });
});
