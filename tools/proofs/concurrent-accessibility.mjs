// The debt 07-ROADMAP.md:80 makes an exit checkbox: M0.5 measured a
// deterministic SIGTRAP at 2+ threads through libatspi/GObject from Python
// (docs/proofs/is-the-accessibility-binding-thread-safe.md), a receipt that
// cannot transfer to a Node process that loads no native addon. This script
// takes the measurement on the route the daemon actually uses, and writes
// docs/proofs/is-concurrent-accessibility-safe-on-the-node-route.md.
//
// Rules it enforces on itself (docs/05-TEST-STRATEGY.md:160-163):
// - every run is a disposable child process, so an abort is a recorded exit
//   status, never a lost parent;
// - it writes NOTHING on a partial result - a missing run or an absent
//   duration refuses (exit 4) rather than producing a lying table;
// - --no-live exits 2 before touching anything, so the offline lane can prove
//   the refusal without a bus;
// - the artifact states its own hardware, date and limits.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { cpus, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DEFAULT_OUT = join(ROOT, "docs", "proofs", "is-concurrent-accessibility-safe-on-the-node-route.md");
const MODES = ["sequential", "concurrent-setup", "concurrent-use"];
const SIZES = [2, 4, 8];
const REPS = 3;

export function runMatrix() {
  const worker = join(HERE, "concurrent-worker.mjs");
  const results = [];
  for (const mode of MODES) {
    for (const n of SIZES) {
      for (let rep = 1; rep <= REPS; rep += 1) {
        const started = performance.now();
        const child = spawnSync(process.execPath, [worker, mode, String(n)], { encoding: "utf8", timeout: 30_000 });
        const wallMs = Math.round((performance.now() - started) * 10) / 10;
        let parsed = null;
        try {
          parsed = JSON.parse(child.stdout.trim().split("\n").at(-1) ?? "");
        } catch {
          parsed = null;
        }
        results.push({
          mode,
          n,
          rep,
          exit: child.status,
          signal: child.signal ?? null,
          wallMs,
          workerMs: parsed?.ms ?? null,
          apps: parsed?.apps ?? null,
          binding: parsed?.binding ?? null,
          stderr: child.status === 0 ? null : (child.stderr ?? "").trim().slice(0, 300) || null,
        });
      }
    }
  }
  return results;
}

// Refuses to render on a partial result: a missing cell, an absent exit
// status, or a duration that is not a finite number each throw. A partial
// table is a lying table (docs/05-TEST-STRATEGY.md:161).
export function renderArtifact(results, env) {
  const expected = MODES.length * SIZES.length * REPS;
  if (results.length !== expected) {
    throw new Error(`partial result: ${results.length} of ${expected} runs present - writing nothing`);
  }
  for (const mode of MODES) {
    for (const n of SIZES) {
      for (let rep = 1; rep <= REPS; rep += 1) {
        const run = results.find((r) => r.mode === mode && r.n === n && r.rep === rep);
        if (!run) throw new Error(`partial result: run ${mode} n=${n} rep=${rep} is missing - writing nothing`);
        if (run.exit === null && run.signal === null) {
          throw new Error(`partial result: run ${mode} n=${n} rep=${rep} has no exit status - writing nothing`);
        }
        if (!Number.isFinite(run.wallMs)) {
          throw new Error(`partial result: run ${mode} n=${n} rep=${rep} has no duration - writing nothing`);
        }
      }
    }
  }

  const failed = (mode) => results.filter((r) => r.mode === mode && (r.exit !== 0 || r.signal !== null));
  const sequentialFailures = failed("sequential");
  const setupFailures = failed("concurrent-setup");
  const useFailures = failed("concurrent-use");

  let verdict;
  if (sequentialFailures.length > 0) {
    verdict =
      "**The control failed.** Sequential connections did not all succeed, so the concurrent " +
      "results are not allowed to mean anything about concurrency. The failures are recorded above; " +
      "this artifact makes no concurrency claim.";
  } else if (setupFailures.length === 0 && useFailures.length === 0) {
    verdict =
      "**Neither was observed.** Every sequential control succeeded, and neither *concurrent setup* " +
      "nor *concurrent use* aborted, errored, or raised a signal at 2, 4 or 8 connections over three " +
      "repetitions each. On the Node route, in this process shape, on this machine, concurrent " +
      "accessibility access did not reproduce the Python route's abort.";
  } else {
    const parts = [];
    if (setupFailures.length > 0) parts.push(`**concurrent setup failed** (${setupFailures.length} run(s))`);
    if (useFailures.length > 0) parts.push(`**concurrent use failed** (${useFailures.length} run(s))`);
    verdict =
      `${parts.join(" and ")} while every sequential control succeeded - the failure is attributable ` +
      "to the named phase, which is exactly the separation this measurement exists to make.";
  }

  const rows = results
    .map(
      (r) =>
        `| ${r.mode} | ${r.n} | ${r.rep} | ${r.signal !== null ? `signal ${r.signal}` : r.exit} | ${r.wallMs} | ${
          r.workerMs ?? "-"
        } | ${r.apps ? r.apps.join("/") : "-"} |`,
    )
    .join("\n");

  return `# Is concurrent accessibility access safe on the Node route?

Produced by \`tools/proofs/concurrent-accessibility.mjs\` on ${env.date}.

M0.5 measured a deterministic SIGTRAP abort at two or more threads through
\`libatspi\`/GObject from Python
([is the accessibility binding thread-safe](is-the-accessibility-binding-thread-safe.md)),
and that artifact itself said the receipt cannot transfer to a process that
loads no native addon. [ADR-0030](../02-DECISIONS/0030-the-daemon-is-one-node-process.md)
clause 3 recorded the debt; this is the payment, on the route the daemon
actually uses: plain D-Bus over ${env.binding}, no \`libatspi\`, no GObject, no
threads.

## The separation, and how it is measured

The old artifact could not tell *concurrent connection setup aborts* from
*concurrent use of an established connection is unsafe*. This one can:

- **sequential** (the control) - open and read through each connection one at
  a time. Must succeed for the other rows to mean anything.
- **concurrent-setup** - open all N connections at once, then read each.
- **concurrent-use** - open and read through every connection sequentially
  FIRST, then read all N concurrently. A failure here is concurrent use, not
  setup, because every connection has already proved itself.

Each run is a disposable child process, so an abort is a recorded exit status.
A connection is counted established only after the socket, the authentication
handshake and one round-trip on the accessibility bus have completed; a read
is \`GetChildren\` on the registry root.

## Result

| mode | connections | rep | exit | wall ms | worker ms | apps seen |
|---|---|---|---|---|---|---|
${rows}

## Verdict, in the checkbox's own terms

${verdict}

The daemon **keeps serialising accessibility access in M1 regardless**: one
owner for the bus is what makes an audit record attributable
(\`docs/07-ROADMAP.md:92\`), which is a reason that does not depend on safety.
The measurement retires the *inherited* justification, not the design.

## Limits

- **Hardware and date:** ${env.cpu}, ${env.mem} GB RAM, Linux ${env.kernel}, Node ${env.node}, ${env.binding}; measured ${env.date}.
- **One machine, one desktop session.** The Python-route abort reproduced on a
  second machine; this measurement has not been repeated on one yet.
- **Connections, not threads.** The Node route is single-threaded by
  construction; what is exercised here is N independent bus connections in one
  process, opened and used concurrently on the event loop. No thread enters
  this measurement, so it neither confirms nor contradicts the Python
  artifact's finding about threads - it answers the question ADR-0030 clause 3
  actually owed.
- **Read-only.** Every exchange is a read (\`ListNames\`, \`GetChildren\`);
  concurrent *writes* are M2's problem, arriving with the first effect-class
  operation and B11.
`;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--no-live")) {
    console.error("concurrent-accessibility: --no-live - this proof needs a live accessibility bus; refusing without touching it, writing nothing");
    process.exit(2);
  }
  const outIndex = argv.indexOf("--out");
  const out = outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : DEFAULT_OUT;

  const results = runMatrix();
  const binding = results.find((r) => r.binding)?.binding ?? null;
  if (binding === null) {
    console.error("concurrent-accessibility: no run reported the binding identity - the bus is likely unreachable; writing nothing");
    for (const r of results.slice(0, 3)) if (r.stderr) console.error(`  ${r.mode} n=${r.n}: ${r.stderr}`);
    process.exit(3);
  }

  let artifact;
  try {
    artifact = renderArtifact(results, {
      date: new Date().toISOString().slice(0, 10),
      cpu: cpus()[0]?.model?.trim() ?? "unknown CPU",
      mem: Math.round(totalmem() / 1024 ** 3),
      kernel: release(),
      node: process.version,
      binding,
    });
  } catch (error) {
    console.error(`concurrent-accessibility: ${error.message}`);
    process.exit(4);
  }
  writeFileSync(out, artifact);
  for (const r of results) {
    console.log(
      `run mode=${r.mode} n=${r.n} rep=${r.rep} exit=${r.signal ?? r.exit} wall=${r.wallMs}ms apps=${r.apps ? r.apps.join("/") : "-"}`,
    );
  }
  console.log(`concurrent-accessibility: ${results.length} run(s) recorded to ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
