import { readFileSync, readdirSync } from "node:fs";
import { applicationName } from "../backends/atspi/names.js";

// The ownership table (ADR-0029): the daemon knows what it launched because
// it records (pid, /proc start time) at launch. The pair is the identity -
// pids recycle, and a recycled pid with a different start time is NOT ours.
// Entries are created by exactly one code path: the daemon's own launch call
// (spawn.ts). The table can therefore never claim a user-started process.
//
// The table answers "may the assistant act in this window" - it never answers
// "is this content scratch or the user's work": a fresh launch can restore
// yesterday's document (docs/proofs/how-the-daemon-knows-what-it-launched.md).
//
// Granularity note: at the current granularity, ownership joins to the
// accessibility tree BY NAME (ownsName). The wire semanticElement carries no
// pid, and extending the internal backend surface for a per-element pid would
// drag the replay backend and conformance suite along with it. The
// per-element pid join (proven possible in the ownership spike via the
// accessibility layer's reported pid) is deferred to M2.4's attribution work.
//
// A launch first records the direct child. Once the application is readable,
// the launch path may transfer that record to the single newly appeared root
// process whose published process name matches the recipe. This keeps an
// exec/fork wrapper from orphaning the real application while still refusing
// ambiguous or pre-existing same-name processes. Descendants remain owned
// through the bounded parent walk while the recorded root lives.

export interface OwnedEntry {
  readonly pid: number;
  /** field 22 of /proc/<pid>/stat - clock ticks since boot; string, compared verbatim */
  starttime: string;
  /** the catalog key this launch served, NFKC-normalised, case-folded */
  readonly name: string;
}

interface StatFields {
  readonly ppid: number;
  readonly starttime: string;
}

export interface ProcessIdentity extends StatFields {
  readonly pid: number;
}

export type ProcessSnapshot = ReadonlyMap<number, string>;

export function namedProcessSnapshot(name: string): ProcessSnapshot {
  const wanted = applicationName(name);
  const found = new Map<number, string>();
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    let comm: string;
    try {
      comm = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    } catch {
      continue;
    }
    if (applicationName(comm) !== wanted) continue;
    const stat = readStat(pid);
    if (stat !== undefined) found.set(pid, stat.starttime);
  }
  return found;
}

// /proc/<pid>/stat: "pid (comm) state ppid ...". The comm field may contain
// spaces AND parentheses, so parsing splits after the LAST ")" - field 3
// (state) is the first token after it, field 22 (starttime) the twentieth.
export function readStat(pid: number): StatFields | undefined {
  let text: string;
  try {
    text = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return undefined; // dead or unreadable - fails safe to "not ours"
  }
  const close = text.lastIndexOf(")");
  if (close < 0) return undefined;
  const rest = text.slice(close + 1).trim().split(/\s+/);
  const ppid = Number(rest[1]);
  const starttime = rest[19];
  if (!Number.isInteger(ppid) || starttime === undefined) return undefined;
  return { ppid, starttime };
}

// A ppid walk longer than this is not a launch wrapper chain.
const MAX_ANCESTOR_HOPS = 32;

export class OwnershipTable {
  private readonly byPid = new Map<number, OwnedEntry>();

  /** Called only by the daemon's own launch path (spawn.ts). */
  record(pid: number, name: string): void {
    const stat = readStat(pid);
    if (stat === undefined) return; // died before we could read it - nothing to own
    this.byPid.set(pid, { pid, starttime: stat.starttime, name: applicationName(name) });
  }

  remove(pid: number): void {
    this.byPid.delete(pid);
  }

  adoptNewProcess(launcherPid: number, name: string, processName: string, before: ProcessSnapshot): OwnedEntry | undefined {
    const after = namedProcessSnapshot(processName);
    const candidates: ProcessIdentity[] = [];
    for (const [pid, starttime] of after) {
      if (before.get(pid) === starttime) continue;
      const stat = readStat(pid);
      if (stat !== undefined && stat.starttime === starttime) candidates.push({ pid, ...stat });
    }
    const direct = candidates.find(({ pid }) => pid === launcherPid);
    const candidatePids = new Set(candidates.map(({ pid }) => pid));
    const roots = candidates.filter(({ ppid }) => !candidatePids.has(ppid));
    const root = direct ?? (roots.length === 1 ? roots[0] : undefined);
    if (root === undefined) return undefined;
    const adopted = { pid: root.pid, starttime: root.starttime, name: applicationName(name) };
    this.byPid.delete(launcherPid);
    this.byPid.set(root.pid, adopted);
    return adopted;
  }

  /**
   * Is this process ours? True only when the pid resolves to a LIVE process
   * whose (pid, starttime) matches a recorded entry, or whose parent chain
   * (walked via /proc ppid) reaches a recorded, start-time-matching entry -
   * shell wrappers exec or fork, so a descendant of a launched pid is ours.
   * A recorded pid that is dead, or alive with a different start time
   * (recycled), answers not ours.
   */
  owns(pid: number): boolean {
    let current = pid;
    for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop += 1) {
      const stat = readStat(current);
      if (stat === undefined) return false;
      const entry = this.byPid.get(current);
      if (entry !== undefined && entry.starttime === stat.starttime) return true;
      if (stat.ppid <= 1) return false;
      current = stat.ppid;
    }
    return false;
  }

  /**
   * The by-name join: the recorded entry whose normalised name matches and
   * whose (pid, starttime) still resolves live, or nothing. This is what the
   * wire method's already-running and idempotent-re-open checks use.
   */
  ownsName(name: string): OwnedEntry | undefined {
    const wanted = applicationName(name);
    for (const entry of this.byPid.values()) {
      if (entry.name !== wanted) continue;
      const stat = readStat(entry.pid);
      if (stat !== undefined && stat.starttime === entry.starttime) return entry;
    }
    return undefined;
  }

  /** Diagnostic view; entries are live references (tests perturb starttime through this). */
  entries(): OwnedEntry[] {
    return [...this.byPid.values()];
  }
}
