import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The release check is the only thing standing between a manifest edit and a
// broken package on a registry, so it needs its own red. These cases run it
// against a FIXTURE tree: real packages, really packed, but not this
// repository's - so a plant here cannot be confused for a plant there.

const toolsDir = dirname(dirname(fileURLToPath(import.meta.url)));

function fixture(packages) {
  const root = mkdtempSync(join(tmpdir(), "release-check-test-"));
  mkdirSync(join(root, "daemon"), { recursive: true });
  writeFileSync(
    join(root, "daemon", "package.json"),
    JSON.stringify({ name: "daemon", version: "9.9.9", private: true }),
  );
  for (const [name, extra] of Object.entries(packages)) {
    const dir = join(root, "packages", name);
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "dist", "index.mjs"), "export const ok = true;\n");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: `@fixture/${name}`,
        version: "1.0.0",
        main: "./dist/index.mjs",
        files: ["dist"],
        ...extra,
      }),
    );
  }
  return root;
}

function run(root) {
  const result = spawnSync(process.execPath, [join(toolsDir, "release-check.mjs"), "--root", root], {
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// The fixture names the same three directories the real list does, so the
// control passes for the same reason the repository does.
const publishable = { "protocol-types": {}, transport: {}, desktop: {} };

test("a clean publishable set packs, unpacks and passes", () => {
  const r = run(fixture(publishable));
  expect(r.output).toContain("3 tarball(s) inspected");
  expect(r.status).toBe(0);
});

// The workspace-specifier case is NOT fixtured here: outside a workspace,
// `pnpm pack` refuses a `workspace:` range before the check ever reads the
// tarball, so a fixture would assert pack's opinion rather than this check's.
// Its red was planted in the repository itself and recorded in the plan's
// progress file.

test("an entry point the tarball does not contain is caught", () => {
  const r = run(fixture({ ...publishable, desktop: { types: "./dist/nowhere.d.mts" } }));
  expect(r.status).toBe(1);
  expect(r.output).toContain("./dist/nowhere.d.mts is declared but absent");
});

test("a publishable package missing from the list is caught", () => {
  const r = run(fixture({ ...publishable, latecomer: {} }));
  expect(r.status).toBe(1);
  expect(r.output).toContain("packages/latecomer: publishable but absent from the release check's list");
});

test("a private package is allowed to stay off the list", () => {
  const r = run(fixture({ ...publishable, internal: { private: true } }));
  expect(r.output).toContain("3 tarball(s) inspected");
  expect(r.status).toBe(0);
});

test("depending on the daemon is refused, whatever the version says", () => {
  const r = run(fixture({ ...publishable, desktop: { dependencies: { "@mastra-cc/daemon": "^1.0.0" } } }));
  expect(r.status).toBe(1);
  expect(r.output).toContain("depends on the daemon");
});
