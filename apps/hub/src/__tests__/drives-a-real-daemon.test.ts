import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leakedTerms } from "@mastra-cc/daemon";
import { connect, type TransportClient } from "@mastra-cc/transport";
import { mintToolSurface } from "../tools/mint.js";

// THE HUB DRIVES A REAL DAEMON PROCESS AND READS A REAL ELEMENT.
//
// The other hub test starts the daemon in-process with startServer. That is a
// good unit test and it is not this: an in-process daemon shares this process's
// module registry, its memory and its lifetime, and it can pass while the
// BUILT artefact a machine would actually run is broken. Here the daemon is
// spawned as a separate process from dist, reached over a real unix socket, and
// killed at the end.
//
// "A real element" is the load-bearing phrase, so it is said plainly: this leg
// reads the committed gtk-dialog CAPTURE - a recording of a real accessibility
// tree taken from a live yad dialog, not a synthetic element - through the
// replay backend, which is what makes it deterministic and runnable in CI. The
// live leg, against a running desk, is a transcript beside this file's plan and
// is not this test. Presenting the tape leg as a live measurement is the
// failure this comment exists to prevent.

const DIST = join(__dirname, "..", "..", "..", "..", "daemon", "dist", "main.mjs");
const scratch = mkdtempSync(join(tmpdir(), "hub-drives-daemon-"));
const socketPath = join(scratch, "daemon.sock");
const auditPath = join(scratch, "audit.jsonl");

let daemon: ChildProcess | undefined;
let client: TransportClient | undefined;

beforeAll(async () => {
  expect(existsSync(DIST), `no built daemon at ${DIST} - a test against a missing artefact proves nothing`).toBe(true);
  daemon = spawn(
    process.execPath,
    // --grant yad, because the daemon is deny-by-default and a run with no
    // grant answers an empty list - which would let every assertion below pass
    // against a daemon that read nothing.
    [
      DIST,
      "--backend",
      "replay",
      "--fixture",
      "gtk-dialog",
      "--socket",
      socketPath,
      "--audit",
      auditPath,
      "--grant",
      "yad",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise<void>((resolve, reject) => {
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      daemon!.stdout!.off("data", onData);
      daemon!.off("exit", onExit);
      finish();
    };
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes("listening")) settle(resolve);
    };
    const onExit = () => settle(() => reject(new Error("the daemon died before it listened")));
    const timer = setTimeout(() => settle(() => reject(new Error("the daemon never said it was listening"))), 10_000);
    daemon!.stdout!.on("data", onData);
    daemon!.once("exit", onExit);
  });
  client = await connect({ socketPath });
}, 20_000);

afterAll(() => {
  client?.close();
  daemon?.kill("SIGKILL");
  rmSync(scratch, { recursive: true, force: true });
});

describe("the hub drives a real daemon process and reads a real element", () => {
  it("reads the recorded dialog's OK elements by identity, over a socket, from a separate process", async () => {
    const surface = mintToolSurface({ client: client! });
    const answer = (await surface.get("queryElements")!.execute({ name: "OK" })) as {
      elements: { id: string; role: string; name: string }[];
    };

    // The capture found a label and a button both named OK; both replay.
    expect(answer.elements).toHaveLength(2);
    for (const element of answer.elements) {
      expect(element.id).toMatch(/^el-[0-9a-f]{12}$/);
    }
    expect(answer.elements.map((e) => e.role).sort()).toEqual(["button", "label"]);
  });

  // NAMED FOR WHAT IT MEASURES. Exit box 5 says "every element touched"; this
  // asserts the elements the query ANSWERED, which ADR-0050 records as a
  // deliberate divergence - a walk reads up to 2500 nodes and recording all of
  // them would put every element name on the desktop into the record. The two
  // readings are not the same claim, so this title does not borrow the box's
  // wording. Whether the box moves is not this test's to decide.
  it("the audit file names every element the run answered, and nothing else", () => {
    const record = readFileSync(auditPath, "utf8");
    const lines = record.trim().split("\n").filter(Boolean);
    // A content check against an empty file passes forever. The count is the
    // guard: this run made exactly one request, so the record holds one entry.
    expect(lines.length).toBeGreaterThan(0);
    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const reads = entries.filter((e) => e.outcome === "read");
    expect(reads).toHaveLength(1);

    const entry = reads[0]!;
    expect(Object.keys(entry).sort()).toEqual(
      ["application", "at", "attestation", "cause", "element", "outcome", "scope"].sort(),
    );
    expect(entry.scope).toBe("observe");
    expect(entry.application).toBeNull();
    // Both answered elements named, by identity only - the query answered two,
    // and an entry naming one would be under-reporting that looks scored.
    const elements = entry.element as { id: string; role: string }[];
    expect(elements).toHaveLength(2);
    expect(elements.map((e) => e.role).sort()).toEqual(["button", "label"]);
    for (const element of elements) {
      expect(Object.keys(element).sort()).toEqual(["id", "role"]);
    }

    // The cross-process case, run through the daemon's OWN detector rather
    // than a second implementation of it here. The vocabulary comes from the
    // tape this run actually read, so it cannot decay into a stale term list.
    // The tape's accessible NAMES specifically - what the tree said about
    // itself. Not every string in the file: a role like "label" is recorded on
    // purpose, and a detector that flagged it would be measuring the entry
    // shape rather than a leak.
    const tape = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "..", "..", "daemon", "fixtures", "gtk-dialog", "tape.json"), "utf8"),
    ) as { exchanges: { member: string; body?: unknown[]; reply?: unknown[] }[] };
    const words = new Set<string>();
    for (const exchange of tape.exchanges) {
      if (exchange.reply === undefined) continue;
      const named =
        exchange.member === "GetName" ||
        (exchange.member === "Get" && (exchange.body as string[] | undefined)?.[1] === "Name");
      if (named && typeof exchange.reply[0] === "string") words.add(exchange.reply[0]);
    }
    // The application's own name IS recorded, by design - though not on this
    // entry, which is a read and names no application.
    words.delete("yad");
    words.delete("");
    const vocabulary = [...words];
    expect(vocabulary.length).toBeGreaterThan(3);
    // And it holds the name THIS run's two elements are called. A vocabulary
    // that drifted to four unrelated strings would satisfy the count and the
    // planted-term check below while never searching for the one word a leak
    // would actually be made of.
    expect(vocabulary).toContain("OK");
    // The instrument is proven to bite before its silence is read as a finding.
    expect(leakedTerms(`${record}${vocabulary[0]}`, vocabulary)).toContain(vocabulary[0]);
    expect(leakedTerms(record, vocabulary)).toEqual([]);
  });

  it("the daemon process is still the one this test started, and dies when asked", async () => {
    expect(daemon!.exitCode).toBeNull();
    const death = await new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      daemon!.once("exit", (code, signal) => resolve({ code, signal }));
      daemon!.kill("SIGTERM");
    });
    // Died by code, not by signal: the daemon's own handler ran.
    expect(death.signal).toBeNull();
    expect(death.code).toBe(0);
  }, 15_000);
});
