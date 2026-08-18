import { mkdtempSync } from "node:fs";
import { connect as netConnect, createServer as netCreateServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCHEMA_DIGEST, type SemanticElement } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import { liveCdpChannel } from "../backends/cdp/channel.js";
import { CdpBackend } from "../backends/cdp/index.js";
import { OwnershipTable } from "../launch/table.js";
import { BACKEND_UNREADABLE_REFUSAL, handleRequest, type LaunchContext } from "../server.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// Both tests in this file pin the unreadable-backend semantics: a backend
// that throws is (1) an honest named refusal on the wire - never a raw
// system error - and (2) "no daemon-visible application" to the launch path,
// so a launch may proceed and its poll may wait out a backend that is not
// readable YET. The second test carries the launch-poll name despite living
// here because it is the same semantics from the launch path's side - the
// Phase 3 green leg (open chrome while no chrome is up) depends on it.
// This file may open a raw socket: B5 scans client-side code only.

// An EXPLICITLY-closed ephemeral port: bind to 0, note the port, close it.
// Never the fixed debug port - a developer's own capture Chrome could be
// listening there and flip the test.
async function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = netCreateServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

function lines(socket: Socket, count: number): Promise<string[]> {
  return new Promise((resolve) => {
    const seen: string[] = [];
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        seen.push(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (seen.length >= count) resolve(seen);
      }
    });
  });
}

describe("an unreachable browser is a named refusal, not a crash", () => {
  it("a wire queryElements over a dead endpoint returns the constant and keeps serving", async () => {
    const { startServer } = await import("../server.js");
    const port = await closedPort();
    const backend = new CdpBackend(liveCdpChannel(`http://127.0.0.1:${port}`));
    const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-unreadable-")), "daemon.sock");
    const server: Server = await startServer({ socketPath, backend });
    try {
      const socket = netConnect(socketPath);
      const received = lines(socket, 3);
      socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
      socket.write(`${JSON.stringify({ type: "request", id: 1, method: "queryElements", params: {} })}\n`);
      socket.write(`${JSON.stringify({ type: "request", id: 2, method: "queryElements", params: {} })}\n`);
      const [, first, second] = await received;
      for (const line of [first, second]) {
        const parsed = JSON.parse(line) as { refusal?: string; result?: unknown };
        // equality, not substring: the constant IS the whole answer
        expect(parsed.refusal).toBe(BACKEND_UNREADABLE_REFUSAL);
        expect(parsed.result).toBeUndefined();
        expect(line).not.toContain("ECONNREFUSED");
        expect(line).not.toContain("fetch");
      }
      socket.destroy();
    } finally {
      server.close();
      await backend.close();
    }
  });

  it("launch tolerates a backend that is not readable yet - the poll waits it out", async () => {
    const application: SemanticElement = {
      id: "app-000000000001",
      role: "application",
      name: "test-app",
      states: ["enabled", "visible"],
      actions: [],
    };
    let calls = 0;
    const flaky: Backend = {
      ...observeOnlyEffects,
      name: "flaky",
      // throws for the pre-spawn check AND the first poll ticks, then answers
      queryElements: async () => {
        calls += 1;
        if (calls <= 3) throw new Error("endpoint not up yet");
        return { elements: [application] };
      },
      attestElement: async () => ({}),
      subscribeElement: async () => {
        throw new Error("this test never watches");
      },
      unsubscribeElement: async () => undefined,
      close: async () => undefined,
    };
    const table = new OwnershipTable();
    const context: LaunchContext = {
      permits: new Set(["test-app"]),
      catalog: { "test-app": { argv: ["sleep", "30"], env: {} } },
      table,
      pollBudgetMs: 2000,
      pollIntervalMs: 10,
    };
    const response = await handleRequest(
      { type: "request", id: 1, method: "openApplication", params: { name: "test-app" } },
      flaky,
      context,
    );
    const result = response.result as { application?: SemanticElement; refusal?: string };
    try {
      // the pre-spawn check treated the throwing backend as "no daemon-visible
      // application" (so the spawn happened), and the poll outlasted the throws
      expect(result.refusal).toBeUndefined();
      expect(result.application?.name).toBe("test-app");
      expect(table.entries()).toHaveLength(1);
      expect(calls).toBeGreaterThan(3);
    } finally {
      for (const entry of table.entries()) process.kill(entry.pid, "SIGKILL");
    }
  });
});
