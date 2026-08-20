import { mkdtempSync } from "node:fs";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AtspiBackend,
  type Channel,
  type LaunchContext,
  OwnershipTable,
  replayChannel,
  startServer,
} from "@mastra-cc/daemon";
import { connect } from "../index.js";

// THE FIRST TIME AN INDEPENDENT CLIENT PERFORMS AN EFFECT OVER THIS WIRE.
//
// Every wire-level test this repository had before today was observe-only. The
// daemon's headline claim is that it ACTS, and until this file nothing outside
// the daemon package had ever asked it to: the effect verbs were exercised by
// calling handleRequest in-process, which proves the dispatch table and proves
// nothing about a socket, a framing, or a binding.
//
// The world is the committed gtk-dialog tape, a recording of a real GTK dialog
// read over the accessibility bus. `registry.replay` cannot be used here: the
// replay BACKEND refuses every effect by design - "a recording cannot be acted
// upon" - which is the correct answer for a tape and no answer at all for the
// question this file asks. So the tape is mounted through the real reader with
// only its WRITE half scripted, exactly as the daemon's own
// verified-by-reading-back test does. Every element these assertions read comes
// out of the recording; nothing here is a hand-authored tree.
//
// This test lives in packages/transport because pin B5 forbids socket clients
// anywhere else, and the client is the whole point.

// A recording answers reads. The write half is scripted because a tape holds no
// answer for an exchange nobody recorded, and hand-authoring one into the
// fixture is forbidden.
function writableTape(onWrite: (member: string) => void): Channel {
  const recorded = replayChannel("gtk-dialog");
  return {
    ...recorded,
    async call(exchange: Parameters<Channel["call"]>[0]) {
      if (exchange.member === "DoAction") {
        onWrite(exchange.member);
        return [true];
      }
      return recorded.call(exchange);
    },
  };
}

// The session half of the authority answer (ADR-0034), composed here the way
// --allow composes it at boot. The catalog is deliberately EMPTY: the do-not
// list forbids an offline test pairing the real CATALOG with a path that can
// reach spawn, and nothing below launches anything.
function allowing(classes: string[]): LaunchContext {
  return { permits: new Set(), catalog: {}, table: new OwnershipTable(), allows: new Set(classes) };
}

function socketIn(label: string): string {
  return join(mkdtempSync(join(tmpdir(), `mastra-cc-${label}-`)), "daemon.sock");
}

// One recorder per daemon. A shared array would let one test's write satisfy
// another test's assertion, which is how a refusal that DID reach the platform
// would pass unnoticed.
const written: string[] = [];
const writtenWithoutAuthority: string[] = [];
const performingPath = socketIn("effect");
const quietPath = socketIn("noauth");
let performing: Server;
let quiet: Server;

beforeAll(async () => {
  performing = await startServer({
    socketPath: performingPath,
    backend: new AtspiBackend(writableTape((member) => written.push(member)), "all"),
    launch: allowing(["activate"]),
  });
  // The same world and the same tape, started WITHOUT effect authority. If both
  // daemons answered alike, the test above would be measuring a constant.
  quiet = await startServer({
    socketPath: quietPath,
    backend: new AtspiBackend(writableTape((member) => writtenWithoutAuthority.push(member)), "all"),
    launch: allowing([]),
  });
});

afterAll(() => {
  performing.close();
  quiet.close();
});

// Find a target the way any client would - query, then act on what the daemon
// answered. An id written by hand would prove the wire carries strings.
async function clickableIn(elements: { id: string; name?: string; actions: { name: string }[] }[]) {
  const target = elements.find((element) => element.actions.some((action) => action.name === "click"));
  expect(target, "the recorded world publishes no clickable action - re-capture the fixture").toBeDefined();
  return target!;
}

describe("a client outside the daemon acts on the desktop and reads back what changed", () => {
  it("performs an action over the socket and answers with the element as it reads afterwards", async () => {
    const client = await connect({ socketPath: performingPath });
    const { elements } = await client.queryElements({});
    const target = await clickableIn(elements);

    const result = await client.activateElement({ id: target.id, action: "click" });

    expect(written, "the action never reached the platform").toContain("DoAction");
    expect(result.refusal).toBeUndefined();
    // The element in the answer is a fresh read of the tree carried whole across
    // the wire. A daemon echoing the caller's input would describe a world where
    // every verb always worked.
    expect(result.element?.id).toBe(target.id);
    expect(result.element?.name).toBe(target.name);

    client.close();
  });

  it("carries the scope gate's refusal to the client instead of an element", async () => {
    const client = await connect({ socketPath: quietPath });
    const { elements } = await client.queryElements({});
    const target = await clickableIn(elements);

    const result = await client.activateElement({ id: target.id, action: "click" });

    // A refusal an effect method decides is a FIELD OF THE RESULT, not a failed
    // call: the schema declares element and refusal side by side, and the
    // envelope-level refusal is reserved for a request the daemon could not
    // route at all. The client must not flatten the two - "it was refused, and
    // here is which check ran" is a different thing from "the call broke".
    expect(result.element).toBeUndefined();
    expect(result.refusal).toMatch(/holds no activate authority/);
    // The gate runs BEFORE the call, so the platform was never asked. This is
    // the assertion that makes the refusal mean something: a daemon that acted
    // and then reported a refusal would pass every other line above.
    expect(writtenWithoutAuthority, "a refused effect reached the platform anyway").toHaveLength(0);

    client.close();
  });



  it("refuses an id it never answered without inventing an element", async () => {
    const client = await connect({ socketPath: performingPath });
    // A refusal must not become an existence oracle (ADR-0008 rule 6).
    const result = await client.attestElement({ id: "el-000000000000" });
    expect(result.element).toBeUndefined();
    expect(result.refusal).toContain("el-000000000000");
    client.close();
  });
});
