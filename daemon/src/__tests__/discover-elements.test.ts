import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAuditLog, useAuditLog } from "../audit.js";
import type { Backend } from "../backend.js";
import { OwnershipTable } from "../launch/table.js";
import {
  DISCOVERY_APPLICATION_REFUSAL,
  DISCOVERY_LIMIT_REFUSAL,
  DISCOVERY_WINDOW_REFUSAL,
  handleRequest,
  type LaunchContext,
} from "../server.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

function backendThat(asked: unknown[]): Backend {
  return {
    name: "discovery-fixture",
    ...observeOnlyEffects,
    queryElements: async () => ({ elements: [] }),
    discoverElements: async (params: unknown) => {
      asked.push(params);
      return { entries: [], truncated: false };
    },
    applicationOfElement: () => undefined,
    close: () => undefined,
  } as unknown as Backend;
}

function discover(params: Record<string, unknown>, backend: Backend) {
  return handleRequest({ type: "request", id: 1, method: "discoverElements", params }, backend, {
    permits: new Set(),
    catalog: DEFANGED_CATALOG,
    table: new OwnershipTable(),
    visibility: "all",
  } as unknown as LaunchContext);
}

function refusalIn(answer: { refusal?: string; result?: unknown }): string | undefined {
  return answer.refusal ?? (answer.result as { refusal?: string } | undefined)?.refusal;
}

let temporary: string | undefined;
afterEach(() => {
  useAuditLog(undefined);
  if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true });
  temporary = undefined;
});

describe("bounded element discovery boundary", () => {
  it.each([
    [{}, DISCOVERY_APPLICATION_REFUSAL],
    [{ application: "" }, DISCOVERY_APPLICATION_REFUSAL],
    [{ application: 42 }, DISCOVERY_APPLICATION_REFUSAL],
    [{ application: "app", window: "" }, DISCOVERY_WINDOW_REFUSAL],
    [{ application: "app", window: 42 }, DISCOVERY_WINDOW_REFUSAL],
    [{ application: "app", limit: 0 }, DISCOVERY_LIMIT_REFUSAL],
    [{ application: "app", limit: 201 }, DISCOVERY_LIMIT_REFUSAL],
    [{ application: "app", limit: 1.5 }, DISCOVERY_LIMIT_REFUSAL],
  ])("refuses malformed discovery input before backend dispatch", async (params, refusal) => {
    const asked: unknown[] = [];
    const answer = await discover(params, backendThat(asked));
    expect(refusalIn(answer)).toBe(refusal);
    expect(asked).toEqual([]);
  });

  it("defaults the bounded result limit before backend dispatch", async () => {
    const asked: unknown[] = [];
    const answer = await discover({ application: "Chromium", role: "textbox" }, backendThat(asked));
    expect(refusalIn(answer)).toBeUndefined();
    expect(asked).toEqual([{ application: "Chromium", role: "textbox", limit: 100 }]);
  });

  it("records only the resolved application identity and strips internal audit fields from the wire", async () => {
    temporary = mkdtempSync(join(tmpdir(), "mastra-cc-discovery-audit-"));
    const path = join(temporary, "audit.jsonl");
    useAuditLog(openAuditLog(path));
    const backend = backendThat([]);
    backend.discoverElements = async () => ({ entries: [], truncated: false, auditApplication: "chromium" });

    const answer = await discover({ application: "CHROMIUM" }, backend);

    expect(answer).toEqual({ type: "response", id: 1, result: { entries: [], truncated: false } });
    const entry = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(["application", "at", "attestation", "cause", "element", "outcome", "scope"]);
    expect(entry).toMatchObject({ application: "chromium", element: [], scope: "observe", attestation: null, outcome: "read" });
    expect(JSON.stringify(entry)).not.toContain("CHROMIUM");
  });
});
