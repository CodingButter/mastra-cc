import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { registry, startServer } from "@mastra-cc/daemon";
import { run } from "../index.js";

// End to end over a real unix socket: a real daemon (loopback backend), the
// real transport, and the hub's own printing. The daemon is imported and
// started in-process - the hub itself never touches node:net (B5); everything
// socket-shaped it does goes through @mastra-cc/transport.

const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-hub-")), "daemon.sock");
const serverPromise = startServer({ socketPath, backend: registry.loopback() });

afterAll(async () => {
  (await serverPromise).close();
});

describe("the hub prints the element the daemon answers", () => {
  it("prints role, name and id for the demo button", async () => {
    await serverPromise;
    const lines: string[] = [];
    const code = await run(["--query", "the demo button", "--socket", socketPath], (l) => lines.push(l));
    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^element: role=button name="the demo button" id=el-[0-9a-f]{12}$/);
  });

  it("reports no match without inventing an element", async () => {
    await serverPromise;
    const lines: string[] = [];
    const code = await run(["--query", "a button that does not exist", "--socket", socketPath], (l) => lines.push(l));
    expect(code).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("no element matched");
  });
});
