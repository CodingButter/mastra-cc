import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The schema's own invariants: exactly fourteen methods, the id pattern, and a
// golden fixture cut from exactly these schema bytes. The planted-vocabulary
// cases for the B10 pin live in tools/pins/__tests__/b10.test.mjs, where the
// planted platform terms sit inside the one directory every pin excludes.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const schemaText = readFileSync(join(repoRoot, "protocol", "schema.json"), "utf8");
const schema = JSON.parse(schemaText);

describe("protocol/schema.json v1", () => {
  it("declares exactly seventeen methods - the fourteen through ADR-0056, the two the desk answers about itself (ADR-0064), and the restart the operator authorises (ADR-0065)", () => {
    expect(Object.keys(schema.methods)).toEqual([
      "queryElements",
      "attestElement",
      "readElementContent",
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
      "describeAccessibility",
      "acquireAccessibility",
      "restartApplication",
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
    // `running` and `runningUnknownBy` joined in 1.7.0 (ADR-0063). They are
    // still facts ABOUT the application rather than from inside it: whether it
    // answers the accessibility layer, and which setting withholds the answer.
    expect(fields).toEqual(["name", "capabilities", "launchable", "running", "runningUnknownBy", "diagnostic"]);
    expect(schema.runningStates).toEqual(["answering", "not-answering", "cannot-tell"]);
    expect(schema.types.installedApplication.fields.running.required).toBe(true);
    expect(schema.types.capability.fields.disabledBy).toBeDefined();
  });

  it("requires one provider-neutral observable-content state, including value-free protected redaction (ADR-0056)", () => {
    expect(schema.version).toBe("1.10.0");
    expect(schema.types.semanticElement.fields.content).toMatchObject({
      type: "observableContent",
      required: true,
    });

    const variants = Object.fromEntries(schema.types.observableContent.variants.map((variant) => [variant.name, variant]));
    expect(Object.keys(variants)).toEqual(["text", "text-window", "number", "redacted", "unavailable"]);
    expect(variants.text.fields.value.type).toBe("string");
    expect(Object.keys(variants["text-window"].fields)).toEqual([
      "kind",
      "value",
      "offset",
      "length",
      "totalLength",
      "startLine",
      "endLine",
      "totalLines",
    ]);
    expect(variants.number.fields.value.type).toBe("number");
    expect(variants.number.fields.range.type).toBe("observableRange");
    expect(variants.redacted.fields.reason.literal).toBe("protected");
    expect(variants.redacted.fields.value).toBeUndefined();
    expect(variants.unavailable.fields.reason.literals).toEqual(["not-exposed", "unknown"]);
    expect(variants.unavailable.fields.value).toBeUndefined();
  });

  it("gives changeEvent no field that could carry content - a pointer, never a payload (ADR-0032 clause 2)", () => {
    const fields = Object.keys(schema.types.changeEvent.fields);
    expect(fields).not.toContain("name");
    expect(fields).not.toContain("value");
    expect(fields).not.toContain("text");
    expect(fields).not.toContain("content");
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
