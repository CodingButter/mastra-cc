import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { liveCdpChannel } from "../channel.js";
import { PipeBrowser } from "../pipe.js";

// The pipe, offline: a fake browser on the far side of two streams, speaking
// NUL-delimited JSON exactly as --remote-debugging-pipe does.

function fakeBrowser() {
  const toBrowser = new PassThrough();
  const fromBrowser = new PassThrough();
  const seen: Array<Record<string, unknown>> = [];
  let buffer = "";
  const reply = (m: Record<string, unknown>) => fromBrowser.write(`${JSON.stringify(m)}\0`);
  let sessions = 0;
  toBrowser.setEncoding("utf8");
  toBrowser.on("data", (chunk: string) => {
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\0")) >= 0) {
      const m = JSON.parse(buffer.slice(0, end)) as { id: number; method: string; sessionId?: string; params?: Record<string, unknown> };
      buffer = buffer.slice(end + 1);
      seen.push(m);
      switch (m.method) {
        case "Browser.getVersion": reply({ id: m.id, result: { product: "Chrome/151", protocolVersion: "1.3" } }); break;
        case "Target.getTargets": reply({ id: m.id, result: { targetInfos: [{ targetId: "T1", type: "page", title: "One", url: "about:blank" }, { targetId: "T2", type: "page", title: "Two", url: "about:blank" }] } }); break;
        case "Target.attachToTarget": reply({ id: m.id, result: { sessionId: `S${++sessions}-${String(m.params?.targetId)}` } }); break;
        case "Target.detachFromTarget": reply({ id: m.id, result: {} }); break;
        case "Page.getFrameTree": reply({ id: m.id, sessionId: m.sessionId, result: { frameTree: { frame: { id: "F" } } } }); break;
        case "Echo.target": reply({ id: m.id, sessionId: m.sessionId, result: { from: m.sessionId } }); break;
        case "Never.answer": break;
        default: reply({ id: m.id, sessionId: m.sessionId, result: {} });
      }
    }
  });
  return { browser: new PipeBrowser(toBrowser, fromBrowser), seen, fromBrowser, reply };
}

describe("the browser over a pipe", () => {
  it("answers discovery from Browser.getVersion and Target.getTargets, with no HTTP", async () => {
    const { browser } = fakeBrowser();
    const channel = liveCdpChannel("http://pipe.invalid", browser.deps());
    expect(await channel.exchange({ kind: "version" })).toMatchObject({ Browser: "Chrome/151", webSocketDebuggerUrl: "pipe:browser" });
    expect(await channel.exchange({ kind: "list" })).toEqual([
      { id: "T1", type: "page", title: "One", url: "about:blank", webSocketDebuggerUrl: "pipe:T1" },
      { id: "T2", type: "page", title: "Two", url: "about:blank", webSocketDebuggerUrl: "pipe:T2" },
    ]);
  });

  it("routes each target's calls through its own flattened session, concurrently", async () => {
    const { browser, seen } = fakeBrowser();
    const channel = liveCdpChannel("http://pipe.invalid", browser.deps());
    await channel.exchange({ kind: "list" });
    const [one, two] = await Promise.all([
      channel.exchange({ kind: "call", targetId: "T1", method: "Echo.target", params: {} }),
      channel.exchange({ kind: "call", targetId: "T2", method: "Echo.target", params: {} }),
    ]);
    expect(one).toEqual({ result: { from: "S1-T1" } });
    expect(two).toEqual({ result: { from: "S2-T2" } });
    expect(seen.filter((m) => m.method === "Target.attachToTarget").map((m) => m.params)).toEqual([
      { targetId: "T1", flatten: true },
      { targetId: "T2", flatten: true },
    ]);
  });

  it("reassembles a message split across reads and several in one read", async () => {
    const { browser, fromBrowser } = fakeBrowser();
    const pending = browser.call("Browser.getVersion");
    // the fake answers itself too; a split duplicate for an unknown id is ignored
    fromBrowser.write('{"id":999,"res');
    fromBrowser.write('ult":{}}\0{"id":998,"result":{}}\0');
    expect(await pending).toMatchObject({ result: { product: "Chrome/151" } });
  });

  it("rejects what still waits when the browser's pipe closes, and says the session closed", async () => {
    vi.useFakeTimers();
    try {
      const { browser, fromBrowser } = fakeBrowser();
      const channel = liveCdpChannel("http://pipe.invalid", browser.deps());
      await channel.exchange({ kind: "list" });
      await channel.exchange({ kind: "call", targetId: "T1", method: "Echo.target", params: {} });
      const hung = channel.exchange({ kind: "call", targetId: "T1", method: "Never.answer", params: {} }).catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(10);
      fromBrowser.end();
      fromBrowser.destroy();
      await vi.advanceTimersByTimeAsync(10);
      expect(String(await hung)).toMatch(/closed before its call was answered/);
      expect(browser.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a session the browser detaches, so the next call attaches afresh", async () => {
    const { browser, seen, reply } = fakeBrowser();
    const channel = liveCdpChannel("http://pipe.invalid", browser.deps());
    await channel.exchange({ kind: "list" });
    await channel.exchange({ kind: "call", targetId: "T1", method: "Echo.target", params: {} });
    reply({ method: "Target.detachedFromTarget", params: { sessionId: "S1-T1" } });
    await new Promise((r) => setTimeout(r, 10));
    expect(await channel.exchange({ kind: "call", targetId: "T1", method: "Echo.target", params: {} })).toEqual({ result: { from: "S2-T1" } });
    expect(seen.filter((m) => m.method === "Target.attachToTarget")).toHaveLength(2);
  });
});

describe("the daemon's browser recipes", () => {
  it("speak over the pipe and open no debugging port", async () => {
    const { CATALOG } = await import("../../../launch/recipes.js");
    for (const name of ["chrome", "gmail"] as const) {
      const recipe = CATALOG[name]!;
      expect(recipe.argv).toContain("--remote-debugging-pipe");
      expect(recipe.argv.some((a) => a.startsWith("--remote-debugging-port"))).toBe(false);
      expect(recipe.debugPipe).toBe(true);
    }
  });
});
