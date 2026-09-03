import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { expect, test } from "vitest";

// A test that reads a gitignored path passes on the machine that wrote the file
// and fails on every other one. tools/__tests__/m6-stage3-launch-proof.test.mjs
// read four artifacts out of .mastracode/ and was therefore red in CI from the
// day it landed while being green on the author's desk for months - the worst
// shape a gate can have, because it reports a failure nobody believes. This
// checks that no test file references a path git refuses to track.

const root = resolve(import.meta.dirname, "../..");

// Gitignored, but CI has them anyway because `pnpm build` produces them before
// the tests run. A test may read these; it may not read anything else git refuses
// to track. Adding to this list is a claim that a build step creates the path, so
// it should be made deliberately and not to silence a failure.
const BUILD_OUTPUTS = ["dist", "build", ".turbo", "node_modules", "packages/protocol-types"];

const isBuildOutput = (path) =>
  BUILD_OUTPUTS.some((out) => path === out || path.startsWith(`${out}/`) || path.includes(`/${out}/`));

// Paths that look like repository-relative fixture roots inside a test's source.
const PATH_LIKE = /["'`](\.?[\w.-]+(?:\/[\w.-]+)+)["'`]/g;

function trackedTestFiles() {
  return execFileSync("git", ["ls-files", "*.test.ts", "*.test.mjs", "*.test.js"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

function ignoredPaths(candidates) {
  if (candidates.length === 0) return [];
  // check-ignore exits 1 when nothing matches, which is a pass, not an error.
  try {
    return execFileSync("git", ["check-ignore", "--stdin"], {
      cwd: root,
      encoding: "utf8",
      input: candidates.join("\n"),
    })
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

test("no test reads a fixture git refuses to track", () => {
  const files = trackedTestFiles();
  expect(files.length).toBeGreaterThan(0);

  const offenders = [];
  for (const file of files) {
    // The index can still name a file deleted but not yet staged.
    if (!existsSync(resolve(root, file))) continue;
    const source = readFileSync(resolve(root, file), "utf8");
    const candidates = [...source.matchAll(PATH_LIKE)]
      .map((match) => match[1])
      // Only paths that actually exist here can be judged; a temp-directory
      // string or a package specifier is not a repository fixture.
      .filter(
        (path) =>
          !path.startsWith("node:") &&
          !path.startsWith("@") &&
          // A relative import climbing out of the repository, or an absolute
          // system path, is not a repository fixture and makes check-ignore fatal.
          !path.startsWith("..") &&
          !path.startsWith("/"),
      );

    for (const ignored of ignoredPaths(candidates).filter((path) => !isBuildOutput(path))) {
      offenders.push(`${relative(root, file)} reads gitignored ${ignored}`);
    }
  }

  expect(offenders).toEqual([]);
});
