import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createTemplateStore, microphoneCaptureCommand } from "../node.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function storePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "voice-templates-"));
  dirs.push(dir);
  return join(dir, "templates.json");
}

describe("the widget-owned voice persistence boundary", () => {
  it("publishes templates atomically with a monotonic revision", () => {
    const path = storePath();
    const store = createTemplateStore(path);

    expect(store.read()).toEqual({ revision: 0, fingerprints: [] });
    expect(store.publish([[1, 0], [0.9, 0.1]])).toEqual({
      revision: 1,
      fingerprints: [[1, 0], [0.9, 0.1]],
    });
    expect(store.publish([[0, 1]])).toEqual({ revision: 2, fingerprints: [[0, 1]] });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(store.read());
    expect(existsSync(`${path}.next`)).toBe(false);
  });

  it("fails closed when stored templates are corrupt", () => {
    const path = storePath();
    writeFileSync(path, "not json");

    expect(createTemplateStore(path).read()).toEqual({ revision: 0, fingerprints: [] });
  });

  it("rejects invalid publication and leaves the prior revision active", () => {
    const store = createTemplateStore(storePath());
    const first = store.publish([[1, 0]]);

    expect(() => store.publish([[Number.NaN, 0]])).toThrow(/finite fingerprint/);
    expect(store.read()).toEqual(first);
  });

  it("defines the only production microphone command at the package boundary", () => {
    expect(microphoneCaptureCommand({ device: "hw:0,6", seconds: 2 })).toEqual({
      command: "arecord",
      args: ["--quiet", "--device", "hw:0,6", "--format", "S16_LE", "--channels", "1", "--rate", "16000", "--duration", "2", "--file-type", "raw"],
    });
  });
});
