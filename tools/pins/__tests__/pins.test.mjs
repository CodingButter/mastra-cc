import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Each pin is exercised three ways (the plan's Phase 1 test contract): a clean
// tree passes, a planted violation fails with the offending path named, and an
// empty file set fails with the vacuous-pass message. These tests live under
// tools/pins/__tests__ so every pin's own scan excludes them.

const pinsDir = dirname(dirname(fileURLToPath(import.meta.url)));

function runPin(pin, args = []) {
  const result = spawnSync(process.execPath, [join(pinsDir, `${pin}.mjs`), ...args], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function plant(relPath, content) {
  const root = mkdtempSync(join(tmpdir(), "pin-test-"));
  const file = join(root, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return root;
}

const cases = [
  ["b1", "packages/leak/src/leak.ts", 'import dbus from "dbus-native";\n', 'D-Bus binding "dbus-native"'],
  ["b5", "apps/rogue/src/socket.ts", 'import net from "node:net";\n', "socket implementation outside packages/transport"],
  ["b8", "daemon/src/input.ts", 'spawnSync("xdotool", ["key", "Return"]);\n', 'raw input tool "xdotool"'],
  [
    // The plant carries every element method b11 requires present, correctly
    // declared, because the pin complains about absence first. Their presence
    // is what leaves openApplication's timing as the single planted violation,
    // which is the one this case exists to catch.
    "b11",
    "daemon/src/server.ts",
    'const DISPATCH = {\n' +
      '  openApplication: { effectClass: "activate", enforcement: "at-result" },\n' +
      '  editElement: { effectClass: "edit", enforcement: "before-call" },\n' +
      '  activateElement: { effectClass: "activate", enforcement: "before-call" },\n' +
      '  submitElement: { effectClass: "submit", enforcement: "before-call" },\n' +
      '  setElementValue: { effectClass: "edit", enforcement: "before-call" },\n' +
      '  setElementText: { effectClass: "edit", enforcement: "before-call" },\n' +
      '  setElementCaret: { effectClass: "edit", enforcement: "before-call" },\n' +
      '  revealElement: { effectClass: "activate", enforcement: "before-call" },\n' +
      "};\n",
    'not marked enforcement "before-call"',
  ],
];

for (const [pin, plantPath, plantSource, expectedMessage] of cases) {
  test(`${pin}: the clean tree passes`, () => {
    const r = runPin(pin);
    expect(r.output).toContain(`pin-${pin}: ok`);
    expect(r.status).toBe(0);
  });

  test(`${pin}: a planted violation fails with the offending path named`, () => {
    const r = runPin(pin, ["--root", plant(plantPath, plantSource)]);
    expect(r.status).toBe(1);
    expect(r.output).toContain(expectedMessage);
    expect(r.output).toContain(plantPath);
  });

  test(`${pin}: an empty file set fails rather than passing vacuously`, () => {
    const r = runPin(pin, ["--root", mkdtempSync(join(tmpdir(), "pin-empty-"))]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("would pass vacuously");
  });
}

test("b8: a comment mentioning a banned tool is not a violation", () => {
  const root = plant("daemon/src/notes.ts", "// xdotool is banned here (ADR-0004)\nexport {};\n");
  const r = runPin("b8", ["--root", root]);
  expect(r.output).toContain("pin-b8: ok");
  expect(r.status).toBe(0);
});

test("b11: an observe-only dispatch table fails rather than passing vacuously", () => {
  const root = plant(
    "daemon/src/server.ts",
    'const DISPATCH = {\n  queryElements: { effectClass: "observe", enforcement: "at-result" },\n};\n',
  );
  const r = runPin("b11", ["--root", root]);
  expect(r.status).toBe(1);
  expect(r.output).toContain("would pass vacuously");
});
