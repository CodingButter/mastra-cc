import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { QueryElementsResult, ReadElementContentResult } from "@mastra-cc/protocol-types";
import { CdpBackend } from "../index.js";
import { liveCdpChannel } from "../channel.js";
import { followLaunchedBrowser, launchedBrowser, PipeBrowser } from "../pipe.js";
import type { LaunchCatalog } from "../../../launch/recipes.js";
import { launchApplication, terminateOwned } from "../../../launch/spawn.js";
import { OwnershipTable } from "../../../launch/table.js";

// THE DAEMON'S BROWSER HAS NO PORT (ADR-0119). Chrome is started the way the
// launch recipe starts it - --remote-debugging-pipe on fds 3/4 - and the
// unchanged CDP channel reads a real page through the pipe. Meanwhile the
// process listens on no TCP port at all, so nothing beside the daemon can
// drive it.

const PAGE = "data:text/html,<title>Piped</title><input aria-label=Field value=hello>";

function listeningPorts(pid: number): number[] {
  const inodes = new Set<string>();
  try {
    for (const fd of readdirSync(`/proc/${pid}/fd`)) {
      const link = readlinkSync(`/proc/${pid}/fd/${fd}`);
      const m = link.match(/^socket:\[(\d+)\]$/);
      if (m) inodes.add(m[1]!);
    }
  } catch {
    return [];
  }
  const ports: number[] = [];
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    for (const line of readFileSync(table, "utf8").split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      // st 0A is LISTEN
      if (cols[3] === "0A" && inodes.has(cols[9]!)) ports.push(parseInt(cols[1]!.split(":")[1]!, 16));
    }
  }
  return ports;
}

describe.skipIf(process.env.MASTRA_CC_LIVE !== "1")("the daemon's browser over a pipe", () => {
  it("launches through the recipe path, holds nothing open, and ends when terminated", { timeout: 60_000 }, async () => {
    const profile = mkdtempSync(join(tmpdir(), "mastra-cc-cdp-pipe-"));
    const catalog: LaunchCatalog = {
      chrome: {
        argv: ["google-chrome", "--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run", PAGE],
        env: {},
        appearsAs: "chrome",
        sharesBrowserEndpoint: true,
        debugPipe: true,
      },
    };
    const table = new OwnershipTable();
    const holding = () => process.getActiveResourcesInfo().filter((r) => r === "PipeWrap" || r === "ProcessWrap").length;
    const before = holding();
    const { pid } = await launchApplication("chrome", catalog, table);
    const backend = new CdpBackend(liveCdpChannel("http://127.0.0.1:1", followLaunchedBrowser()), "all");
    try {
      let fields: QueryElementsResult["elements"] = [];
      for (let i = 0; i < 50 && fields.length === 0; i++) {
        const answer = (await backend.queryElements({ application: "chrome", window: "Piped", name: "Field" })) as QueryElementsResult;
        fields = answer.elements ?? [];
        if (fields.length === 0) await new Promise((r) => setTimeout(r, 200));
      }
      expect(fields.length).toBeGreaterThan(0);
      // The browser and both pipe ends are unref'd: the daemon's event loop is
      // not held open by the browser it launched.
      expect(holding()).toBe(before);
      expect(listeningPorts(pid)).toEqual([]);
    } finally {
      await backend.close();
      terminateOwned(table);
      for (let i = 0; i < 50 && launchedBrowser() !== undefined; i++) await new Promise((r) => setTimeout(r, 100));
      rmSync(profile, { recursive: true, force: true });
    }
    // Terminating the browser closes its pipe; the daemon notices and stops routing to it.
    expect(launchedBrowser()).toBeUndefined();
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("reads a real page through the pipe while the browser listens on no port", { timeout: 60_000 }, async () => {
    const profile = mkdtempSync(join(tmpdir(), "mastra-cc-cdp-pipe-"));
    const chrome = spawn(
      "google-chrome",
      ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run", PAGE],
      { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
    );
    const browser = new PipeBrowser(chrome.stdio[3] as Writable, chrome.stdio[4] as Readable);
    const backend = new CdpBackend(liveCdpChannel("http://pipe.invalid", browser.deps()), "all");
    try {
      let fields: QueryElementsResult["elements"] = [];
      for (let i = 0; i < 50 && fields.length === 0; i++) {
        const answer = (await backend.queryElements({ application: "chrome", window: "Piped", name: "Field" })) as QueryElementsResult;
        fields = answer.elements ?? [];
        if (fields.length === 0) await new Promise((r) => setTimeout(r, 200));
      }
      expect(fields.length).toBeGreaterThan(0);
      const content = (await backend.readElementContent({ id: fields[0]!.id, offset: 0, limit: 100 })) as ReadElementContentResult;
      expect(content.content).toMatchObject({ kind: "text", value: "hello" });

      // Every child process of this Chrome (the browser process owns the
      // debugging endpoint) listens on no TCP port.
      expect(listeningPorts(chrome.pid!)).toEqual([]);
    } finally {
      await backend.close();
      const exited = new Promise<void>((resolve) => chrome.once("exit", () => resolve()));
      chrome.kill("SIGTERM");
      await exited;
      rmSync(profile, { recursive: true, force: true });
    }
  });
});
