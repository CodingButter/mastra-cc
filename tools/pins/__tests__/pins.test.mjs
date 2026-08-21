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

function plant(relPath, content, alongside = {}) {
  const root = mkdtempSync(join(tmpdir(), "pin-test-"));
  for (const [path, body] of [[relPath, content], ...Object.entries(alongside)]) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return root;
}

// B2 scans two subjects, so its planted tree needs both present: a source file
// to scan and a manifest to read. A tree with only the source would fail on the
// unreadable manifest, which is a true failure for the wrong reason.
const CLEAN_HUB_MANIFEST = JSON.stringify({ name: "@mastra-cc/hub", dependencies: { "@mastra-cc/transport": "workspace:*" } });

// `vacuity` is each pin's OWN vacuous-pass sentence, not the shared tail of it.
// Asserting only "would pass vacuously" let B2's source-half guard be deleted
// with this test still green, because its manifest guard says the same words -
// the mutation runner found that, and the fix is to name the guard expected.
const VACUOUS_FILE_SET = "no files matched - the pin would pass vacuously";

const cases = [
  {
    pin: "b1",
    plantPath: "packages/leak/src/leak.ts",
    plantSource: 'import dbus from "dbus-native";\n',
    expectedMessage: 'D-Bus binding "dbus-native"',
  },
  {
    pin: "b2",
    plantPath: "apps/hub/src/ears.ts",
    plantSource: "export const stream = await navigator.mediaDevices.getUserMedia({ audio: true });\n",
    expectedMessage: 'audio API "getUserMedia" in the hub',
    alongside: { "apps/hub/package.json": CLEAN_HUB_MANIFEST },
  },
  {
    pin: "b5",
    plantPath: "apps/rogue/src/socket.ts",
    plantSource: 'import net from "node:net";\n',
    expectedMessage: "socket implementation outside packages/transport",
  },
  {
    pin: "b8",
    plantPath: "daemon/src/input.ts",
    plantSource: 'spawnSync("xdotool", ["key", "Return"]);\n',
    expectedMessage: 'raw input tool "xdotool"',
  },
  {
    // The plant carries every element method b11 requires present, correctly
    // declared, because the pin complains about absence first. Their presence
    // is what leaves openApplication's timing as the single planted violation,
    // which is the one this case exists to catch.
    pin: "b11",
    plantPath: "daemon/src/server.ts",
    plantSource:
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
    expectedMessage: 'not marked enforcement "before-call"',
    // b11 reads one table rather than a file set, so its empty-subject sentence
    // is its own.
    vacuity: "no dispatch table found - the pin would pass vacuously",
  },
];

for (const { pin, plantPath, plantSource, expectedMessage, alongside, vacuity = VACUOUS_FILE_SET } of cases) {
  test(`${pin}: the clean tree passes`, () => {
    const r = runPin(pin);
    expect(r.output).toContain(`pin-${pin}: ok`);
    expect(r.status).toBe(0);
  });

  test(`${pin}: a planted violation fails with the offending path named`, () => {
    const r = runPin(pin, ["--root", plant(plantPath, plantSource, alongside)]);
    expect(r.status).toBe(1);
    expect(r.output).toContain(expectedMessage);
    expect(r.output).toContain(plantPath);
  });

  test(`${pin}: an empty file set fails rather than passing vacuously`, () => {
    // The tree is empty of the pin's SUBJECT while whatever else the pin needs
    // to run is present. B2 taught this distinction: it scans a source tree and
    // reads a manifest, and a tree missing both fails on the manifest, so the
    // source half's guard could be deleted with this test still green. An empty
    // set has to be empty of exactly one thing at a time.
    const root = mkdtempSync(join(tmpdir(), "pin-empty-"));
    for (const [path, body] of Object.entries(alongside ?? {})) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
    }
    const r = runPin(pin, ["--root", root]);
    expect(r.status).toBe(1);
    expect(r.output).toContain(vacuity);
  });
}

test("b8: a comment mentioning a banned tool is not a violation", () => {
  const root = plant("daemon/src/notes.ts", "// xdotool is banned here (ADR-0004)\nexport {};\n");
  const r = runPin("b8", ["--root", root]);
  expect(r.output).toContain("pin-b8: ok");
  expect(r.status).toBe(0);
});

test("b2: an audio dependency declared but never imported still fails", () => {
  // THE HALF THAT SLIPPED THROUGH BEFORE. The prototype deleted a transcriber's
  // seven files and eighty megabytes and left the dependency declared; the
  // source scan below sees a clean tree, and the manifest is what catches it.
  const root = plant(
    "apps/hub/src/index.ts",
    "export const hub = true;\n",
    { "apps/hub/package.json": JSON.stringify({ name: "@mastra-cc/hub", dependencies: { "node-speaker": "^0.5.5" } }) },
  );
  const r = runPin("b2", ["--root", root]);
  expect(r.status).toBe(1);
  expect(r.output).toContain('audio dependency "node-speaker"');
  expect(r.output).toContain("imported or not");
});

test("b2: a comment explaining why the hub holds no audio is not a violation", () => {
  const root = plant(
    "apps/hub/src/why.ts",
    "// The hub never calls getUserMedia and never holds an AudioBuffer (ADR-0006).\nexport {};\n",
    { "apps/hub/package.json": CLEAN_HUB_MANIFEST },
  );
  const r = runPin("b2", ["--root", root]);
  expect(r.output).toContain("pin-b2: ok");
  expect(r.status).toBe(0);
});

test("b2: an unreadable manifest fails rather than passing the manifest half vacuously", () => {
  // A source tree with no manifest is not a hub that declares no audio - it is
  // a hub whose declarations were never read. One level up from an empty file
  // set, and the same failure mode.
  const root = plant("apps/hub/src/index.ts", "export const hub = true;\n");
  const r = runPin("b2", ["--root", root]);
  expect(r.status).toBe(1);
  expect(r.output).toContain("would pass vacuously");
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
