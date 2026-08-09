import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ROLES } from "@mastra-cc/protocol-types";
import { mappedNeutralRoles, toNeutralRole, toNeutralStates } from "../roles.js";

// The native-to-neutral map (B10, ADR-0018 clause 3): every emitted role is
// neutral vocabulary, and the deny-list the pin enforces on the schema is
// enforced here on the backend's output too - the map that LEAKS a platform
// word would pass the schema pin and still poison the wire.

const here = dirname(fileURLToPath(import.meta.url));
const denyList: string[] = JSON.parse(
  readFileSync(join(here, "..", "..", "..", "..", "..", "tools", "pins", "deny-list.json"), "utf8"),
);

describe("the native-to-neutral role map", () => {
  it("maps every native word it knows to a role the schema defines", () => {
    for (const role of mappedNeutralRoles()) {
      expect(ROLES).toContain(role);
    }
  });

  it("maps an unknown native role to generic and keeps the native word in the diagnostic field", () => {
    const { role, diagnostic } = toNeutralRole("flux capacitor lever");
    expect(role).toBe("generic");
    expect(diagnostic?.nativeRole).toBe("flux capacitor lever");
  });

  it("emits no diagnostic for a mapped role - the native word dies at the map", () => {
    const { role, diagnostic } = toNeutralRole("push button");
    expect(role).toBe("button");
    expect(diagnostic).toBeUndefined();
  });

  it("never emits a deny-listed platform term as a role", () => {
    const probes = ["push button", "frame", "entry", "some unknown role", "check box"];
    for (const probe of probes) {
      const { role } = toNeutralRole(probe);
      for (const term of denyList) {
        expect(role.toLowerCase()).not.toContain(term);
      }
    }
  });
});

describe("the native state bits", () => {
  it("reads the live-probed button bits {11,24,25,30} as enabled and visible", () => {
    // exactly what the launched dialog's button answered on this machine
    const states = toNeutralStates(1124075520, 0);
    expect(states).toContain("enabled");
    expect(states).toContain("visible");
    expect(states).not.toContain("offscreen");
  });

  it("treats the toolkit's responds-to-input bit as enabled even without the enabled bit", () => {
    expect(toNeutralStates(1 << 24, 0)).toContain("enabled");
  });

  it("marks visible-but-not-showing as offscreen", () => {
    const states = toNeutralStates(1 << 30, 0);
    expect(states).toContain("offscreen");
  });
});
