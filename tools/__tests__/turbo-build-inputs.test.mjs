import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const turbo = join(repoRoot, "node_modules", ".bin", "turbo");

let root;
let generatedSource;
let schema;

function write(path, contents) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

function hashes() {
  const result = execFileSync(turbo, ["run", "build", "--dry=json"], {
    cwd: root,
    encoding: "utf8",
  });
  const tasks = JSON.parse(result).tasks;
  expect(tasks.map(({ taskId }) => taskId).sort()).toEqual([
    "@fixture/consumer#build",
    "@fixture/protocol-types#build",
  ]);
  return Object.fromEntries(tasks.map(({ taskId, hash }) => [taskId, hash]));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "turbo-build-inputs-test-"));
  generatedSource = join(root, "packages", "protocol-types", "src", "index.ts");
  schema = join(root, "protocol", "schema.json");

  write(
    join(root, "package.json"),
    JSON.stringify({ private: true, packageManager: "pnpm@10.23.0" }),
  );
  write(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  write(join(root, "turbo.json"), readFileSync(join(repoRoot, "turbo.json"), "utf8"));
  write(join(root, ".gitignore"), "packages/protocol-types/\n");
  write(schema, '{"version":1}\n');
  write(
    join(root, "packages", "protocol-types", "package.json"),
    JSON.stringify({
      name: "@fixture/protocol-types",
      version: "0.0.0",
      private: true,
      scripts: { build: "node -e \"\"" },
    }),
  );
  write(generatedSource, 'export const protocolVersion = "one";\n');
  write(
    join(root, "packages", "consumer", "package.json"),
    JSON.stringify({
      name: "@fixture/consumer",
      version: "0.0.0",
      private: true,
      scripts: { build: "node -e \"\"" },
      dependencies: { "@fixture/protocol-types": "workspace:*" },
    }),
  );
  write(join(root, "packages", "consumer", "src", "index.ts"), 'export const consumer = "one";\n');

  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
});

describe("Turbo build inputs", () => {
  it("hashes gitignored generated package source into its build and consumers", () => {
    const before = hashes();
    writeFileSync(generatedSource, 'export const protocolVersion = "two";\n');
    const after = hashes();

    expect(after["@fixture/protocol-types#build"]).not.toBe(
      before["@fixture/protocol-types#build"],
    );
    expect(after["@fixture/consumer#build"]).not.toBe(before["@fixture/consumer#build"]);
  });

  it("hashes the root protocol schema into generated package builds and consumers", () => {
    const before = hashes();
    writeFileSync(schema, '{"version":2}\n');
    const after = hashes();

    expect(after["@fixture/protocol-types#build"]).not.toBe(
      before["@fixture/protocol-types#build"],
    );
    expect(after["@fixture/consumer#build"]).not.toBe(before["@fixture/consumer#build"]);
  });
});
