import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { connect as netConnect } from "node:net";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
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

async function deathBy(
  signal: NodeJS.Signals,
  extra: { argv?: string[]; tag?: string; beforeSignal?: (context: { socket: string; wsPort?: number }) => Promise<void> } = {},
): Promise<{ code: number | null; signal: string | null }> {
  const socket = join(scratch, `${extra.tag ?? ""}${signal}.sock`);
  const argv = [DIST, "--backend", "replay", "--fixture", "gtk-dialog", "--socket", socket, ...(extra.argv ?? [])];
  const wantsWebSocket = (extra.argv ?? []).includes("--ws-port");
  let wsPort: number | undefined;
  const child = spawn(process.execPath, argv, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      // Every listener here belongs to the readiness question and to nothing
      // after it. Left attached, the stdout handler keeps scanning every later
      // byte and the exit handler rejects a promise that already settled - a
      // rejection nobody is waiting for, arriving during the very shutdown this
      // test exists to measure. Each route out goes through settle().
      const settle = (finish: () => void) => {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        child.off("exit", onExit);
        finish();
      };
      // Accumulate rather than test each chunk: with two listeners there are
      // two readiness lines, they can arrive in either order and in separate
      // chunks, and the stdout listener is detached at settle - so a port line
      // landing after the socket line would otherwise be lost forever.
      let out = "";
      const onData = (chunk: Buffer) => {
        out += chunk.toString();
        const port = /daemon: websocket listening on \S+?:(\d+)/.exec(out);
        if (port) wsPort = Number(port[1]);
        const ready = /daemon: listening on \//.test(out);
        if (ready && (!wantsWebSocket || wsPort !== undefined)) settle(resolve);
      };
      const onExit = () => settle(() => reject(new Error("the daemon died before it listened")));
      const timer = setTimeout(
        () => settle(() => reject(new Error("the daemon never said it was listening"))),
        10_000,
      );
      child.stdout.on("data", onData);
      child.once("exit", onExit);
    });
  } catch (error) {
    // a failing case must not orphan the daemon it spawned - in THIS file of
    // all files, a leaked process would be the joke writing itself
    child.kill("SIGKILL");
    throw error;
  }
  if (extra.beforeSignal) await extra.beforeSignal({ socket, wsPort });
  child.kill(signal);
  return new Promise((resolve) => {
    child.once("exit", (code, sig) => resolve({ code, signal: sig }));
  });
}

describe("the daemon dies through its own handler", () => {
  it("the built daemon exists - a test against a missing artefact proves nothing", () => {
    expect(existsSync(DIST)).toBe(true);
  });

  it("the BUILT artefact carries all three signals - an mtime check false-reds when the mutation runner's restore rewrites identical bytes with a fresh timestamp, so the dist is pinned by content, not by clock", () => {
    // this is a stale-build guard for the signal behaviour specifically, not
    // source/dist equivalence - that is issue #26's scope
    const bundle = readFileSync(DIST, "utf8");
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      expect(bundle, `dist/main.mjs does not carry ${signal} - a stale artefact`).toContain(`"${signal}"`);
    }
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

  // The second pipe does not get to weaken the guarantee. Same three signals,
  // both listeners bound, a live connection on each - still death by code.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    it(`${signal} still runs the handler with a websocket listener bound and clients on both pipes`, async () => {
      const death = await deathBy(signal, {
        argv: ["--ws-port", "0"],
        tag: "ws-",
        beforeSignal: async ({ socket, wsPort }) => {
          expect(wsPort).toBeGreaterThan(0);
          const unix = netConnect(socket);
          const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
          await Promise.all([
            new Promise<void>((resolve) => unix.once("connect", () => resolve())),
            new Promise<void>((resolve) => ws.addEventListener("open", () => resolve(), { once: true })),
          ]);
          unix.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
          ws.send(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`);
        },
      });
      expect(death.signal).toBeNull();
      expect(death.code).toBe(0);
    }, 15_000);
  }

  it("opens no port at all when nobody asked for one - read off the running process, not off a mock", async () => {
    // A "the function was not called" assertion is a claim about our own code.
    // This asks the kernel what the daemon actually holds open.
    const socket = join(scratch, "no-port.sock");
    const child = spawn(process.execPath, [DIST, "--backend", "replay", "--fixture", "gtk-dialog", "--socket", socket], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        let out = "";
        const timer = setTimeout(() => reject(new Error("the daemon never said it was listening")), 10_000);
        child.stdout.on("data", (chunk: Buffer) => {
          out += chunk.toString();
          if (/daemon: listening on \//.test(out)) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      const listeners = execFileSync("ss", ["-ltnpH"], { encoding: "utf8" })
        .split("\n")
        .filter((line) => line.includes(`pid=${child.pid},`));
      expect(listeners, `the daemon is listening on a port nobody asked for: ${listeners.join(" | ")}`).toEqual([]);
    } finally {
      child.kill("SIGKILL");
    }
  }, 15_000);
});
