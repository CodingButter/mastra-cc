import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The mutation table's locator contract (issue #8). tools/mutations.mjs removes
// the FIRST match of each find string, so a find that matches twice mutates
// whichever site happens to come first - the test still goes red, but for a
// site nobody chose, and the choice moves as the file is edited. These cases
// pin the contract itself; running the mutations is CI step 8's job, not this
// suite's (a full run rebuilds and re-runs every suite once per mutation).

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const check = join(repoRoot, "tools", "mutations.mjs");
const table = JSON.parse(readFileSync(join(repoRoot, "tools", "mutations.json"), "utf8"));

function runWithTable(entries) {
  const path = join(mkdtempSync(join(tmpdir(), "mutations-table-")), "mutations.json");
  writeFileSync(path, JSON.stringify(entries));
  return spawnSync(process.execPath, [check, "--table", path], { encoding: "utf8" });
}

describe("the mutation table", () => {
  it("locates exactly one site per mutation", () => {
    const ambiguous = table
      .map((mutation) => ({
        name: mutation.name,
        occurrences: readFileSync(join(repoRoot, mutation.file), "utf8").split(mutation.find).length - 1,
      }))
      .filter((entry) => entry.occurrences !== 1);
    expect(ambiguous).toEqual([]);
  });

  it("is not empty, which would make the whole step vacuous", () => {
    expect(table.length).toBeGreaterThan(0);
    expect(runWithTable([]).status).toBe(1);
    expect(runWithTable([]).stderr).toContain("pass vacuously");
  });
});

describe("the mutation runner", () => {
  it("refuses an ambiguous find string, naming the mutation and the count", () => {
    // "effectClass: \"observe\"" appears on every observe entry of the dispatch
    // table: a locator like this is what the check exists to reject. The count is
    // computed rather than hard-coded, so the dispatch table growing (as it did in
    // M2.7 Segment 1) does not turn this test into a historical claim.
    const result = runWithTable([
      {
        name: "scratch-ambiguous",
        file: "daemon/src/server.ts",
        find: 'effectClass: "observe"',
        cwd: "tools",
        testFile: "__tests__/mutations.test.mjs",
      },
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("scratch-ambiguous");
    const sites = readFileSync(join(repoRoot, "daemon/src/server.ts"), "utf8").split(String.raw`effectClass: "observe"`).length - 1;
    expect(sites).toBeGreaterThan(1);
    expect(result.stderr).toContain(`matches ${sites} sites`);
    expect(result.stderr).toContain("exactly one");
  });

  it("refuses before touching the file, so no suite runs against a site nobody chose", () => {
    const server = join(repoRoot, "daemon", "src", "server.ts");
    const before = readFileSync(server, "utf8");
    runWithTable([
      {
        name: "scratch-ambiguous",
        file: "daemon/src/server.ts",
        find: 'effectClass: "observe"',
        cwd: "tools",
        testFile: "__tests__/mutations.test.mjs",
      },
    ]);
    expect(readFileSync(server, "utf8")).toBe(before);
  });
});
