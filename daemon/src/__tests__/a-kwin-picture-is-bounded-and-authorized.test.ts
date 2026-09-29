import { afterEach, describe, expect, it, vi } from "vitest";
import * as processes from "node:child_process";
import { AtspiBackend } from "../backends/atspi/index.js";
import { replayChannel } from "../backends/replay/index.js";
import { UnperformableElementError } from "../backend.js";
import { handleRequest } from "../server.js";
import { underCancellation, CancelledAtBoundaryError } from "../cancellation.js";
import { captureRoute, decodeKwinFrame, grabKwinPixels, KwinFrameError } from "../backends/atspi/kwin-capture.js";

vi.mock("node:child_process", async (original) => ({ ...await original<typeof processes>(), spawn: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

function frame(change: Record<string, unknown> = {}, payload = Buffer.alloc(12)) {
  const header = Buffer.from(JSON.stringify({ version: 1, format: "RGB", width: 2, height: 2,
    stride: 6, bytes: 12, x: 0, y: 0, scale: 1,
    layout: { outputs: 1, name: "WL-0", x: 0, y: 0, width: 2, height: 2, scale: 1 }, ...change }));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(header.length);
  return Buffer.concat([prefix, header, payload]);
}

describe("explicit bounded KWin acquisition", () => {
  it.each([[new KwinFrameError("bad frame"), "daemon", "BackendUnreadable"],
    [new UnperformableElementError("NoAuthorized"), "world", "UnperformableElementError"]] as const)("preserves refusal ownership for %s", async (failure, owner, code) => {
    const backend = new AtspiBackend(replayChannel("gtk-dialog"), "all");
    vi.spyOn(backend, "captureElement").mockRejectedValueOnce(failure);
    try {
      const reply = await handleRequest({ type: "request", id: 1, method: "captureElement", params: { id: "target" } }, backend);
      expect(reply).toMatchObject({ result: { refusal: { class: owner, code } } });
    } finally { await backend.close(); }
  });
  it.each([true, false])("never falls back after helper denial or malformed output (%s)", async (denied) => {
    const actual = await vi.importActual<typeof processes>("node:child_process");
    vi.mocked(processes.spawn).mockImplementationOnce(((_file: string, _args: string[], options: processes.SpawnOptions) =>
      actual.spawn(process.execPath, ["-e", denied ? "process.stderr.write('capture: NoAuthorized');process.exit(1)" : "process.stdout.write('invalid')"], options)) as typeof processes.spawn);
    await expect(grabKwinPixels()).rejects.toThrow(denied ? "NoAuthorized" : "invalid KWin helper frame");
    expect(processes.spawn).toHaveBeenCalledTimes(1);
  });
  it("retains the default and rejects unknown selectors", () => {
    vi.stubEnv("MASTRA_CC_ATSPI_CAPTURE", undefined);
    expect(captureRoute()).toBe("xwd");
    expect(captureRoute("")).toBe("xwd");
    expect(captureRoute("kwin")).toBe("kwin");
    expect(() => captureRoute("other")).toThrow();
  });
  it("cancels through request context and waits for the actual TERM-ignoring process to exit", async () => {
    const actual = await vi.importActual<typeof processes>("node:child_process");
    let child: processes.ChildProcess | undefined;
    vi.mocked(processes.spawn).mockImplementationOnce(((_file: string, _args: string[], options: processes.SpawnOptions) => {
      child = actual.spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"], options);
      return child;
    }) as typeof processes.spawn);
    const controller = new AbortController();
    const outcome = underCancellation(controller.signal, grabKwinPixels).catch(error => error);
    await new Promise<void>(resolve => child!.stdout!.once("data", () => resolve()));
    controller.abort();
    expect(await outcome).toBeInstanceOf(CancelledAtBoundaryError);
    expect(child!.signalCode).toBe("SIGKILL");
    expect(() => process.kill(child!.pid!, 0)).toThrow();
    expect(processes.spawn).toHaveBeenCalledWith("/usr/local/libexec/mastra-cc-kwin-capture", [],
      { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  });
  it("rejects an already cancelled request without spawning", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(underCancellation(controller.signal, grabKwinPixels)).rejects.toThrow(CancelledAtBoundaryError);
    expect(processes.spawn).not.toHaveBeenCalled();
  });
  it("decodes exact RGB frames", () => {
    expect(decodeKwinFrame(frame())).toEqual({ width: 2, height: 2, originX: 0, originY: 0, pixels: Buffer.alloc(12) });
  });
  it.each([{ width: -1 }, { height: 0 }, { bytes: 16777217 }, { stride: 7 },
    { version: 2 }, { format: "RGBA" }, { scale: 2 }, { x: 1 }, { layout: null }])("rejects contradictory metadata %j", (change) => {
    expect(() => decodeKwinFrame(frame(change))).toThrow(KwinFrameError);
  });
  it.each([0, 11, 13])("rejects incorrect payload length %s", (length) => {
    expect(() => decodeKwinFrame(frame({}, Buffer.alloc(length)))).toThrow(KwinFrameError);
  });
  it.each([["", 61], ["kwin", 61], ["kwin", 40]])("never acquires protected controls for route %s and role %s", async (route, numericRole) => {
    vi.stubEnv("MASTRA_CC_ATSPI_CAPTURE", route);
    const tape = replayChannel("gtk-dialog");
    let protectedTarget = false;
    const backend = new AtspiBackend({
      call: (exchange) => exchange.member === "GetRole" ? Promise.resolve([numericRole])
        : protectedTarget && exchange.member === "GetRoleName"
          ? Promise.resolve([numericRole === 40 ? "text" : "password text"]) : tape.call(exchange),
      watch: (request, sink, anchor) => tape.watch(request, sink, anchor),
      close: () => tape.close(),
    }, "all");
    try {
      const { elements } = await backend.queryElements({ role: "label" });
      expect(elements.length).toBeGreaterThan(0);
      protectedTarget = true;
      await expect(backend.captureElement({ id: elements[0]!.id })).rejects.toThrow(UnperformableElementError);
      expect(processes.spawn).not.toHaveBeenCalled();
    } finally { await backend.close(); }
  });
  it("does not acquire an element never exposed by the visibility grant", async () => {
    vi.stubEnv("MASTRA_CC_ATSPI_CAPTURE", "kwin");
    const backend = new AtspiBackend(replayChannel("gtk-dialog"));
    try {
      expect((await backend.queryElements({ role: "label" })).elements).toEqual([]);
      await expect(backend.captureElement({ id: "ungranted" })).rejects.toThrow(UnperformableElementError);
      expect(processes.spawn).not.toHaveBeenCalled();
    } finally { await backend.close(); }
  });
});
