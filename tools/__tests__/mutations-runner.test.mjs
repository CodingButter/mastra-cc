import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// The mutation runner's own guarantees, exercised against a scratch tree so no
// case ever mutates this repository's sources.
//
// The runner is the instrument every other claim in this milestone is scored by.
// Two of its properties are load-bearing and neither had a test:
//
//   - it puts the mutated file back however the run ends, including a signal
//     (issue #18: a Ctrl-C left a source file on disk with a line deleted);
//   - it reports its own breakage as its own breakage, rather than as a
//     catastrophic finding about the codebase (issue #25: a vitest that cannot
//     execute reads as "every mutation survived").
//
// Each case builds a miniature repository: a tools/mutations.json table, a fake
// vitest at tools/node_modules/.bin/vitest whose behaviour the case chooses, and
// a source file to mutate. The fake vitest is what makes the runner's failure
// modes reachable at all - a real one always works here.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const runner = join(repoRoot, "tools", "mutations.mjs");

const scratches = [];

afterEach(() => {
  while (scratches.length > 0) rmSync(scratches.pop(), { recursive: true, force: true });
});

// Builds a scratch tree. `vitest` is the shell script body standing in for the
// real binary; `source` is the file the table mutates.
function scratchTree({ vitest, source, find = "GUARDED_LINE\n", replace, entries = 1 }) {
  const root = mkdtempSync(join(tmpdir(), "mutations-runner-"));
  scratches.push(root);
  mkdirSync(join(root, "tools", "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(root, "subject"), { recursive: true });

  const sourcePath = join(root, "subject", "source.txt");
  writeFileSync(sourcePath, source);

  const binary = join(root, "tools", "node_modules", ".bin", "vitest");
  writeFileSync(binary, vitest);
  chmodSync(binary, 0o755);

  const table = Array.from({ length: entries }, (_, i) => ({
    name: entries === 1 ? "the-scratch-mutation" : `the-scratch-mutation-${i}`,
    file: "subject/source.txt",
    find,
    ...(replace === undefined ? {} : { replace }),
    cwd: "subject",
    testFile: "any.test.ts",
  }));
  writeFileSync(join(root, "tools", "mutations.json"), JSON.stringify(table, null, 2));

  return { root, sourcePath, source };
}

function runRunner(root) {
  return spawnSync(process.execPath, [runner, "--root", root], { encoding: "utf8" });
}

describe("the mutation runner puts the file back", () => {
  it("restores the mutated file when a run is interrupted mid-mutation", async () => {
    // The fake vitest sleeps, which gives the case a window in which the file on
    // disk is genuinely mutated. That window is the whole point: signalling a
    // runner that has already restored the file would prove nothing.
    //
    // The signal goes to the process GROUP, which is what a terminal Ctrl-C
    // does and is the interruption issue #18 is actually about. It matters here
    // for a measured reason: `spawnSync` blocks node's event loop, so a signal
    // sent to the runner alone cannot reach its handler until the whole table
    // has finished. Signalling the group kills the child too, which is how the
    // runner learns about the interruption at the only moment it can act on it.
    const { root, sourcePath, source } = scratchTree({
      vitest: "#!/bin/sh\ntouch vitest-started\nsleep 30\n",
      source: "keep this line\nGUARDED_LINE\nand this one\n",
    });

    const child = spawn(process.execPath, [runner, "--root", root], {
      stdio: ["ignore", "ignore", "pipe"],
      detached: true, // its own process group, so the signal cannot reach vitest's own
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));

    // Wait for the mutation to actually be on disk before signalling.
    const mutated = await waitFor(() => {
      const onDisk = readFileSync(sourcePath, "utf8");
      return onDisk !== source ? onDisk : null;
    });
    expect(mutated).not.toContain("GUARDED_LINE");

    // And wait for the fake vitest to actually be RUNNING before signalling.
    // A signal that lands in the gap between the mutation write and the spawn
    // reaches only the runner, whose queued handler cannot fire until the
    // synchronous loop ends - the fake vitest, spawned after the signal was
    // already delivered, then sleeps out its full 30 seconds untouched and the
    // test times out (seen once on CI). The fake vitest touches this marker as
    // its first act, so a signal sent after it exists reaches the whole group.
    const startedPath = join(root, "subject", "vitest-started");
    await waitFor(() => (existsSync(startedPath) ? true : null));

    const exit = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
    process.kill(-child.pid, "SIGINT");
    const ended = await exit;

    // The property that matters: the file holds its committed bytes again.
    expect(readFileSync(sourcePath, "utf8")).toBe(source);
    expect(stderr).toContain("interrupted by SIGINT");
    // And the run does not report a result for work it did not finish.
    expect(stderr).not.toContain("none survived");
    expect(ended.code).not.toBe(0);
    // THE BUDGET, AND WHY IT IS NOT 20 SECONDS. This case waits on two
    // conditions, each with a ten second budget of its own, and those waits are
    // what make its failures legible: `waitFor` names the condition that never
    // held. A twenty second case timeout is exactly the sum of them, so under
    // the parallel load of the full suite the case died of the timeout instead
    // - one run in six, reporting nothing but a line number. The headroom means
    // a slow machine still reaches the assertion, and a genuine failure still
    // says which half broke.
  }, 45000);

  it("restores the mutated file when the signal is sent to the runner alone", async () => {
    // The other half of issue #18, and the one with the subtler mechanism.
    //
    // A signal sent to the runner's PID alone does not reach vitest, so the
    // child keeps running and `spawnSync` keeps blocking node's event loop. The
    // handler therefore cannot run until the loop is over - registering it still
    // saves the file, because a registered handler removes node's default
    // disposition and the process no longer dies where it stands. That is the
    // difference this case measures: without the registration the run is killed
    // mid-mutation and the broken file stays on disk; with it, the `finally`
    // runs and the file comes back.
    //
    // Only the bytes are asserted. Whether this run dies of the deferred signal
    // or finishes its table first depends on how long the child takes, and an
    // assertion on that would be measuring the fixture's speed.
    const { root, sourcePath, source } = scratchTree({
      vitest: fakeVitest({ numTotalTests: 2, numFailedTests: 1 }),
      source: "keep this line\nGUARDED_LINE\nand this one\n",
      entries: 200,
    });

    const child = spawn(process.execPath, [runner, "--root", root], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.on("data", (chunk) => (stdout += chunk));

    await waitFor(() => (readFileSync(sourcePath, "utf8") !== source ? true : null));
    const exit = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
    child.kill("SIGTERM");
    const ended = await exit;

    expect(readFileSync(sourcePath, "utf8")).toBe(source);
    // The run ended one way or another; what it must never do is leave the file
    // broken, which the assertion above covers.
    expect(ended).toBeDefined();
    expect(stdout + stderr).not.toContain("THE RUNNER FAILED");
  }, 20000);

  it("restores the mutated file on the normal path too", () => {
    const { root, sourcePath, source } = scratchTree({
      vitest: fakeVitest({ numTotalTests: 3, numFailedTests: 1 }),
      source: "keep this line\nGUARDED_LINE\nand this one\n",
    });

    const r = runRunner(root);

    expect(readFileSync(sourcePath, "utf8")).toBe(source);
    expect(r.stdout).toContain("1 test(s) went red");
    expect(r.status).toBe(0);
  });
});

describe("the mutation runner reports its own failures as its own", () => {
  it("exits non-zero and names itself when the test command cannot be executed", () => {
    const { root, sourcePath, source } = scratchTree({
      vitest: fakeVitest({ numTotalTests: 1, numFailedTests: 1 }),
      source: "keep this line\nGUARDED_LINE\nand this one\n",
    });
    // Remove the executable bit: the spawn fails outright, which is what a
    // missing or unrunnable vitest looks like from here.
    chmodSync(join(root, "tools", "node_modules", ".bin", "vitest"), 0o644);

    const r = runRunner(root);

    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("THE RUNNER FAILED");
    expect(r.stderr).toContain("not about the code under test");
    // The distinction is the point: this must NOT be reported as a survivor.
    expect(r.stderr).not.toContain("mutation(s) survived");
    expect(readFileSync(sourcePath, "utf8")).toBe(source);
  });

  it("exits non-zero when vitest runs but writes no report twice, and shows what it said", () => {
    const { root } = scratchTree({
      vitest: "#!/bin/sh\necho 'Error: write EPIPE' >&2\nexit 1\n",
      source: "keep this line\nGUARDED_LINE\nand this one\n",
    });

    const r = runRunner(root);

    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("retrying once");
    expect(r.stderr).toContain("THE RUNNER FAILED");
    // The child's last words are the only diagnostic a silent run leaves.
    expect(r.stderr).toContain("vitest stderr: Error: write EPIPE");
    expect(r.stderr).not.toContain("mutation(s) survived");
  });

  it("retries a single silent run once, says so, and scores the retry", () => {
    // The first invocation writes nothing; the second behaves. A pool worker
    // dying under load looks exactly like this from the runner's side.
    const { root, sourcePath, source } = scratchTree({
      vitest: `#!/bin/sh
marker="$(dirname "$0")/ran-once"
if [ ! -e "$marker" ]; then touch "$marker"; exit 1; fi
${fakeVitest({ numTotalTests: 2, numFailedTests: 1 }).replace("#!/bin/sh\n", "")}`,
      source: "keep this line\nGUARDED_LINE\nand this one\n",
    });

    const r = runRunner(root);

    expect(r.status).toBe(0);
    expect(r.stderr).toContain("no report on attempt 1, retrying once");
    expect(r.stdout).toContain("1 test(s) went red");
    expect(r.stdout).toContain("none survived");
    expect(readFileSync(sourcePath, "utf8")).toBe(source);
  });

  it("runs only the entries --only names, and refuses a name the table lacks", () => {
    const { root } = scratchTree({
      vitest: fakeVitest({ numTotalTests: 1, numFailedTests: 1 }),
      source: "keep this line\nGUARDED_LINE\nand this one\n",
      entries: 3,
    });

    const chosen = spawnSync(process.execPath, [runner, "--root", root, "--only", "the-scratch-mutation-1"], { encoding: "utf8" });
    expect(chosen.status).toBe(0);
    expect(chosen.stdout).toContain("mutation the-scratch-mutation-1: 1 test(s) went red");
    expect(chosen.stdout).not.toContain("the-scratch-mutation-0");
    expect(chosen.stdout).toContain("ok - 1 mutation(s)");

    const typo = spawnSync(process.execPath, [runner, "--root", root, "--only", "the-scratch-mutation-9"], { encoding: "utf8" });
    expect(typo.status).not.toBe(0);
    expect(typo.stderr).toContain("the table does not hold: the-scratch-mutation-9");
  });

  it("exits non-zero when vitest reports having run no tests at all", () => {
    // The subtlest shape of issue #25: vitest exits cleanly, writes a valid
    // report, and the report accounts for nothing. numFailedTests is zero and
    // reads exactly like a surviving mutation.
    const { root } = scratchTree({
      vitest: fakeVitest({ numTotalTests: 0, numFailedTests: 0 }),
      source: "keep this line\nGUARDED_LINE\nand this one\n",
    });

    const r = runRunner(root);

    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("executed no tests");
    expect(r.stderr).not.toContain("mutation(s) survived");
  });

  it("still reports a real survivor as a survivor", () => {
    // The counterpart to the cases above: when the runner works and no test goes
    // red, the finding IS about the code, and must be reported that way.
    const { root } = scratchTree({
      vitest: fakeVitest({ numTotalTests: 4, numFailedTests: 0 }),
      source: "keep this line\nGUARDED_LINE\nand this one\n",
    });

    const r = runRunner(root);

    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("the-scratch-mutation: SURVIVED");
    expect(r.stderr).toContain("1 mutation(s) survived");
    expect(r.stderr).not.toContain("THE RUNNER FAILED");
  });

  it("applies an entry's replace text instead of deleting, when the table gives one", () => {
    // Twenty-eight entries in the real table carry a `replace` that the runner
    // used to ignore: the file was mutated by deletion, which for most of them
    // was a syntax error - red for the wrong reason, proving nothing about the
    // guarantee the entry names. The fake vitest here records what it saw on
    // disk so the case can assert the substitution, not the deletion.
    const { root, sourcePath, source } = scratchTree({
      vitest: `#!/bin/sh
cp source.txt seen.txt
${fakeVitest({ numTotalTests: 1, numFailedTests: 1 }).split("\n").slice(1).join("\n")}`,
      source: "keep this line\nGUARDED_LINE\nand this one\n",
      replace: "SUBSTITUTED_LINE\n",
    });

    const r = runRunner(root);

    expect(r.status).toBe(0);
    expect(readFileSync(join(root, "subject", "seen.txt"), "utf8")).toBe("keep this line\nSUBSTITUTED_LINE\nand this one\n");
    expect(readFileSync(sourcePath, "utf8")).toBe(source);
  });
});

// A shell script that behaves like vitest far enough for the runner: it accepts
// `--outputFile <path>` and writes the given counts there.
function fakeVitest(report) {
  return `#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--outputFile" ]; then out="$2"; fi
  shift
done
printf '%s' '${JSON.stringify(report)}' > "$out"
exit ${report.numFailedTests > 0 ? 1 : 0}
`;
}

async function waitFor(probe, budgetMs = 10000) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const value = probe();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("waitFor: the condition never held within its budget");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
