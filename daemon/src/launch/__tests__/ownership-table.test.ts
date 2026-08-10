import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OwnershipTable, readStat } from "../table.js";

// Real child processes and real /proc - zero fixtures. The (pid, start time)
// pair is the identity: a dead recorded pid, or an alive pid with a different
// start time (recycling), answers "not ours".

const children: ChildProcess[] = [];
const tempDirs: string[] = [];

function spawnTracked(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, { stdio: "ignore" });
  children.push(child);
  return child;
}

function waitForSpawn(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("spawn", () => resolve(child.pid as number));
    child.once("error", reject);
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", () => resolve()));
}

async function killAndWait(child: ChildProcess): Promise<void> {
  child.kill("SIGKILL");
  await waitForExit(child);
  // /proc entry disappears once the parent (this process) reaps the child,
  // which Node does before emitting "exit" - re-check to be certain.
  const pid = child.pid as number;
  for (let i = 0; i < 50 && readStat(pid) !== undefined; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await waitForExit(child);
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the ownership table", () => {
  it("owns a recorded live process and disowns it once dead", async () => {
    const table = new OwnershipTable();
    const child = spawnTracked("sleep", ["30"]);
    const pid = await waitForSpawn(child);
    table.record(pid, "test-sleep");
    expect(table.owns(pid)).toBe(true);

    await killAndWait(child);
    expect(table.owns(pid)).toBe(false); // dead recorded pid is not ours
  });

  it("does not own a pid it never recorded", () => {
    const table = new OwnershipTable();
    expect(table.owns(1)).toBe(false); // pid 1 is always alive and never ours
  });

  it("answers ownsName while the process lives and nothing after it dies", async () => {
    const table = new OwnershipTable();
    const child = spawnTracked("sleep", ["30"]);
    const pid = await waitForSpawn(child);
    table.record(pid, "test-sleep");

    const entry = table.ownsName("test-sleep");
    expect(entry).toBeDefined();
    expect(entry?.pid).toBe(pid);

    await killAndWait(child);
    // the dead-entry re-check: the entry may still sit in the table (nothing
    // removed it), but ownsName re-resolves liveness and answers nothing
    expect(table.ownsName("test-sleep")).toBeUndefined();
  });

  it("disowns a recorded pid whose start time no longer matches (recycling)", async () => {
    const table = new OwnershipTable();
    const child = spawnTracked("sleep", ["30"]);
    const pid = await waitForSpawn(child);
    table.record(pid, "test-sleep");
    expect(table.owns(pid)).toBe(true);

    // simulate pid recycling: the recorded start time differs from the live one
    const entry = table.entries().find((e) => e.pid === pid);
    expect(entry).toBeDefined();
    if (entry) entry.starttime = `${entry.starttime}0`;

    expect(table.owns(pid)).toBe(false);
    expect(table.ownsName("test-sleep")).toBeUndefined();
  });

  it("owns a descendant of a recorded pid through the ppid walk", async () => {
    const table = new OwnershipTable();
    // the trailing ":" forces a real fork - dash EXECs a sole command, which
    // would make the child inherit the recorded pid and pass vacuously via
    // the exact-match path instead of the walk
    const child = spawnTracked("sh", ["-c", "sleep 30; :"]);
    const shellPid = await waitForSpawn(child);
    table.record(shellPid, "test-shell");

    // find the forked sleep: the /proc process whose ppid is the shell
    let sleepPid: number | undefined;
    for (let i = 0; i < 100 && sleepPid === undefined; i += 1) {
      for (const dir of readdirSync("/proc")) {
        const candidate = Number(dir);
        if (!Number.isInteger(candidate) || candidate === shellPid) continue;
        if (readStat(candidate)?.ppid === shellPid) {
          sleepPid = candidate;
          break;
        }
      }
      if (sleepPid === undefined) await new Promise((r) => setTimeout(r, 20));
    }

    expect(sleepPid).toBeDefined();
    expect(sleepPid).not.toBe(shellPid); // the walk, not the exact match, must decide
    expect(table.owns(sleepPid as number)).toBe(true);
  });

  it("parses a comm containing spaces and parentheses", async () => {
    // /proc/<pid>/stat wraps comm in parentheses but does not escape it -
    // parsing must split after the LAST ")" or field 22 lands in the wrong place
    const dir = mkdtempSync(join(tmpdir(), "m21-comm-"));
    tempDirs.push(dir);
    const awkward = join(dir, "sle ep)x");
    copyFileSync("/usr/bin/sleep", awkward);
    chmodSync(awkward, 0o755);

    const table = new OwnershipTable();
    const child = spawnTracked(awkward, ["30"]);
    const pid = await waitForSpawn(child);
    table.record(pid, "awkward-comm");
    expect(table.owns(pid)).toBe(true);
    expect(table.ownsName("awkward-comm")?.pid).toBe(pid);
  });
});
