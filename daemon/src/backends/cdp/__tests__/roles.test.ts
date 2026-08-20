import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROLES } from "@mastra-cc/protocol-types";
import { stampVisibilityRoute, toNeutralRole, VISIBILITY_ROUTE } from "../roles.js";

// The Chromium-AX-to-neutral role map (B10, ADR-0018 clause 3), tested in the
// exact posture of the atspi map's suite: every emitted role is neutral
// vocabulary, an unmapped word survives in the diagnostic, and nothing on the
// deny-list ever leaves the map as a role.

const here = dirname(fileURLToPath(import.meta.url));
const denyList: string[] = JSON.parse(
  readFileSync(join(here, "..", "..", "..", "..", "..", "tools", "pins", "deny-list.json"), "utf8"),
);

describe("the Chromium-AX-to-neutral role map", () => {
  // ADR-0048: the words real Gmail's inbox published, measured on the
  // signed-in profile - a grid of one hundred rows of gridcells. These are
  // words the desktop offered, not words we invented, and each must cross
  // the wire as itself with no diagnostic residue.
  it("carries the measured Gmail structure as first-class words", () => {
    for (const word of ["grid", "row", "gridcell"] as const) {
      const { role, diagnostic } = toNeutralRole(word);
      expect(role).toBe(word);
      expect(diagnostic).toBeUndefined();
      expect(ROLES).toContain(role);
    }
  });

  it("maps Chromium's checkbox spelling to the checkbox role that already existed", () => {
    const { role, diagnostic } = toNeutralRole("checkbox");
    expect(role).toBe("checkbox");
    expect(diagnostic).toBeUndefined();
  });

  it("maps an unknown native role to generic and keeps the native word in the diagnostic field", () => {
    // "navigation" was observed on real Gmail and deliberately left in the
    // diagnostic (ADR-0048 clause 3) - promotion is another ADR, not a drift.
    const { role, diagnostic } = toNeutralRole("navigation");
    expect(role).toBe("generic");
    expect(diagnostic?.nativeRole).toBe("navigation");
  });

  it("never emits a deny-listed platform term as a role", () => {
    const probes = ["RootWebArea", "grid", "row", "gridcell", "checkbox", "some unknown role"];
    for (const probe of probes) {
      const { role } = toNeutralRole(probe);
      for (const term of denyList) {
        expect(role.toLowerCase()).not.toContain(term);
      }
    }
  });
});

describe("the visibility route stamp", () => {
  it("preserves the unmapped-role diagnostic it merges with", () => {
    const stamped = stampVisibilityRoute({ nativeRole: "navigation" });
    expect(stamped.nativeRole).toBe("navigation");
    expect(stamped["mastra-cc/visibility-route"]).toBe(VISIBILITY_ROUTE);
  });
});
