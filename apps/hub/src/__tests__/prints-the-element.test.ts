import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { registry, startServer } from "@mastra-cc/daemon";
import { run } from "../index.js";

// End to end over a real unix socket: a real daemon (replay backend answering
// from the committed gtk-dialog capture - a recording of a real tree, not a
// synthetic element), the real transport, and the hub's own printing. The
// daemon is imported and started in-process - the hub itself never touches
// node:net (B5); everything socket-shaped it does goes through
// @mastra-cc/transport.

const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-hub-")), "daemon.sock");
// visibility "all": this file witnesses hub printing, not grant policy
// (deny-by-default is the daemon's invisibility.test.ts's job)
const serverPromise = startServer({ socketPath, backend: registry.replay({ visibility: "all" }) });

afterAll(async () => {
  (await serverPromise).close();
});

describe("the hub prints the element the daemon answers", () => {
  it("prints role, name and id for the recorded dialog's OK button", async () => {
    await serverPromise;
    const lines: string[] = [];
    const code = await run(["--query", "OK", "--socket", socketPath], (l) => lines.push(l));
    expect(code).toBe(0);
    // the capture (yad, sandboxed headless bus) found a button and a label
    // named OK; both replay
    expect(lines).toHaveLength(2);
    expect(lines.filter((l) => /^element: role=button name="OK" id=el-[0-9a-f]{12}$/.test(l))).toHaveLength(1);
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
