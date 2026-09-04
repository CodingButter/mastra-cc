import { describe, expect, it } from "vitest";
import type { Backend } from "../backend.js";
import { ACQUIRE_SETTING, unsupportedPlatform, type AccessibilityLayer } from "../accessibility/index.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAuditLog, useAuditLog, type AuditEntry } from "../audit.js";
import { OwnershipTable } from "../launch/table.js";
import { handleRequest, type LaunchContext } from "../server.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// CAN THIS MACHINE BE HEARD, ON THE WIRE (ADR-0064).
//
// Two questions and two different owners. Describing is a read of the daemon's
// own instrument and needs no permission from anyone. Acquiring changes the
// operator's machine, so it is off unless the operator armed it at startup -
// and these tests exist mostly to pin that no request can arm it, and that the
// two refusals stay different sentences: one names a setting an operator can
// change, the other says no setting would help.

const backend: Backend = {
  name: "no-desk",
  ...observeOnlyEffects,
  installedApplications: async () => [],
  runningApplications: async () => ({ observable: new Set<string>(), answersFor: "every-application" as const }),
  queryElements: async () => ({ elements: [] }),
  attestElement: async () => ({}),
  subscribeElement: async () => {
    throw new Error("not used");
  },
  unsubscribeElement: async () => undefined,
  applicationOfElement: () => undefined,
  readElementContent: async () => ({}),
  close: async () => undefined,
};

function context(over: Partial<LaunchContext> = {}): LaunchContext {
  return { permits: new Set(), catalog: DEFANGED_CATALOG, table: new OwnershipTable(), ...over };
}

function layerThat(report: () => Promise<{ state: string; reason?: string }>, acquire?: () => Promise<void>): AccessibilityLayer {
  return {
    report: report as AccessibilityLayer["report"],
    acquirable: acquire !== undefined,
    acquire: acquire ?? (async () => {
      throw new Error("not acquirable");
    }),
  };
}

async function call(method: string, launch: LaunchContext) {
  return handleRequest({ type: "request", id: 1, method }, backend, launch);
}

describe("describing whether this machine can be heard", () => {
  it("reports the layer's state to any session, granted or not", async () => {
    // No grant is consulted on purpose: nothing here came from an application,
    // so there is nothing an observe grant would be protecting.
    const response = await call("describeAccessibility", context({ accessibility: layerThat(async () => ({ state: "enabled" })) }));
    expect(response.result).toEqual({ accessibility: { state: "enabled" } });
  });

  it("says cannot-tell, with a reason, when the daemon has no adapter at all", async () => {
    const response = await call("describeAccessibility", context());
    const answer = (response.result as { accessibility: { state: string; reason?: string } }).accessibility;
    expect(answer.state).toBe("cannot-tell");
    // Never "disabled": that would report the operator's machine off on the
    // strength of this daemon's own incompleteness.
    expect(answer.reason).toBeTruthy();
  });
});

describe("acquiring is the operator's to permit", () => {
  it("refuses a daemon started without the flag, and names it", async () => {
    let acquired = false;
    const response = await call(
      "acquireAccessibility",
      context({
        accessibility: layerThat(async () => ({ state: "disabled" }), async () => {
          acquired = true;
        }),
      }),
    );
    expect(response.result).toMatchObject({ refusal: expect.stringContaining("disabled-by-configuration") });
    expect(response.result).toMatchObject({ refusal: expect.stringContaining(ACQUIRE_SETTING) });
    // THE ASSERTION THAT MATTERS: the gate ran before the adapter did.
    expect(acquired).toBe(false);
  });

  it("cannot be armed by anything in the request", async () => {
    // A session cannot grant itself authority to reconfigure the machine it is
    // running on. The flag lives in the process's argv and nowhere a caller
    // can reach; sending its name as a parameter changes nothing.
    let acquired = false;
    const response = await handleRequest(
      { type: "request", id: 2, method: "acquireAccessibility", params: { mayAcquireAccessibility: true, "acquire-accessibility": true } },
      backend,
      context({
        accessibility: layerThat(async () => ({ state: "disabled" }), async () => {
          acquired = true;
        }),
      }),
    );
    expect(response.result).toMatchObject({ refusal: expect.stringContaining(ACQUIRE_SETTING) });
    // And the adapter was never reached, so the parameter did not arm anything
    // downstream either - the assertion that keeps this from restating the
    // test above.
    expect(acquired).toBe(false);
  });

  it("acquires when the operator armed it, and reports what it re-read", async () => {
    let enabled = false;
    const layer = layerThat(
      async () => ({ state: enabled ? "enabled" : "disabled" }),
      async () => {
        enabled = true;
      },
    );
    const response = await call("acquireAccessibility", context({ accessibility: layer, mayAcquireAccessibility: true }));
    expect(response.result).toEqual({ accessibility: { state: "enabled" } });
  });

  it("reports what the machine actually did, not what was asked of it", async () => {
    // A write the platform accepted and ignored. The re-read is what makes
    // this visible rather than a success sentence over an unchanged desk.
    const layer = layerThat(async () => ({ state: "disabled" }), async () => undefined);
    const response = await call("acquireAccessibility", context({ accessibility: layer, mayAcquireAccessibility: true }));
    expect(response.result).toEqual({ accessibility: { state: "disabled" } });
  });

  it("refuses not-exposed, not disabled-by-configuration, where no adapter could act", async () => {
    // The distinction protocol/schema.json:236 is built on: an operator told
    // "a setting withholds this" goes looking for a setting that does not
    // exist. Armed, and still refused - because arming is not the obstacle.
    const response = await call(
      "acquireAccessibility",
      context({ accessibility: unsupportedPlatform("darwin"), mayAcquireAccessibility: true }),
    );
    const refusal = (response.result as { refusal: string }).refusal;
    expect(refusal).toContain("not-exposed");
    expect(refusal).not.toContain(ACQUIRE_SETTING);
  });

  it("refuses honestly when the layer would not switch on", async () => {
    const layer = layerThat(async () => ({ state: "disabled" }), async () => {
      throw new Error("read-only status object");
    });
    const response = await call("acquireAccessibility", context({ accessibility: layer, mayAcquireAccessibility: true }));
    expect(response.result).toMatchObject({ refusal: expect.stringContaining("did not accept") });
  });

  it("says what the half-acquired machine was left holding", async () => {
    // Acquiring is several writes (ADR-0075), so a failure can arrive with some
    // of them already accepted. The refusal must not read as "nothing
    // happened": the re-read travels with it, and it is the measured state.
    const layer = layerThat(async () => ({ state: "enabled" }), async () => {
      throw new Error("status object accepted one property and refused the next");
    });
    const response = await call("acquireAccessibility", context({ accessibility: layer, mayAcquireAccessibility: true }));
    expect(response.result).toMatchObject({
      refusal: expect.stringContaining("did not accept every property"),
      accessibility: { state: "enabled" },
    });
  });
});

describe("every acquire attempt is written down", () => {
  it("records the performed one and every refused one under the acquire scope", async () => {
    // A change to the OPERATOR'S machine is the least deniable thing this
    // daemon does, so it is attributable whether it worked, was withheld, or
    // failed - a record that keeps only the tidy cases is a record of the tidy
    // cases (ADR-0026).
    const directory = mkdtempSync(join(tmpdir(), "mastra-cc-acquire-audit-"));
    const path = join(directory, "audit.jsonl");
    useAuditLog(openAuditLog(path));
    try {
      await call("acquireAccessibility", context({ accessibility: layerThat(async () => ({ state: "disabled" })) }));
      await call(
        "acquireAccessibility",
        context({ accessibility: layerThat(async () => ({ state: "enabled" }), async () => undefined), mayAcquireAccessibility: true }),
      );
      // The two refusals that come from the MACHINE rather than from the
      // configuration: a platform with no adapter, and a status object that
      // refused the write. Both changed nothing, and both are attempts.
      await call("acquireAccessibility", context({ accessibility: unsupportedPlatform("darwin"), mayAcquireAccessibility: true }));
      await call(
        "acquireAccessibility",
        context({
          accessibility: layerThat(async () => ({ state: "disabled" }), async () => {
            throw new Error("read-only status object");
          }),
          mayAcquireAccessibility: true,
        }),
      );
    } finally {
      useAuditLog(undefined);
    }
    const lines: AuditEntry[] = existsSync(path)
      ? readFileSync(path, "utf8")
          .split("\n")
          .filter((line) => line.trim() !== "")
          .map((line) => JSON.parse(line) as AuditEntry)
      : [];
    rmSync(directory, { recursive: true, force: true });
    expect(lines.map((entry) => [entry.scope, entry.outcome])).toEqual([
      ["acquire", "refused:DisabledByConfiguration"],
      ["acquire", "performed"],
      ["acquire", "refused:AccessibilityNotAcquirable"],
      ["acquire", "refused:AccessibilityNotAcquired"],
    ]);
    // No application and no element, because there is neither: this is the
    // case `application: null` was defined for.
    expect(lines.every((entry) => entry.application === null && entry.element.length === 0)).toBe(true);
  });
});
