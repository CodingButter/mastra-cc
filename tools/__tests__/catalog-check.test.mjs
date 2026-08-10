import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const toolsDir = dirname(dirname(fileURLToPath(import.meta.url)));

function runCheck(localYaml, destinationYaml) {
  const dir = mkdtempSync(join(tmpdir(), "catalog-test-"));
  const local = join(dir, "local.yaml");
  const destination = join(dir, "destination.yaml");
  writeFileSync(local, localYaml);
  writeFileSync(destination, destinationYaml);
  const result = spawnSync(
    process.execPath,
    [join(toolsDir, "catalog-check.mjs"), "--local", local, "--destination", destination],
    { encoding: "utf8" },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const aligned = "catalog:\n  typescript: ^6.0.3\n  vitest: 4.1.10\n  zod: ^4.4.3\n  oxfmt: 0.59.0\n";

test("aligned catalogs pass with the compared count named", () => {
  const r = runCheck(aligned, aligned);
  expect(r.output).toContain("4 pin(s) compared, aligned with the destination");
  expect(r.status).toBe(0);
});

test("a divergence is detected and named in both directions", () => {
  const diverged = aligned.replace("typescript: ^6.0.3", "typescript: ^7.0.2");
  const r = runCheck(diverged, aligned);
  expect(r.status).toBe(1);
  expect(r.output).toContain("typescript is ^7.0.2 here, ^6.0.3 in the destination");
});

test("an empty watched set fails rather than passing vacuously", () => {
  const r = runCheck("catalog:\n  left-pad: 1.0.0\n", aligned);
  expect(r.status).toBe(1);
  expect(r.output).toContain("would pass vacuously");
});

test("an unreadable destination is neither a pass nor a divergence", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-test-"));
  const local = join(dir, "local.yaml");
  writeFileSync(local, aligned);
  const result = spawnSync(
    process.execPath,
    [join(toolsDir, "catalog-check.mjs"), "--local", local, "--destination", join(dir, "missing.yaml")],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(2);
});
