import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// B10's three planted directions plus the vacuous-pass guard. The planted
// platform terms below are legal HERE and only here: tools/pins/ is the one
// directory every pin excludes, so these fixtures cannot flag themselves.

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const pin = join(repoRoot, "tools", "pins", "b10.mjs");
const realSchema = JSON.parse(readFileSync(join(repoRoot, "protocol", "schema.json"), "utf8"));

function runOn(schemaObject) {
  const file = join(mkdtempSync(join(tmpdir(), "b10-test-")), "schema.json");
  writeFileSync(file, typeof schemaObject === "string" ? schemaObject : JSON.stringify(schemaObject, null, 2));
  return spawnSync(process.execPath, [pin, "--schema", file], { encoding: "utf8" });
}

describe("pin b10 - no platform vocabulary on the wire", () => {
  it("is green over the real schema", () => {
    const r = runOn(realSchema);
    expect(r.stdout).toContain("no platform vocabulary on the wire");
    expect(r.status).toBe(0);
  });

  it("goes red on a platform-named role value", () => {
    const planted = structuredClone(realSchema);
    planted.roles.push("gtk-frame");
    const r = runOn(planted);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('"gtk"');
    expect(r.stderr).toContain("gtk-frame");
  });

  it("goes red on a platform-named enum value - the clause ADR-0018 names explicitly", () => {
    const planted = structuredClone(realSchema);
    planted.states.push("uia-focused");
    const r = runOn(planted);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('"uia"');
  });

  it("goes red on a platform term in a field name", () => {
    const planted = structuredClone(realSchema);
    planted.types.semanticElement.fields["x11-window"] = { type: "string", required: false, description: "planted" };
    const r = runOn(planted);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("(name)");
  });

  it("stays green on a native identifier inside the diagnostic subtree - clause 6, by field name", () => {
    const planted = structuredClone(realSchema);
    planted.types.diagnostic.fields.nativeRole.description = "The backend's own role word, e.g. an atspi role, verbatim.";
    planted.types.semanticElement.fields.diagnostic.description = "Carries gtk and qt identifiers for a human reading a log.";
    const r = runOn(planted);
    expect(r.stdout).toContain("diagnostic subtree exempt");
    expect(r.status).toBe(0);
  });

  it("refuses an empty schema rather than passing vacuously", () => {
    const r = runOn("");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("would pass vacuously");
  });
});
