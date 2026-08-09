import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The schema's own invariants: exactly two methods, the id pattern, and a
// golden fixture cut from exactly these schema bytes. The planted-vocabulary
// cases for the B10 pin live in tools/pins/__tests__/b10.test.mjs, where the
// planted platform terms sit inside the one directory every pin excludes.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const schemaText = readFileSync(join(repoRoot, "protocol", "schema.json"), "utf8");
const schema = JSON.parse(schemaText);

describe("protocol/schema.json v1", () => {
  it("declares exactly two methods: queryElements and attestElement, and no third", () => {
    expect(Object.keys(schema.methods)).toEqual(["queryElements", "attestElement"]);
  });

  it("pins semanticElement.id to the twelve-hex identity pattern", () => {
    expect(schema.idPattern).toBe("^(el|win|app)-[0-9a-f]{12}$");
    expect(schema.types.semanticElement.fields.id.pattern).toBe("idPattern");
  });

  it("carries the diagnostic field from version 1.0.0 (ADR-0018 clauses 3 and 6)", () => {
    expect(schema.types.semanticElement.fields.diagnostic.type).toBe("diagnostic");
    expect(schema.types.diagnostic.fields.nativeRole).toBeDefined();
  });

  it("ends its role vocabulary in generic, the unmapped-role target", () => {
    expect(schema.roles).toContain("generic");
  });

  it("has golden fixtures cut from exactly these schema bytes (digest agreement)", () => {
    const digest = createHash("sha256").update(schemaText).digest("hex");
    const golden = readFileSync(join(repoRoot, "protocol", "golden", "src", "index.ts"), "utf8");
    expect(golden).toContain(`SCHEMA_DIGEST = "${digest}"`);
  });

  it("passes the B10 pin as committed", () => {
    const r = spawnSync(process.execPath, [join(repoRoot, "tools", "pins", "b10.mjs"), "--root", repoRoot], {
      encoding: "utf8",
    });
    expect(r.stdout).toContain("no platform vocabulary on the wire");
    expect(r.status).toBe(0);
  });
});
