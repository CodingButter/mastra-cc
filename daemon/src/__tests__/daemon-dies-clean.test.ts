import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";

// A LAUNCHED APPLICATION DOES NOT OUTLIVE THE DAEMON (issue #14).
//
// The cleanup half of ownership runs in the daemon's signal handlers, so the
// whole guarantee rests on which signals actually reach a handler. The leak
// witnessed in M2.5 (qt6ct orphans reparented to systemd --user) was not the
// forking-wrapper story issue #14 suspected - measured on 2026-08-20,
// google-chrome EXECS in place and a SIGTERMed daemon reaps every recipe.
// The real mechanism was SIGHUP: what a closing shell sends a backgrounded
// daemon, and a signal the handler list did not carry. Node's default action
// exits without running terminateOwned, and everything the table owned is
// orphaned.
//
// So this file asserts the wiring AT THE PROCESS BOUNDARY, against the BUILT
// daemon - the artefact a machine would run - by sending each shutdown signal
// and reading how the process died. A handled signal exits BY CODE (the
// handler runs terminateOwned, closes, and calls process.exit(0)); an
// unhandled one dies BY SIGNAL. The reaping itself is proven elsewhere
// (spawn-records.test.ts unit-tests terminateOwned; the segment-4 shutdown
// demo proves the orphan live, red on base and green on this branch).
//
// The replay backend keeps this offline: a tape cannot launch anything, so no
// real process is ever spawned, and what is under test - which deaths run the
// handler - does not depend on one.

const DIST = join(__dirname, "..", "..", "dist", "main.mjs");

const scratch = mkdtempSync(join(tmpdir(), "daemon-dies-clean-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function deathBy(signal: NodeJS.Signals): Promise<{ code: number | null; signal: string | null }> {
  const socket = join(scratch, `${signal}.sock`);
  const child = spawn(process.execPath, [DIST, "--backend", "replay", "--fixture", "gtk-dialog", "--socket", socket], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("listening")) resolve();
    });
    child.once("exit", () => reject(new Error("the daemon died before it listened")));
    setTimeout(() => reject(new Error("the daemon never said it was listening")), 10_000);
  });
  child.kill(signal);
  return new Promise((resolve) => {
    child.once("exit", (code, sig) => resolve({ code, signal: sig }));
  });
}

describe("the daemon dies through its own handler", () => {
  it("the built daemon exists - a test against a missing artefact proves nothing", () => {
    expect(existsSync(DIST)).toBe(true);
  });

  it("the SOURCE carries all three signals - the behavioural cases above read the built dist, and a mutation edits source, so without this pin a source-level regression would be scored against a stale artefact and survive", () => {
    const source = readFileSync(join(__dirname, "..", "main.ts"), "utf8");
    expect(source).toContain('for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)');
  });

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    it(`${signal} runs the shutdown handler rather than node's default death`, async () => {
      const death = await deathBy(signal);
      // died by code, not by signal: the handler ran, and with it terminateOwned
      expect(death.signal).toBeNull();
      expect(death.code).toBe(0);
    }, 15_000);
  }
});
