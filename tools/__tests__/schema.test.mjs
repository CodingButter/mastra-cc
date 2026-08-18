import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The schema's own invariants: exactly thirteen methods, the id pattern, and a
// golden fixture cut from exactly these schema bytes. The planted-vocabulary
// cases for the B10 pin live in tools/pins/__tests__/b10.test.mjs, where the
// planted platform terms sit inside the one directory every pin excludes.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const schemaText = readFileSync(join(repoRoot, "protocol", "schema.json"), "utf8");
const schema = JSON.parse(schemaText);

describe("protocol/schema.json v1", () => {
  it("declares exactly thirteen methods - the 1.0.0 pair, 1.3.0's subscription pair (ADR-0039), 1.1.0's openApplication (ADR-0034), 1.2.0's defined-and-refused trio (ADR-0037), and 1.4.0's four operations and application listing (ADR-0047) - and no fourteenth", () => {
    expect(Object.keys(schema.methods)).toEqual([
      "queryElements",
      "attestElement",
      "subscribeElement",
      "unsubscribeElement",
      "openApplication",
      "editElement",
      "activateElement",
      "submitElement",
      "setElementValue",
      "setElementText",
      "setElementCaret",
      "revealElement",
      "listApplications",
    ]);
  });

  it("keeps the action name open and the verdict beside it closed - schema version 1.4.0 (ADR-0047)", () => {
    // The four-word enum shared zero words with the live desktop, so the name
    // is now whatever the element published. What stayed closed is what the
    // daemon itself decides: an action's availability.
    expect(schema.actions).toBeUndefined();
    expect(schema.types.action.fields.name.type).toBe("string");
    expect(schema.types.action.fields.availability.type).toBe("availabilityState");
    expect(schema.availabilityStates).toEqual(["available", "disabled-by-configuration", "not-exposed"]);
  });

  it("names no distance, direction or coordinate on the reveal operation (ADR-0045 clause 5)", () => {
    // Scroll is not an action and carries no geometry: the same platform
    // offers an enum of positions AND a pixel pair, so a wire that picked
    // either would be picking one machine's geometry.
    expect(Object.keys(schema.methods.revealElement.params)).toEqual(["id"]);
  });

  it("lets the listing report an application without reporting anything inside it (ADR-0042)", () => {
    const fields = Object.keys(schema.types.installedApplication.fields);
    expect(fields).toEqual(["name", "capabilities", "launchable", "diagnostic"]);
    expect(schema.types.capability.fields.disabledBy).toBeDefined();
  });

  it("gives changeEvent no field that could carry content - a pointer, never a payload (ADR-0032 clause 2)", () => {
    const fields = Object.keys(schema.types.changeEvent.fields);
    expect(fields).not.toContain("name");
    expect(fields).not.toContain("value");
    expect(fields).not.toContain("text");
    expect(fields).toEqual([
      "subscriptionId",
      "id",
      "role",
      "kind",
      "attribution",
      "causeId",
      "priority",
      "at",
    ]);
  });

  it("makes submitElement's attestation required - waiving it is inexpressible (ADR-0021)", () => {
    expect(schema.methods.submitElement.params.attestation.required).toBe(true);
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
