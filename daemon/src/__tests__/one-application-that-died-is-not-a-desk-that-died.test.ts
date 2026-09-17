import { describe, expect, it } from "vitest";
import { handleRequest } from "../server.js";
import { ElementGoneError, PeerGoneError } from "../backend.js";
import { namesADeadNode, namesADeadPeer } from "../backends/atspi/channel.js";
import { observeOnlyEffects } from "./support/observe-only.js";
import type { Backend } from "../backend.js";

// Measured 2026-09-05 on the demo container. A window this daemon had opened
// crashed mid-run. Every later call aimed at an element inside it came back
// from the bus naming that one peer - ServiceUnknown, or NoReply with
// "Message recipient disconnected from message bus without replying" - the
// backend threw, and the server answered "the desktop could not be read by
// this session's backend".
//
// Three other windows were open at the time. The run above read that refusal
// the only way it could, said it was completely blocked, and stopped.
//
// A bus error naming one peer is a fact about one application.

function throwing(error: unknown): Backend {
  return {
    ...observeOnlyEffects,
    async queryElements() {
      throw error;
    },
    async readElementContent() {
      throw error;
    },
  } as unknown as Backend;
}

async function ask(back: Backend, method = "queryElements") {
  return (await handleRequest(
    { id: 1, method, params: method === "readElementContent" ? { id: "el-1", offset: 0, limit: 16 } : {} } as never,
    back,
  )) as { refusal?: string };
}

describe("a call that fails because one application is gone", () => {
  it("says that application is gone, and that the rest of the desk is still there", async () => {
    const answer = await ask(throwing(new PeerGoneError("d-bus call failed for :1.14|...")));
    expect(answer.refusal).toContain("no longer running");
    expect(answer.refusal).toContain("the rest of the desk is still there");
    expect(answer.refusal).not.toContain("the desktop could not be read");
  });

  it("tells the caller what to do next - ask what is on the desk again", async () => {
    const answer = await ask(throwing(new PeerGoneError("gone")));
    expect(answer.refusal).toContain("ask what is on the desk again");
  });

  it("carries no bus vocabulary out to the caller", async () => {
    const answer = await ask(
      throwing(new PeerGoneError('d-bus call failed for :1.14|/org/a11y/atspi/accessible/1923: {"name":"DBusError"}')),
    );
    expect(answer.refusal).not.toContain(":1.14");
    expect(answer.refusal).not.toContain("d-bus");
    expect(answer.refusal).not.toContain("atspi");
  });

  it("still condemns the desk when the failure names no application at all", async () => {
    const answer = await ask(throwing(new Error("the bus socket closed")));
    expect(answer.refusal).toBe("the desktop could not be read by this session's backend");
  });

  it("holds the same line on a read as on a query - any method, one meaning", async () => {
    const answer = await ask(throwing(new PeerGoneError("gone")), "readElementContent");
    expect(answer.refusal).toContain("no longer running");
  });
});

describe("the bus errors that mean a peer is gone", () => {
  it("recognizes explicit service loss or recipient disconnection", () => {
    expect(namesADeadPeer({ name: "DBusError", body: ["x"], errorName: "org.freedesktop.DBus.Error.ServiceUnknown" })).toBe(true);
    expect(namesADeadPeer({ body: ["Message recipient disconnected from message bus without replying"] })).toBe(true);
    expect(namesADeadPeer({ errorName: "org.freedesktop.DBus.Error.NoReply", body: ["Message recipient disconnected from message bus without replying"] })).toBe(true);
  });

  it("does not infer process death from an unanswered or timed-out call", () => {
    expect(namesADeadPeer({ errorName: "org.freedesktop.DBus.Error.NoReply" })).toBe(false);
    expect(namesADeadPeer({ name: "TimeoutError", dbusName: "org.freedesktop.DBus.Error.NoReply", code: "ETIMEDOUT", timeout: 25000 })).toBe(false);
  });

  it("reads everything else as a failure that says nothing about which peer died", () => {
    expect(namesADeadPeer({ errorName: "org.freedesktop.DBus.Error.AccessDenied" })).toBe(false);
    expect(namesADeadPeer(new Error("socket hang up"))).toBe(false);
    expect(namesADeadPeer(null)).toBe(false);
  });
});

// One level down, the same widening: the application is alive and the ELEMENT
// is gone. Measured 2026-09-05 - a dialog closed under a run, the next reveal
// aimed at a node inside it came back UnknownObject, and the run was told the
// desktop could not be read while a browser and a settings window were open.
describe("a call aimed at an element that no longer exists", () => {
  it("says that element is gone and to work from a fresh answer", async () => {
    const answer = await ask(throwing(new ElementGoneError("No such object path")));
    expect(answer.refusal).toContain("no longer on the desk");
    expect(answer.refusal).toContain("ask what is there now");
    expect(answer.refusal).not.toContain("the desktop could not be read");
  });

  it("does not accuse the application of having died - it has not", async () => {
    const answer = await ask(throwing(new ElementGoneError("No such object path")));
    expect(answer.refusal).not.toContain("no longer running");
  });

  it("reads the bus error the platform uses for a destroyed node", () => {
    expect(namesADeadNode({ dbusName: "org.freedesktop.DBus.Error.UnknownObject" })).toBe(true);
    expect(namesADeadNode({ dbusName: "org.freedesktop.DBus.Error.ServiceUnknown" })).toBe(false);
  });
});
