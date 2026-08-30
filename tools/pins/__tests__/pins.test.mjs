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

// `vacuity` is each pin's OWN vacuous-pass sentence, not the shared tail of it.
// Asserting only "would pass vacuously" lets a pin with two guards have one of
// them deleted with this test still green, because both say the same words -
// the mutation runner found that, and the fix is to name the guard expected.
const VACUOUS_FILE_SET = "no files matched - the pin would pass vacuously";

const cases = [
  {
    pin: "b1",
    plantPath: "packages/leak/src/leak.ts",
    plantSource: 'import dbus from "dbus-native";\n',
    expectedMessage: 'D-Bus binding "dbus-native"',
    scanRoots: ["packages", "tools", "scripts"],
  },
  {
    pin: "b5",
    plantPath: "packages/rogue/src/socket.ts",
    plantSource: 'import net from "node:net";\n',
    expectedMessage: "socket implementation outside packages/transport",
    scanRoots: ["packages", "tools", "scripts"],
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

for (const { pin, plantPath, plantSource, expectedMessage, alongside, scanRoots, vacuity = VACUOUS_FILE_SET } of cases) {
  test(`${pin}: the clean tree passes`, () => {
    const r = runPin(pin);
    expect(r.output).toContain(`pin-${pin}: ok`);
    expect(r.status).toBe(0);
  });

  test(`${pin}: a planted violation fails with the offending path named`, () => {
    const root = plant(plantPath, plantSource, alongside);
    for (const dir of scanRoots ?? []) mkdirSync(join(root, dir), { recursive: true });
    const r = runPin(pin, ["--root", root]);
    expect(r.status).toBe(1);
    expect(r.output).toContain(expectedMessage);
    expect(r.output).toContain(plantPath);
  });

  test(`${pin}: an empty file set fails rather than passing vacuously`, () => {
    // The tree is empty of the pin's SUBJECT while whatever else the pin needs
    // to run is present. A pin that scans a source tree AND reads a manifest
    // would otherwise fail on the manifest when both are missing, hiding a
    // deleted source-half guard. An empty set is empty of one thing at a time.
    const root = mkdtempSync(join(tmpdir(), "pin-empty-"));
    // A pin that asserts its scan roots exist needs them present-but-empty here,
    // or the roots guard fires first and hides a deleted vacuity guard.
    for (const dir of scanRoots ?? []) mkdirSync(join(root, dir), { recursive: true });
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

// The daemon grew a second front door (ADR-0058), so the pin watches the
// websocket server library the same way it watches node:net. Nothing under the
// scanned roots imports `ws` today and nothing is meant to - the transport
// dials with the global WebSocket - so these two plants are the only evidence
// that half of the matcher does anything at all.
test("b5: a ws import outside packages/transport fails with the offending path named", () => {
  const root = plant("tools/rogue/dial.mjs", 'import WebSocket from "ws";\n');
  for (const dir of ["packages", "tools", "scripts"]) mkdirSync(join(root, dir), { recursive: true });
  const r = runPin("b5", ["--root", root]);
  expect(r.status).toBe(1);
  expect(r.output).toContain("websocket client outside packages/transport");
  expect(r.output).toContain("tools/rogue/dial.mjs");
});

test("b5: the same ws import inside packages/transport passes", () => {
  const root = plant("packages/transport/src/dial.ts", 'import WebSocket from "ws";\n', {
    "tools/keep.mjs": "export {};\n",
  });
  for (const dir of ["packages", "tools", "scripts"]) mkdirSync(join(root, dir), { recursive: true });
  const r = runPin("b5", ["--root", root]);
  expect(r.output).toContain("pin-b5: ok");
  expect(r.status).toBe(0);
});

test("b8: the raw-input class it contains is stated, not assumed", () => {
  // ADR-0046 struck the outright ban and re-specified this pin as containment:
  // the tool names appear ONLY inside the raw-input class implementation. The
  // class does not exist yet, so the contained set is empty - and an empty set
  // has to SAY so rather than let a reader assume the pin still bans outright.
  // Without this, the pin's report is identical whether containment was
  // implemented or forgotten, which is the shape of a gate that cannot fail.
  const r = runPin("b8");
  expect(r.status).toBe(0);
  expect(r.output).toContain("outside the raw-input class");
  expect(r.output).toContain("no raw-input class exists yet");
});

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

for (const pin of ["b1", "b5"]) {
  test(`${pin}: a missing scan root fails rather than guarding the wrong population`, () => {
    // The amputation of apps/ (ADR-0057) is exactly this hazard: delete a root
    // and the pin still finds files in the roots that remain, so the non-empty
    // guard goes green over a population the pin was never written to defend.
    const root = plant("packages/kept/src/a.ts", "export {};\n");
    mkdirSync(join(root, "tools"), { recursive: true });
    const r = runPin(pin, ["--root", root]);
    expect(r.status).toBe(1);
    expect(r.output).toContain("scan root(s) missing");
    expect(r.output).toContain("scripts");
  });
}
