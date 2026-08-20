import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SemanticElement } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import { isVisible } from "../grants.js";
import { composeBootNames } from "../launch/profiles.js";
import { CATALOG } from "../launch/recipes.js";
import { OwnershipTable } from "../launch/table.js";
import {
  CONFIGURABLE_CAPABILITIES,
  loadCapabilitiesFile,
  MalformedCapabilitiesFileError,
  WITHHOLDS_NOTHING,
  withheldBy,
} from "../capabilities.js";
import {
  EDIT_SCOPE_REFUSAL,
  UNAVAILABLE_REFUSAL,
  handleRequest,
  type LaunchContext,
} from "../server.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// The user's capability configuration, and the daemon enforcing it (ADR-0043
// clause 4, ADR-0042). Two properties are pinned here and they are different:
// the FILE says what the user meant, and the GATE refuses before the call in a
// sentence that names the setting. A configuration that parsed correctly and
// enforced nothing would pass every test in the first half of this file.

const dir = mkdtempSync(join(tmpdir(), "mastra-cc-capabilities-"));

function file(name: string, contents: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof contents === "string" ? contents : JSON.stringify(contents));
  return path;
}

describe("the capability configuration file", () => {
  it("an absent file withholds nothing - the session gates are the ones that deny by default", () => {
    // Deliberately NOT deny-by-default here, and the reason is in
    // capabilities.ts: --allow and the grants file already deny by default, so
    // a second silent denial would leave an operator who granted a class with
    // nothing and no setting to name as the reason.
    const loaded = loadCapabilitiesFile(join(dir, "does-not-exist.json"));
    expect(loaded.defaults.size).toBe(0);
    expect(loaded.applications.size).toBe(0);
    for (const capability of CONFIGURABLE_CAPABILITIES) {
      expect(withheldBy(loaded, capability, "yad")).toBeUndefined();
    }
  });

  it("a malformed file fails loudly with a named error - never silently \"everything is allowed\"", () => {
    expect(() => loadCapabilitiesFile(file("not-json.json", "this is not json"))).toThrow(
      MalformedCapabilitiesFileError,
    );
    expect(() => loadCapabilitiesFile(file("array.json", ["edit"]))).toThrow(MalformedCapabilitiesFileError);
    expect(() => loadCapabilitiesFile(file("bad-block.json", { defaults: "edit" }))).toThrow(
      MalformedCapabilitiesFileError,
    );
    expect(() => loadCapabilitiesFile(file("bad-apps.json", { applications: ["yad"] }))).toThrow(
      MalformedCapabilitiesFileError,
    );
    // A value that is not a permission at all. Guessing which way a string
    // like "no" or "off" leans is exactly the guess a permissions file must
    // not invite.
    expect(() => loadCapabilitiesFile(file("bad-value.json", { defaults: { edit: "off" } }))).toThrow(
      MalformedCapabilitiesFileError,
    );
  });

  it("a misspelled capability is refused rather than silently configuring nothing", () => {
    // The --allow lesson, one layer out: a typo that quietly grants nothing
    // looks exactly like a daemon that ignores its configuration.
    expect(() => loadCapabilitiesFile(file("typo.json", { defaults: { edti: false } }))).toThrow(
      MalformedCapabilitiesFileError,
    );
  });

  it("observe is refused by name and the refusal says where observe IS configured - one capability, one setting", () => {
    let message = "";
    try {
      loadCapabilitiesFile(file("observe.json", { defaults: { observe: false } }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("grants file");
  });

  it("there is no key that turns enforcement off - an unknown top-level key is refused", () => {
    // A permission system with a disable switch is a permission system that
    // lies. The property is that no such key exists, so the test asserts the
    // shape that would introduce one is rejected rather than ignored.
    expect(() => loadCapabilitiesFile(file("switch.json", { enforce: false }))).toThrow(
      MalformedCapabilitiesFileError,
    );
  });

  it("application names are NFKC-normalised at load - a math-bold name matches its plain form", () => {
    const loaded = loadCapabilitiesFile(
      file("math-bold.json", { applications: { "\u{1D432}\u{1D41A}\u{1D41D}": { edit: false } } }),
    );
    expect(withheldBy(loaded, "edit", "yad")).toBeDefined();
  });

  it("a per-application answer beats the default, in both directions", () => {
    const loaded = loadCapabilitiesFile(
      file("mixed.json", { defaults: { edit: false }, applications: { yad: { edit: true } } }),
    );
    // The default withholds; the application the user named does not.
    expect(withheldBy(loaded, "edit", "yad")).toBeUndefined();
    expect(withheldBy(loaded, "edit", "chrome")).toBeDefined();

    const inverse = loadCapabilitiesFile(
      file("inverse.json", { defaults: { edit: true }, applications: { yad: { edit: false } } }),
    );
    expect(withheldBy(inverse, "edit", "yad")).toBeDefined();
    expect(withheldBy(inverse, "edit", "chrome")).toBeUndefined();
  });

  it("the withholding answer NAMES the setting - never a bare boolean", () => {
    // A refusal a person cannot act on is a wall. This is the whole reason
    // withheldBy returns a setting name instead of false.
    const loaded = loadCapabilitiesFile(file("named.json", { applications: { yad: { submit: false } } }));
    expect(withheldBy(loaded, "submit", "yad")).toBe('applications["yad"].submit');
    expect(withheldBy(loadCapabilitiesFile(file("global.json", { defaults: { submit: false } })), "submit", "yad")).toBe(
      "defaults.submit",
    );
  });

  it("an unnameable application falls back to the defaults rather than borrowing another application's setting", () => {
    const loaded = loadCapabilitiesFile(
      file("fallback.json", { defaults: { edit: false }, applications: { yad: { edit: true } } }),
    );
    expect(withheldBy(loaded, "edit", undefined)).toBe("defaults.edit");
  });
});

describe("the daemon enforces the configuration", () => {
  // A backend that answers an element and names its application, and throws if
  // any verb reaches it: every assertion below is about a refusal produced
  // BEFORE the call (pin B11), so a verb arriving here is a failure, loudly.
  const element: SemanticElement = {
    id: "el-000000000000",
    role: "text",
    name: "message",
    states: ["enabled", "visible"],
    actions: [],
    operations: [],
  };
  const untouchable = {
    name: "untouchable",
    queryElements: async () => ({ elements: [element] }),
    attestElement: async () => ({ element }),
    applicationOfElement: () => "yad",
    listApplications: undefined,
    subscribeElement: async () => {
      throw new Error("the capability gate touched the backend");
    },
    unsubscribeElement: async () => {
      throw new Error("the capability gate touched the backend");
    },
    ...observeOnlyEffects,
    editElement: async () => {
      throw new Error("the capability gate touched the backend");
    },
    close: async () => undefined,
  } as unknown as Backend;

  // An element that really publishes something: one verb, one operation the
  // element backs and one it does not. The reporting tests need a reading with
  // both shapes in it, or the not-exposed half would have nothing to protect.
  const publishing = {
    ...(untouchable as unknown as Record<string, unknown>),
    queryElements: async () => ({
      elements: [
        {
          ...element,
          actions: [{ name: "click", availability: "available" as const }],
          operations: [
            { operation: "setValue" as const, availability: "not-exposed" as const },
            { operation: "setText" as const, availability: "available" as const },
          ],
        },
      ],
    }),
  } as unknown as Backend;

  function context(overrides: Partial<LaunchContext>): LaunchContext {
    return {
      permits: new Set(),
      catalog: {},
      table: new OwnershipTable(),
      pollBudgetMs: 60,
      pollIntervalMs: 10,
      ...overrides,
    };
  }

  const edit = (launch: LaunchContext) =>
    handleRequest(
      { type: "request", id: 1, method: "editElement", params: { id: element.id, value: "typed" } },
      untouchable,
      launch,
    ).then((response) => response.result as { element?: SemanticElement; refusal?: string });

  it("a capability the user turned off is refused before the call, and the refusal names the setting", async () => {
    const capabilities = loadCapabilitiesFile(file("off.json", { applications: { yad: { edit: false } } }));
    const result = await edit(context({ allows: new Set(["edit"]), capabilities }));
    expect(result.element).toBeUndefined();
    expect(result.refusal).toContain("capability configuration");
    expect(result.refusal).toContain('applications["yad"].edit');
    // The remedy is named, which is the difference between this refusal and
    // one that says a thing is impossible (ADR-0042).
    expect(result.refusal).toContain("changing that setting");
  });

  it("the same session with the capability on reaches the backend - the gate is not a constant", async () => {
    // Non-vacuity: a gate that refused unconditionally would pass the test
    // above and fail this one. The backend's throw is the evidence the call
    // got through.
    const capabilities = loadCapabilitiesFile(file("on.json", { applications: { yad: { edit: true } } }));
    const response = await handleRequest(
      { type: "request", id: 1, method: "editElement", params: { id: element.id, value: "typed" } },
      untouchable,
      context({ allows: new Set(["edit"]), capabilities }),
    );
    expect(response.refusal).toBeDefined();
    expect(response.result).toBeUndefined();
  });

  it("the four routed operations are withheld by the same setting as the verb of their class", async () => {
    // The operations do not get settings of their own: setElementValue and
    // setElementText change what an element HOLDS, which is what edit means,
    // and revealElement makes a surface do something visible, which is what
    // activate means. A configuration surface that withheld editElement while
    // serving setElementText would be a setting the user cannot reason about.
    const capabilities = loadCapabilitiesFile(
      file("operations-off.json", { applications: { yad: { edit: false, activate: false } } }),
    );
    const cases = [
      { method: "setElementValue", params: { id: element.id, value: 3 }, allow: "edit", setting: 'applications["yad"].edit' },
      { method: "setElementText", params: { id: element.id, text: "typed" }, allow: "edit", setting: 'applications["yad"].edit' },
      { method: "setElementCaret", params: { id: element.id, offset: 0 }, allow: "edit", setting: 'applications["yad"].edit' },
      { method: "revealElement", params: { id: element.id }, allow: "activate", setting: 'applications["yad"].activate' },
    ] as const;

    for (const { method, params, allow, setting } of cases) {
      const response = await handleRequest(
        { type: "request", id: 1, method, params },
        untouchable,
        context({ allows: new Set([allow]), capabilities }),
      );
      const result = response.result as { element?: SemanticElement; refusal?: string };
      expect(result.element).toBeUndefined();
      expect(result.refusal).toContain("capability configuration");
      expect(result.refusal).toContain(setting);
      expect(result.refusal).toContain("changing that setting");
    }
  });

  it("authority is asked before configuration - a session without the class hears the scope gate, unchanged", async () => {
    // Order matters for what the caller learns: a session that was never given
    // edit is told about the class it lacks, not about a setting on an
    // application it could not have touched anyway (ADR-0019).
    const capabilities = loadCapabilitiesFile(file("both.json", { applications: { yad: { edit: false } } }));
    const result = await edit(context({ allows: new Set(), capabilities }));
    expect(result.refusal).toBe(EDIT_SCOPE_REFUSAL);
  });

  it("a launch the user turned off is refused by the configuration, not by the unavailable constant", async () => {
    // The permitted name is not made to look absent: the session WAS permitted
    // to launch it, so naming the setting tells the caller nothing it did not
    // already know - and hiding it would be the false belief ADR-0042 kills.
    const capabilities = loadCapabilitiesFile(file("no-launch.json", { defaults: { launch: false } }));
    const response = await handleRequest(
      { type: "request", id: 1, method: "openApplication", params: { name: "yad" } },
      untouchable,
      context({ permits: new Set(["yad"]), capabilities }),
    );
    const result = response.result as { refusal?: string };
    expect(result.refusal).not.toBe(UNAVAILABLE_REFUSAL);
    expect(result.refusal).toContain("defaults.launch");
  });

  it("an UNPERMITTED launch stays byte-identical to an unknown name even when configuration would also withhold it", async () => {
    // The security property survives the new layer: authority runs first, so a
    // name this session was never permitted cannot be distinguished from one
    // that does not exist by reading the refusal (ADR-0008 rule 6).
    const capabilities = loadCapabilitiesFile(file("no-launch-2.json", { defaults: { launch: false } }));
    const response = await handleRequest(
      { type: "request", id: 1, method: "openApplication", params: { name: "chrome" } },
      untouchable,
      context({ permits: new Set(), capabilities }),
    );
    expect((response.result as { refusal?: string }).refusal).toBe(UNAVAILABLE_REFUSAL);
  });

  it("turning a launch off leaves the application VISIBLE - a permit still implies an observe grant", () => {
    // The preservation property (ADR-0036, ADR-0038): visibility is composed
    // from the permit set, and the capability configuration composes beside it
    // rather than through it. A configuration that withheld launch AND made
    // the application invisible would answer a person's "do not start this"
    // with a daemon that denies the application exists - the exact reversal
    // ADR-0042 makes, undone one layer down.
    const { launchPermits, visibility } = composeBootNames({
      permits: new Set(["yad"]),
      grants: new Set(),
      flags: new Set(),
      catalog: CATALOG,
    });
    expect(launchPermits.has("yad")).toBe(true);
    expect(isVisible(visibility, "yad")).toBe(true);
    // And the configuration says nothing about visibility: it has no key that
    // could, which is why this asserts the capability half separately.
    const capabilities = loadCapabilitiesFile(file("visible.json", { applications: { yad: { launch: false } } }));
    expect(withheldBy(capabilities, "launch", "yad")).toBeDefined();
    expect(isVisible(visibility, "yad")).toBe(true);
  });

  it("a verb the user turned off reads as disabled-by-configuration and NAMES the setting - never not-exposed", async () => {
    // The three states get their meaning here (ADR-0045). An element that
    // publishes a verb still publishes it; what changed is that a setting
    // withholds it, and the report has to say which - because an agent told
    // `not-exposed` concludes the desktop cannot do a thing the desktop can do.
    const capabilities = loadCapabilitiesFile(file("report.json", { applications: { yad: { activate: false } } }));
    const response = await handleRequest(
      { type: "request", id: 1, method: "queryElements", params: {} },
      publishing,
      context({ allows: new Set(["activate"]), capabilities }),
    );
    const [answered] = (response.result as { elements: SemanticElement[] }).elements;
    expect(answered.actions[0].availability).toBe("disabled-by-configuration");
    expect(answered.actions[0].disabledBy).toBe('applications["yad"].activate');
  });

  it("an operation the ELEMENT never offered stays not-exposed - a setting cannot grant what the application does not back", async () => {
    // The other direction, and the one that keeps this honest: configuration
    // subtracts, it never adds. Turning edit off must not rewrite an operation
    // the element itself refuses into a policy shape, and turning it on must
    // not promote one.
    const capabilities = loadCapabilitiesFile(file("no-promote.json", { applications: { yad: { edit: false } } }));
    const response = await handleRequest(
      { type: "request", id: 1, method: "queryElements", params: {} },
      publishing,
      context({ allows: new Set(["edit"]), capabilities }),
    );
    const [answered] = (response.result as { elements: SemanticElement[] }).elements;
    const setValue = answered.operations?.find((operation) => operation.operation === "setValue");
    const setText = answered.operations?.find((operation) => operation.operation === "setText");
    expect(setValue?.availability).toBe("not-exposed");
    expect(setValue?.disabledBy).toBeUndefined();
    // setText WAS available, so it is the one the setting withholds.
    expect(setText?.availability).toBe("disabled-by-configuration");
    expect(setText?.disabledBy).toBe('applications["yad"].edit');
  });

  it("with nothing withheld, what the element published is what the caller reads", async () => {
    // Non-vacuity for both tests above: the same element, no configuration,
    // comes back exactly as the backend answered it.
    const response = await handleRequest(
      { type: "request", id: 1, method: "queryElements", params: {} },
      publishing,
      context({ allows: new Set(["edit", "activate"]) }),
    );
    const [answered] = (response.result as { elements: SemanticElement[] }).elements;
    expect(answered.actions[0].availability).toBe("available");
    expect(answered.actions[0].disabledBy).toBeUndefined();
    expect(answered.operations?.find((operation) => operation.operation === "setText")?.availability).toBe("available");
  });

  it("a session with no configuration behaves exactly as it did before this file existed", async () => {
    // The stated default, asserted rather than inferred: the same call, with
    // WITHHOLDS_NOTHING and with the field absent entirely, reaches the
    // backend both times.
    for (const capabilities of [WITHHOLDS_NOTHING, undefined]) {
      const response = await handleRequest(
        { type: "request", id: 1, method: "editElement", params: { id: element.id, value: "typed" } },
        untouchable,
        context({ allows: new Set(["edit"]), capabilities }),
      );
      expect(response.refusal).toBeDefined();
      expect(response.result).toBeUndefined();
    }
  });
});
