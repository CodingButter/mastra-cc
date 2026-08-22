import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// CI step 8 (docs/05-TEST-STRATEGY.md:180 and §3): mutation checks by the manual
// method the prototype practised - break a guarantee on purpose, run the suite,
// require at least one test to go red, restore. tools/mutations.json is the
// committed table of mutations. A mutation that produces zero red tests fails
// the step, because that is the guarantee whose test asserts nothing.
//
// This runner deliberately writes a broken source file to disk and puts it back.
// Two properties make that safe to do, and both are enforced below rather than
// hoped for:
//
//   1. THE FILE COMES BACK, however the run ends. The `finally` covers the normal
//      path and a thrown error; the signal handlers cover Ctrl-C and a `kill`.
//      Without them an interrupted run leaves a source file on disk with a
//      security line deleted, and the next `git add -A` commits it (issue #18).
//   2. THE RUNNER NEVER REPORTS ABOUT THE CODEBASE WHEN THE FINDING IS ABOUT
//      ITSELF. A runner that cannot execute vitest sees zero failing tests and
//      would otherwise announce that every guarantee in the repository is
//      untested (issue #25). A survived mutation and a broken runner are
//      different findings and are reported as different things.
//
// Usage: node tools/mutations.mjs [--root <dir>] [--table <file>]
// --root exists for the runner's own tests, which must be able to mutate a
// scratch tree rather than this one (the same shape tools/freeze-gate.mjs uses).
// --table exists so the ambiguity guard below can be proven to fail on purpose
// against a scratch table; CI passes nothing and reads the committed one (PR #13).

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const root = arg("--root") ?? fileURLToPath(new URL("..", import.meta.url));
const table = JSON.parse(readFileSync(arg("--table") ?? join(root, "tools", "mutations.json"), "utf8"));

if (table.length === 0) {
  console.error("mutations: the table is empty - the step would pass vacuously");
  process.exit(1);
}

// The one mutation currently on disk. The loop is sequential, so there is never
// more than one. `null` means every file in the tree holds its committed bytes.
let inFlight = null;

function restoreInFlight() {
  if (inFlight === null) return;
  const { file, original } = inFlight;
  // The write happens FIRST and the record is cleared only after it succeeds:
  // if the write throws (a read-only mount, a full disk), keeping the record
  // lets a later restore attempt try again, and the caller can say loudly that
  // the file is still mutated instead of claiming it was put back. Re-entrancy
  // is not a hazard here - node dispatches signal handlers on the event loop,
  // never in the middle of a synchronous write.
  writeFileSync(file, original);
  inFlight = null;
}

// Interruption is handled in TWO places, because one is not enough and the
// reason is a property of `spawnSync` rather than a style choice.
//
// `spawnSync` blocks the event loop for as long as the test run takes, and the
// mutation loop below is synchronous from end to end. A signal that arrives
// during a run therefore CANNOT reach a JavaScript handler until the entire
// table has finished - measured, not assumed. A handler alone would leave Ctrl-C
// looking like it did nothing for minutes.
//
//   1. The handlers below still matter, and not for the code in their bodies:
//      merely REGISTERING them removes node's default disposition for these
//      signals, so an interrupted process no longer dies on the spot and the
//      `finally` in the loop gets to run. Measured: without a handler, a Ctrl-C
//      mid-mutation leaves the broken file on disk; with one, the file comes
//      back. Their bodies cover the moments the loop is not inside a spawn.
//   2. The loop itself notices the interruption where it IS observable. A
//      terminal Ctrl-C signals the whole process group, so vitest dies of the
//      same signal and `spawnSync` reports it in `run.signal`. That is checked
//      immediately, and the run stops there rather than mutating the next file.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    try {
      restoreInFlight();
    } catch (err) {
      // The most serious failure this runner has: interrupted AND unable to put
      // the file back. Never claim success here.
      console.error(
        `mutations: interrupted by ${signal} and THE RESTORE FAILED (${err.message}) - ${inFlight.file} is still mutated on disk`,
      );
      process.exit(1);
    }
    console.error(`mutations: interrupted by ${signal} - the mutated file was put back`);
    // Re-raise rather than exit(1): an interruption is not a mutation result, and
    // a caller that signalled this process is owed the death it asked for. The
    // listener is removed first so the default disposition applies.
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  });
}

function interrupted(signal) {
  console.error(`mutations: interrupted by ${signal} - the mutated file was put back, and no result is reported for a run that did not finish`);
  process.exit(1);
}

// A find string locates ONE site: the mutation below removes the first match,
// so a find that matches twice silently mutates whichever site comes first and
// the red test can go red for the wrong reason (issue #8). Checked for the
// whole table BEFORE any file is touched, so an ambiguous locator is a red step
// rather than a mutation run against a site nobody chose.
const ambiguous = [];
for (const mutation of table) {
  const occurrences = readFileSync(join(root, mutation.file), "utf8").split(mutation.find).length - 1;
  if (occurrences !== 1) {
    ambiguous.push(
      occurrences === 0
        ? `mutation ${mutation.name}: find string not present in ${mutation.file} - the table is stale`
        : `mutation ${mutation.name}: find string matches ${occurrences} sites in ${mutation.file} - a mutation must name exactly one`,
    );
  }
}
if (ambiguous.length > 0) {
  for (const problem of ambiguous) console.error(problem);
  console.error(`mutations: ${ambiguous.length} find string(s) do not name exactly one site - a stale entry needs re-anchoring, an ambiguous one needs surrounding context`);
  process.exit(1);
}

let survived = 0;
let brokenRunner = 0;
for (const mutation of table) {
  const file = join(root, mutation.file);
  const original = readFileSync(file, "utf8");
  if (!original.includes(mutation.find)) {
    // The pre-check above already refuses a stale table, so reaching this line
    // means the file changed mid-run. Either way it is a finding about the
    // table or the runner, never a survived mutation (issue #25).
    console.error(`mutation ${mutation.name}: THE RUNNER FAILED - find string not present in ${mutation.file} - the table is stale`);
    brokenRunner += 1;
    continue;
  }

  const report = join(mkdtempSync(join(tmpdir(), "mutations-")), "report.json");
  inFlight = { file, original };
  writeFileSync(file, original.replace(mutation.find, ""));
  let red = 0;
  let failure = null;
  try {
    const run = spawnSync(
      join(root, "tools", "node_modules", ".bin", "vitest"),
      ["run", mutation.testFile, "--reporter=json", "--outputFile", report],
      { cwd: join(root, mutation.cwd), stdio: "ignore" },
    );
    // A non-zero exit is the EXPECTED outcome here - it is what a mutation going
    // red looks like - so the exit code is not the evidence. What the runner
    // checks is whether vitest ran at all: a spawn that never started, a process
    // killed by a signal, a report that was never written or cannot be parsed,
    // and a report that accounts for zero tests. Each of those is a statement
    // about this runner or this table, never about the guarantee under test.
    if (run.error) {
      failure = `vitest could not be started (${run.error.message})`;
    } else if (run.signal === "SIGINT" || run.signal === "SIGTERM") {
      // A terminal Ctrl-C reaches the whole process group, so the child dies of
      // the same signal the operator sent. Restore and stop here: the alternative
      // is carrying on to mutate the next file while the operator believes the
      // run is over.
      restoreInFlight();
      interrupted(run.signal);
    } else if (run.status === null) {
      failure = `vitest was killed by ${run.signal} before it could report`;
    } else {
      const parsed = JSON.parse(readFileSync(report, "utf8"));
      if (parsed.numTotalTests === 0) {
        failure = `vitest ran but executed no tests from ${mutation.testFile} - nothing could have gone red`;
      } else {
        red = parsed.numFailedTests;
      }
    }
  } catch (err) {
    failure = `the test run produced no readable report (${err.message})`;
  } finally {
    restoreInFlight();
  }

  if (failure !== null) {
    console.error(`mutation ${mutation.name}: THE RUNNER FAILED - ${failure}`);
    brokenRunner += 1;
    continue;
  }

  console.log(`mutation ${mutation.name}: ${red} test(s) went red`);
  if (red === 0) survived += 1;
}

// The broken-runner count is reported first and on its own line, because it
// changes what every other number in this run means: a runner that could not
// execute its tests has not measured the codebase at all.
if (brokenRunner > 0) {
  console.error(
    `mutations: the runner failed on ${brokenRunner} of ${table.length} entr(ies) - this is a finding about the runner or the table, not about the code under test`,
  );
  process.exit(1);
}
if (survived > 0) {
  console.error(`mutations: ${survived} mutation(s) survived - a surviving mutation is a test that asserts nothing`);
  process.exit(1);
}
console.log(`mutations: ok - ${table.length} mutation(s), none survived`);
