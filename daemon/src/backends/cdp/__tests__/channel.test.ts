import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixturesDir } from "../../atspi/channel.js";
import {
  captureCdpChannel,
  type CdpChannel,
  type CdpExchange,
  CdpUnreachableError,
  exchangeKey,
  liveCdpChannel,
  replayCdpChannel,
  UnrecordedCdpExchangeError,
} from "../channel.js";

// Offline tests construct CdpExchange values in memory and answer them from a
// stub inner channel - that is unit input, not a hand-authored tape. The
// round-trip fixture is written by the REAL capture path and read by the REAL
// replay path; only the innermost channel is stubbed.

describe("the exchange key", () => {
  it("is deterministic and distinguishes exchanges that differ only in params", () => {
    const base: CdpExchange = { kind: "call", targetId: "t1", method: "Accessibility.getFullAXTree", params: { depth: 1 } };
    expect(exchangeKey(base)).toBe(exchangeKey({ ...base }));
    expect(exchangeKey({ ...base, params: { depth: 2 } })).not.toBe(exchangeKey(base));
    expect(exchangeKey({ kind: "version" })).not.toBe(exchangeKey({ kind: "list" }));
  });

  it("treats absent params as null - the shape replay looks up by", () => {
    const withNull: CdpExchange = { kind: "call", targetId: "t1", method: "Accessibility.enable", params: null };
    const withUndefined: CdpExchange = { kind: "call", targetId: "t1", method: "Accessibility.enable", params: undefined };
    expect(exchangeKey(withUndefined)).toBe(exchangeKey(withNull));
  });
});

// A stub inner channel: answers from a fixed table, counts nothing, dials
// nothing. What flows through capture is real; only the far end is canned.
function stubChannel(replies: Map<string, unknown>): CdpChannel {
  return {
    async exchange(e) {
      const reply = replies.get(exchangeKey(e));
      if (reply === undefined) throw new Error(`stub: no reply prepared for ${exchangeKey(e)}`);
      return reply;
    },
    async close() {},
  };
}

describe("capture then replay", () => {
  // The capture path writes under the package's fixtures directory by
  // design (a daemon started anywhere must write to the same place), so the
  // round trip uses a unique throwaway fixture name and removes it after.
  const fixture = `test-cdp-roundtrip-${process.pid}`;

  afterEach(() => {
    rmSync(join(fixturesDir(), fixture), { recursive: true, force: true });
  });

  it("replays recorded replies and refuses an exchange not on the tape", async () => {
    const version: CdpExchange = { kind: "version" };
    const list: CdpExchange = { kind: "list" };
    const call: CdpExchange = { kind: "call", targetId: "t1", method: "Accessibility.getFullAXTree", params: {} };
    const replies = new Map<string, unknown>([
      [exchangeKey(version), { Browser: "Chrome/150.0.0.0", webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/browser/x" }],
      [exchangeKey(list), [{ id: "t1", type: "page", url: "http://127.0.0.1:1/page.html" }]],
      [exchangeKey(call), { result: { nodes: [{ nodeId: "1", role: { value: "RootWebArea" } }] } }],
    ]);

    const capture = captureCdpChannel(stubChannel(replies), fixture);
    const recordedVersion = await capture.exchange(version);
    const recordedList = await capture.exchange(list);
    const recordedCall = await capture.exchange(call);
    await capture.close();

    const replay = replayCdpChannel(fixture);
    expect(await replay.exchange(version)).toEqual(recordedVersion);
    expect(await replay.exchange(list)).toEqual(recordedList);
    expect(await replay.exchange(call)).toEqual(recordedCall);

    // Off-tape: refuse-on-ignorance, never invention. This assertion is the
    // kill test for the cdp-replay-invents-replies mutation - the
    // conformance suite only ever issues on-tape exchanges and cannot kill
    // it.
    const offTape: CdpExchange = { kind: "call", targetId: "t1", method: "DOM.describeNode", params: { nodeId: 7 } };
    await expect(replay.exchange(offTape)).rejects.toBeInstanceOf(UnrecordedCdpExchangeError);
    await expect(replay.exchange(offTape)).rejects.toThrow("refusing to invent a reply");
    await replay.close();
  });
});

// A hang is not a refusal: a socket that dies mid-call must reject the
// pending exchange, or the server's serialised chain never advances again.
// The far end here is a minimal loopback endpoint built on node builtins -
// it answers discovery, accepts the WebSocket upgrade, then destroys the
// connection on the first frame instead of replying. No browser involved,
// so this runs in the offline lane.
describe("a socket that closes mid-call", () => {
  it("rejects the pending exchange instead of hanging", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/json/version") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ Browser: "Chrome/150.0.0.0" }));
        return;
      }
      if (req.url === "/json/list") {
        const port = (server.address() as { port: number }).port;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify([
            {
              id: "t1",
              type: "page",
              url: `http://127.0.0.1:${port}/page.html`,
              webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/t1`,
            },
          ]),
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    server.on("upgrade", (req, socket) => {
      const key = req.headers["sec-websocket-key"];
      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      // The first frame the client sends is the rpc - kill the connection
      // instead of answering it.
      socket.on("data", () => socket.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const channel = liveCdpChannel(`http://127.0.0.1:${port}`);
    try {
      await channel.exchange({ kind: "list" });
      const call: CdpExchange = { kind: "call", targetId: "t1", method: "Accessibility.enable", params: {} };
      await expect(channel.exchange(call)).rejects.toBeInstanceOf(CdpUnreachableError);
      await expect(channel.exchange(call)).rejects.toThrow("closed before");
    } finally {
      await channel.close();
      server.close();
    }
  }, 10_000);
});

// The live lane spawns its OWN headless Chrome on an OS-assigned port and
// kills only the pid it spawned itself. Skipped loudly without a live
// desktop opt-in, like every live-lane suite in this repository.
describe.skipIf(process.env.MASTRA_CC_LIVE !== "1")("the live channel against a real browser", () => {
  it(
    "discovers, calls, captures and replays against a self-spawned headless Chrome",
    async () => {
      const profile = mkdtempSync(join(tmpdir(), "mastra-cc-cdp-live-"));
      const fixture = `test-cdp-live-${process.pid}`;
      const chrome = spawn(
        "google-chrome",
        ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      try {
        // Chrome prints "DevTools listening on ws://127.0.0.1:<port>/..." to
        // stderr once the endpoint is up (shape proven at plan time).
        const port = await new Promise<number>((resolve, reject) => {
          let buffered = "";
          const timer = setTimeout(() => reject(new Error(`no DevTools line from Chrome; stderr so far: ${buffered}`)), 15_000);
          chrome.stderr.on("data", (chunk: Buffer) => {
            buffered += chunk.toString();
            const match = buffered.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
            if (match) {
              clearTimeout(timer);
              resolve(Number(match[1]));
            }
          });
        });

        const live = liveCdpChannel(`http://127.0.0.1:${port}`);
        const capture = captureCdpChannel(live, fixture);

        const version = (await capture.exchange({ kind: "version" })) as { Browser?: string };
        expect(typeof version.Browser).toBe("string");

        const list = (await capture.exchange({ kind: "list" })) as Array<{ id: string; type: string }>;
        expect(Array.isArray(list)).toBe(true);
        const page = list.find((t) => t.type === "page");
        expect(page).toBeDefined();
        const targetId = (page as { id: string }).id;

        const enable: CdpExchange = { kind: "call", targetId, method: "Accessibility.enable", params: {} };
        const tree: CdpExchange = { kind: "call", targetId, method: "Accessibility.getFullAXTree", params: {} };
        const enabled = await capture.exchange(enable);
        const nodes = (await capture.exchange(tree)) as { result?: { nodes?: unknown[] } };
        expect(Array.isArray(nodes.result?.nodes)).toBe(true);
        expect((nodes.result?.nodes ?? []).length).toBeGreaterThan(0);

        await capture.close(); // writes the tape, closes the sockets

        const replay = replayCdpChannel(fixture);
        expect(await replay.exchange({ kind: "version" })).toEqual(version);
        expect(await replay.exchange({ kind: "list" })).toEqual(list);
        expect(await replay.exchange(enable)).toEqual(enabled);
        expect(await replay.exchange(tree)).toEqual(nodes);
        const offTape: CdpExchange = { kind: "call", targetId, method: "DOM.getDocument", params: {} };
        await expect(replay.exchange(offTape)).rejects.toBeInstanceOf(UnrecordedCdpExchangeError);
        await replay.close();
      } finally {
        // Only the pid this test spawned itself - and wait for it to exit
        // before removing the profile, or Chrome's shutdown writes race the
        // removal (observed: ENOTEMPTY).
        const exited = new Promise<void>((resolve) => {
          chrome.once("exit", () => resolve());
        });
        chrome.kill("SIGTERM");
        await exited;
        rmSync(join(fixturesDir(), fixture), { recursive: true, force: true });
        rmSync(profile, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
