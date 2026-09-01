import { describe, expect, it } from "vitest";
import { validateInstalledApplication, validateSemanticElement } from "@mastra-cc/protocol-types";

// Schema version 1.4.0 (ADR-0047). The shipped enum - press, focus, select,
// expand - shared ZERO words with a live desktop across 2,497 elements, so the
// action NAME opened and the verdict beside it stayed closed. These tests
// exercise the emitted validator, because that validator is what actually runs
// at the boundary: the schema text is a claim and the generated checker is the
// enforcement.

function element(overrides: Record<string, unknown> = {}) {
  return {
    id: "el-0123456789ab",
    role: "button",
    name: "OK",
    states: ["enabled", "visible"],
    actions: [{ name: "click", availability: "available" }],
    operations: [{ operation: "reveal", availability: "available" }],
    content: { kind: "unavailable", reason: "not-exposed" },
    ...overrides,
  };
}

describe("the action vocabulary is the desktop's, not ours", () => {
  it("accepts a platform action name that the old four-word enum never contained", () => {
    // Every one of these was measured live and every one would have been
    // rejected by schema 1.3.0. That rejection was the bug.
    for (const name of ["doDefault", "showContextMenu", "click", "menu", "activate"]) {
      expect(validateSemanticElement(element({ actions: [{ name, availability: "available" }] }))).toEqual([]);
    }
  });

  it("carries the element's own description and display wording alongside the name", () => {
    // ADR-0045 clause 2: names are never normalised into synonyms, so a reader
    // telling click from doDefault needs the application's own words.
    expect(
      validateSemanticElement(
        element({
          actions: [{ name: "click", description: "Clicks the button", localizedName: "Click", availability: "available" }],
        }),
      ),
    ).toEqual([]);
  });

  it("still rejects an availability the daemon never defined", () => {
    // The open half opened; the closed half stayed closed. A vocabulary the
    // daemon itself decides is still versioned with the schema (ADR-0018
    // clause 2, amended in one respect only).
    const problems = validateSemanticElement(element({ actions: [{ name: "click", availability: "probably" }] }));
    expect(problems).toContain('action.availability: "probably" is not one of the availabilityState values');
  });

  it("rejects an action with no availability at all", () => {
    const problems = validateSemanticElement(element({ actions: [{ name: "click" }] }));
    expect(problems).toContain("action.availability: required field is missing");
  });
});

describe("the three availability states cannot be collapsed into two", () => {
  // This is the exit-gate item. "Turned off by a setting" is a door with a key;
  // "never offered by the platform" is a wall. An agent told the wrong one
  // either badgers a user about a setting that does not exist, or gives up on
  // something one toggle away. The three states are distinguishable ON THE
  // WIRE, and each of the assertions below breaks if two of them merge.

  it("distinguishes all three, and each carries a different obligation", () => {
    expect(validateSemanticElement(element({ actions: [{ name: "click", availability: "available" }] }))).toEqual([]);
    expect(
      validateSemanticElement(element({ actions: [{ name: "click", availability: "disabled-by-configuration", disabledBy: "capabilities.activate" }] })),
    ).toEqual([]);
    expect(validateSemanticElement(element({ actions: [{ name: "click", availability: "not-exposed" }] }))).toEqual([]);
  });

  it("refuses a configuration-withheld action that names no setting", () => {
    // Withheld-without-a-remedy is an unanswerable refusal: it tells a reader
    // a setting exists and never says which. Collapsing this state into
    // not-exposed would make this pass.
    const problems = validateSemanticElement(element({ actions: [{ name: "click", availability: "disabled-by-configuration" }] }));
    expect(problems).toContain("action.disabledBy: an availability withheld by configuration must name the setting that withholds it");
  });

  it("refuses a not-exposed action that names a setting", () => {
    // The mirror image, and the reason this is enforced in BOTH directions:
    // naming a setting where none applies invents a remedy that does not
    // exist. Collapsing not-exposed into disabled-by-configuration makes this
    // pass.
    const problems = validateSemanticElement(element({ actions: [{ name: "click", availability: "not-exposed", disabledBy: "capabilities.activate" }] }));
    expect(problems).toContain('action.disabledBy: present on an availability of "not-exposed" - only a configuration-withheld one names a setting');
  });

  it("refuses an available action that names a setting", () => {
    const problems = validateSemanticElement(element({ actions: [{ name: "click", availability: "available", disabledBy: "capabilities.activate" }] }));
    expect(problems).toContain('action.disabledBy: present on an availability of "available" - only a configuration-withheld one names a setting');
  });
});

describe("a magnitude is expressed in the range the element published", () => {
  it("accepts an operation carrying the bounds the element declared", () => {
    // The live level bar that motivated this: minimum 0, maximum 1, current
    // 0.9852447509765625, and a step it also declared.
    expect(
      validateSemanticElement(
        element({
          operations: [{ operation: "setValue", availability: "available", range: { minimum: 0, maximum: 1, current: 0.9852447509765625, step: 0 } }],
        }),
      ),
    ).toEqual([]);
  });

  it("accepts an operation whose element declared no step", () => {
    // Absent means the element published none - never that the step is zero.
    expect(
      validateSemanticElement(
        element({ operations: [{ operation: "setValue", availability: "available", range: { minimum: 0, maximum: 100, current: 42 } }] }),
      ),
    ).toEqual([]);
  });

  it("refuses a range missing a bound, so no reader has to guess one", () => {
    const problems = validateSemanticElement(
      element({ operations: [{ operation: "setValue", availability: "available", range: { minimum: 0, current: 42 } }] }),
    );
    expect(problems).toContain("range.maximum: required field is missing");
  });

  it("refuses a bound that is not a number", () => {
    const problems = validateSemanticElement(
      element({ operations: [{ operation: "setValue", availability: "available", range: { minimum: 0, maximum: "100%", current: 42 } }] }),
    );
    expect(problems).toContain("range.maximum: expected a number");
  });

  it("refuses an operation the contract never defined", () => {
    // The operations are a closed set precisely because each one is a promise
    // to implement it on every platform (ADR-0045 clause 3).
    const problems = validateSemanticElement(element({ operations: [{ operation: "scrollBy", availability: "available" }] }));
    expect(problems).toContain('operation.operation: "scrollBy" is not one of the operationName values');
  });

  it("lets an element report an operation it does not offer, so absence is a reading", () => {
    expect(validateSemanticElement(element({ operations: [{ operation: "setValue", availability: "not-exposed" }] }))).toEqual([]);
  });
});

describe("the listing describes the fence, never what is behind it", () => {
  // Segment 3 implements this method; the contract it implements against is
  // proven here, so that work starts against something already checked.

  it("accepts an application present with every capability off and each setting named", () => {
    // The exact inverse of the invisibility the M2.5 proof recorded: an
    // unpermitted application is PRESENT and honest about why (ADR-0042).
    expect(
      validateInstalledApplication({
        name: "OBS Studio",
        launchable: false,
        // Withheld observation withholds the running state with it, and says
        // so: cannot-tell naming the file, never a claim that it is closed.
        running: "cannot-tell",
        runningUnknownBy: "the grants file (--grants)",
        capabilities: [
          { capability: "observe", availability: "disabled-by-configuration", disabledBy: "capabilities.observe" },
          { capability: "launch", availability: "disabled-by-configuration", disabledBy: "capabilities.launch" },
          { capability: "edit", availability: "disabled-by-configuration", disabledBy: "capabilities.edit" },
          { capability: "activate", availability: "disabled-by-configuration", disabledBy: "capabilities.activate" },
          { capability: "submit", availability: "disabled-by-configuration", disabledBy: "capabilities.submit" },
        ],
      }),
    ).toEqual([]);
  });

  it("accepts an application that is installed and honestly not launchable", () => {
    // Installed-but-no-recipe is a statement about the daemon's own recipes,
    // never about permission - the inventory is not the launch catalog.
    expect(
      validateInstalledApplication({
        name: "Creality Print",
        launchable: false,
        running: "not-answering",
        capabilities: [{ capability: "observe", availability: "available" }],
      }),
    ).toEqual([]);
  });

  it("refuses a capability withheld without naming the setting a person would change", () => {
    // A refusal that cannot be acted on is a wall, not an answer.
    const problems = validateInstalledApplication({
      name: "OBS Studio",
      launchable: true,
      running: "answering",
      capabilities: [{ capability: "observe", availability: "disabled-by-configuration" }],
    });
    expect(problems).toContain("capability.disabledBy: an availability withheld by configuration must name the setting that withholds it");
  });

  it("refuses a listing that says nothing about what is open", () => {
    // Silence is not an answer, and a reader would take an absent field for a
    // no. Schema 1.7.0 makes running required for exactly that reason.
    const problems = validateInstalledApplication({
      name: "OBS Studio",
      launchable: true,
      capabilities: [{ capability: "observe", availability: "available" }],
    });
    expect(problems).toContain("installedApplication.running: required field is missing");
  });

  it("refuses a running state outside the three the contract defines", () => {
    // "maybe" or "true" would each be a new state smuggled past every reader
    // written against the vocabulary.
    const problems = validateInstalledApplication({
      name: "OBS Studio",
      launchable: true,
      running: "probably",
      capabilities: [{ capability: "observe", availability: "available" }],
    });
    expect(problems.join(" ")).toContain("running");
  });

  it("refuses a capability the contract never defined", () => {
    const problems = validateInstalledApplication({
      name: "OBS Studio",
      launchable: true,
      running: "answering",
      capabilities: [{ capability: "screenshot", availability: "available" }],
    });
    expect(problems).toContain('capability.capability: "screenshot" is not one of the capabilityName values');
  });
});
