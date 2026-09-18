import { afterEach, expect, it, vi } from "vitest";
import { createConnection } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import type { Channel } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { replayChannel } from "../backends/replay/index.js";
import { startServer, type LaunchContext } from "../server.js";
import { OwnershipTable } from "../launch/table.js";
import { DriverAuthority } from "../driver.js";
import { boundary, CancelledAtBoundaryError, underCancellation } from "../cancellation.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// Who owns cancellation: the driver connection. Its close is the request.
// What the daemon can do: stop at the next supported boundary, never retract.
// How it acknowledges: ownership retires at that boundary, `settled` resolves,
// and only then is a successor's effect admitted.

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

it("a boundary throws only once the owning signal has aborted, naming what was already emitted", async () => {
  const controller = new AbortController();
  await underCancellation(controller.signal, async () => {
    boundary(0, 3);
    controller.abort();
    expect(() => boundary(2, 3)).toThrow(CancelledAtBoundaryError);
    try { boundary(2, 3); } catch (error) {
      expect((error as CancelledAtBoundaryError).emitted).toBe(2);
      expect((error as Error).message).toContain("2 of 3");
      expect((error as Error).message).toContain("fresh observation");
    }
  });
  // Outside any cancellable operation there is nothing to stop for.
  expect(() => boundary(0, 1)).not.toThrow();
});

it("settles immediately when nothing runs, and only at leave when something does", async () => {
  const authority = new DriverAuthority();
  const idle = authority.connect();
  authority.disconnect(idle);
  expect(idle.signal.aborted).toBe(true);
  await expect(authority.settled(idle)).resolves.toBeTypeOf("number");

  const busy = authority.connect();
  expect(authority.enter(busy, true)).toBeUndefined();
  let settledAt: number | undefined;
  void authority.settled(busy).then((at) => { settledAt = at; });
  authority.disconnect(busy);
  await Promise.resolve();
  expect(busy.signal.aborted).toBe(true);
  expect(settledAt).toBeUndefined();
  const before = performance.now();
  authority.leave(busy);
  await Promise.resolve();
  expect(settledAt).toBeGreaterThanOrEqual(before);
});

it("the native clear loop stops between two emitted keys once its driver has asked, and counts what it could not retract", async () => {
  // The real AtspiBackend over a scripted registry: each Backspace removes a
  // character; the driver's signal aborts while the fourth is landing.
  const tape = replayChannel("gtk-dialog");
  const controller = new AbortController();
  let buffer = "twelve chars";
  const pressed: number[] = [];
  const channel: Channel = {
    async call(exchange) {
      if (exchange.member === "GenerateKeyboardEvent") {
        const keysym = Number((exchange.body as unknown[])[0]);
        pressed.push(keysym);
        if (keysym === 0xff08) { buffer = buffer.slice(0, -1); if (buffer.length === 8) controller.abort(); }
        return [];
      }
      if (exchange.member === "GrabFocus") return [true];
      if (exchange.member === "GetInterfaces") return [["org.a11y.atspi.Text", "org.a11y.atspi.Component"]];
      if (exchange.member === "GetText") return [buffer];
      return tape.call(exchange);
    },
    watch: (subscribedTo, sink, anchor) => tape.watch(subscribedTo, sink, anchor),
    close: () => tape.close(),
  };
  const backend = new AtspiBackend(channel, "all");
  const { elements } = await backend.queryElements({ role: "label" });
  const id = elements[0]?.id as string;
  const attempt = underCancellation(controller.signal, () => backend.clearElementText({ id }));
  await expect(attempt).rejects.toBeInstanceOf(CancelledAtBoundaryError);
  const error = (await attempt.catch((e: unknown) => e)) as CancelledAtBoundaryError;
  // End, then exactly four Backspaces: the fifth was never emitted.
  expect(pressed).toEqual([0xff57, 0xff08, 0xff08, 0xff08, 0xff08]);
  expect(error.emitted).toBe(4);
  expect(error.of).toBe(12);
  expect(buffer).toBe("twelve c");
});

type Answer = { type: string; id?: number; refusal?: string; result?: { refusal?: string } };
async function peer(socketPath: string) {
  const messages: Answer[] = []; let buffer = "", id = 0;
  const socket = createConnection(socketPath);
  socket.on("data", (data) => {
    buffer += data.toString(); let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) { messages.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1); }
  });
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  const close = () => socket.destroy();
  cleanup.push(close);
  async function wait(predicate: (answer: Answer) => boolean) {
    const deadline = Date.now() + 1500;
    while (!messages.some(predicate)) { if (Date.now() >= deadline) throw Error("response deadline"); await new Promise((r) => setTimeout(r, 5)); }
    return messages.find(predicate)!;
  }
  socket.write(JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST }) + "\n"); await wait((x) => x.type === "hello");
  return { close, async request(method: string, params = {}) { const requestId = ++id; socket.write(JSON.stringify({ type: "request", id: requestId, method, params }) + "\n"); return wait((x) => x.id === requestId); } };
}

it("stops a running effect at its next boundary when the driver closes, and admits the successor only then", async () => {
  const emitted: number[] = [];
  let midway!: () => void;
  const reached = new Promise<void>((r) => { midway = r; });
  const backend: Backend = {
    ...observeOnlyEffects, name: "cancel-fixture", applicationOfElement: () => "test-app",
    queryElements: async () => ({ elements: [] }), attestElement: async () => ({}),
    readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
    subscribeElement: async () => { throw Error("not used"); }, unsubscribeElement: async () => {}, close: async () => {},
    focusedElement: async () => undefined,
    // A scripted emission loop with the same shape as the clear loop: one
    // unit per iteration, a boundary before each.
    clearElementText: async (params) => {
      for (let unit = 0; unit < 8; unit += 1) {
        boundary(unit, 8);
        emitted.push(unit);
        if (unit === 2) { midway(); await new Promise((r) => setTimeout(r, 30)); }
      }
      return { element: { id: params.id, role: "textbox", name: "field", actions: [], states: [], content: { kind: "text", value: "" } } };
    },
    typeText: async (params) => ({ element: { id: params.id, role: "textbox", name: "field", actions: [], states: [], content: { kind: "text", value: params.text } } }),
  };
  const directory = mkdtempSync(join(tmpdir(), "cc-cancel-")); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const socketPath = join(directory, "daemon.sock");
  const launch: LaunchContext = { permits: new Set(), allows: new Set(["rawInput"]), keys: { route: "test" }, catalog: DEFANGED_CATALOG, table: new OwnershipTable(), visibility: "all" };
  const server = await startServer({ socketPath, backend, launch }); cleanup.push(() => server.close());
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const a = await peer(socketPath), b = await peer(socketPath);
    void a.request("clearElementText", { id: "el-1" }).catch(() => undefined);
    await reached;
    a.close();
    // Cancellation requested while unit 2's pause is still in flight: the
    // successor is refused until the effect reaches its next boundary.
    expect((await b.request("typeText", { id: "el-1", text: "too-early" })).refusal).toContain("another driver");
    const deadline = Date.now() + 1500;
    let admitted: Answer | undefined;
    while (Date.now() < deadline) {
      const answer = await b.request("typeText", { id: "el-1", text: "after" });
      if (answer.refusal === undefined) { admitted = answer; break; }
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(admitted).toBeDefined();
    // Stopped at the boundary after unit 2: nothing beyond it was emitted,
    // and the daemon wrote the acknowledgement, not a backend failure.
    expect(emitted).toEqual([0, 1, 2]);
    const lines = stderr.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes("clearElementText stopped at a supported boundary after 3 of 8 emissions"))).toBe(true);
    expect(lines.some((line) => /driver \d+ settled \d+\.\d ms after its connection closed mid-effect/.test(line))).toBe(true);
    // b closed idle at cleanup, a closed mid-effect: exactly one acknowledgement line.
    expect(lines.filter((line) => line.includes("settled")).length).toBe(1);
    expect(lines.some((line) => line.includes("failed in the backend"))).toBe(false);
  } finally { stderr.mockRestore(); }
});

// WHY THERE IS NO CANCEL VERB ON THE WIRE, measured rather than asserted.
//
// The obvious missing feature is a request that says "stop request 4" while
// keeping the connection. The two questions that decide whether it is worth a
// protocol method are: would it ARRIVE in time, and would it STOP anything
// sooner than closing the connection already does.
//
// The first has to be measured, and the measurement is more specific than
// expected. The line IS read while an effect runs - requests are dispatched
// without awaiting the previous one - but every request then enters the global
// serialisation gate, so its ANSWER waits for the effect to finish. A cancel
// verb routed like every other method would therefore be answered only after
// the thing it meant to cancel had ended. It would have to be handled ahead of
// that gate, which is a second exception to the rule that the desk does one
// thing at a time.
//
// The second is the real answer. The effect stops at its next boundary and not
// before, because a boundary is the only place where nothing is in flight and
// stopping loses nothing - and a key already handed to the registry cannot be
// retracted by anyone, on any verb. So a cancel verb would arrive in time to
// reach exactly the same boundary that closing the connection already reaches,
// and would buy nothing except keeping the rest of the connection alive.
it("answers another request on the same connection mid-effect, and still stops only at a boundary", async () => {
  const emitted: number[] = [];
  let midway!: () => void;
  const reached = new Promise<void>((r) => { midway = r; });
  let releaseEffect!: () => void;
  const held = new Promise<void>((r) => { releaseEffect = r; });
  const backend: Backend = {
    ...observeOnlyEffects, name: "cancel-verb-fixture", applicationOfElement: () => "test-app",
    queryElements: async () => ({ elements: [] }), attestElement: async () => ({}),
    readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
    subscribeElement: async () => { throw Error("not used"); }, unsubscribeElement: async () => {}, close: async () => {},
    focusedElement: async () => undefined,
    clearElementText: async (params) => {
      for (let unit = 0; unit < 6; unit += 1) {
        boundary(unit, 6);
        emitted.push(unit);
        if (unit === 1) { midway(); await held; }
      }
      return { element: { id: params.id, role: "textbox", name: "field", actions: [], states: [], content: { kind: "text", value: "" } } };
    },
    typeText: async (params) => ({ element: { id: params.id, role: "textbox", name: "field", actions: [], states: [], content: { kind: "text", value: params.text } } }),
  };
  const directory = mkdtempSync(join(tmpdir(), "cc-cancel-verb-")); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const socketPath = join(directory, "daemon.sock");
  const launch: LaunchContext = { permits: new Set(), allows: new Set(["rawInput"]), keys: { route: "test" }, catalog: DEFANGED_CATALOG, table: new OwnershipTable(), visibility: "all" };
  const server = await startServer({ socketPath, backend, launch }); cleanup.push(() => server.close());
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const driver = await peer(socketPath);
    const effect = driver.request("clearElementText", { id: "el-1" }).catch(() => undefined);
    await reached;

    // A second line on the SAME connection, while the effect is parked inside
    // its loop. It is read - but it is not answered, because it is queued
    // behind the effect in the serialisation gate.
    const second = driver.request("listApplications", {});
    let answeredWhileBusy = false;
    void second.then(() => { answeredWhileBusy = true; });
    await new Promise((r) => setTimeout(r, 150));
    expect(answeredWhileBusy).toBe(false);
    // And the effect has not moved: it is still parked between two units.
    expect(emitted).toEqual([0, 1]);

    // Nothing the daemon could have done with that line would have unemitted
    // units 0 and 1, and the effect resumes to its next boundary either way.
    releaseEffect();
    await effect;
    expect(emitted).toEqual([0, 1, 2, 3, 4, 5]);
    // The queued request is answered once the desk is free again.
    expect((await second).type).toBe("response");
    expect(answeredWhileBusy).toBe(true);
  } finally { stderr.mockRestore(); }
});
