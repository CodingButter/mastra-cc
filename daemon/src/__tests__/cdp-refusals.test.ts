import { refusalCode, refusalOwner, refusalText } from "./refusal-text.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAuditLog, useAuditLog, type AuditEntry } from "../audit.js";
import type { Channel, Exchange } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { CdpDeadlineError, DialogBlockingError } from "../backends/cdp/channel.js";
import { BACKEND_UNREADABLE_REFUSAL, handleRequest, type LaunchContext } from "../server.js";
import { OwnershipTable } from "../launch/table.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";

// A browser that went silent is refused in words that say what is known.
//
// The daemon, not the backend, decides how a CdpDeadlineError reads: driven
// through handleRequest, the real dispatch, over a staged backend whose verb
// or read throws the deadline. The audit file is read back off the disk, and
// the wire response is serialised the way the socket would send it, so the
// internal refusalClass is proven to stay off the wire.

const ENABLED_BIT = 8;
const VISIBLE_BIT = 30;
const SHOWING_BIT = 25;
const BUS = ":1.subject";
const APP = "/app";
const SUBJECT = "/subject";

function stage(): Channel {
  const bits = (1 << ENABLED_BIT) | (1 << VISIBLE_BIT) | (1 << SHOWING_BIT);
  return {
    async call(exchange: Exchange): Promise<unknown[]> {
      if (exchange.destination === "org.a11y.atspi.Registry" && exchange.member === "GetChildren") return [[[BUS, APP]]];
      const isApp = exchange.path === APP;
      switch (exchange.member) {
        case "GetChildren":
          return [isApp ? [[BUS, SUBJECT]] : []];
        case "GetRoleName":
          return [isApp ? "application" : "push button"];
        case "GetState":
          return [[bits, 0]];
        case "GetInterfaces":
          return [isApp ? [] : ["org.a11y.atspi.Action", "org.a11y.atspi.Component"]];
        case "GetActions":
          return [isApp ? [] : [["click", "", ""]]];
        case "GetNActions":
          return [isApp ? 0 : 1];
        case "GetName":
          return ["click"];
        case "Get": {
          const [, property] = exchange.body as [string, string];
          if (property === "Name") return [isApp ? "subject-app" : "Subject"];
          throw new Error(`unexpected property ${property}`);
        }
        default:
          throw new Error(`unexpected member ${exchange.member}`);
      }
    },
    watch: () => {
      throw new Error("this channel does not watch");
    },
    close: async () => undefined,
  };
}

function context(): LaunchContext {
  return {
    permits: new Set(),
    catalog: DEFANGED_CATALOG,
    table: new OwnershipTable(),
    allows: new Set(["edit", "activate", "submit"]),
  };
}

let temporary: string | undefined;
function auditing(): string {
  temporary = mkdtempSync(join(tmpdir(), "mastra-cc-cdp-refusals-"));
  const path = join(temporary, "audit.jsonl");
  useAuditLog(openAuditLog(path));
  return path;
}
function entries(path: string): AuditEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as AuditEntry);
}
afterEach(() => {
  useAuditLog(undefined);
  if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true });
  temporary = undefined;
});

async function silentOn(verb: "activateElement" | "queryElements", error: Error) {
  const backend = new AtspiBackend(stage(), "all");
  const { elements } = await backend.queryElements({});
  const id = elements.find((element) => element.role === "button")!.id;
  (backend as unknown as Record<string, unknown>)[verb] = async () => {
    throw error;
  };
  return { backend, id };
}

async function wire(method: string, params: unknown, backend: AtspiBackend) {
  const response = await handleRequest({ type: "request", id: 1, method, params }, backend, context());
  // What the socket would carry, byte for byte.
  const line = JSON.stringify(response);
  return { line, parsed: JSON.parse(line) as { result?: { refusal?: string }; refusal?: string } };
}

describe("an effect the browser never answered", () => {
  it("says the outcome is UNKNOWN when the call was sent", async () => {
    const path = auditing();
    const { backend, id } = await silentOn("activateElement", new CdpDeadlineError({ method: "Runtime.callFunctionOn", effectSent: true }));
    const { line, parsed } = await wire("activateElement", { id, action: "click" }, backend);

    expect(refusalText(parsed.result)).toContain("UNKNOWN");
    expect(refusalText(parsed.result)).toContain("Runtime.callFunctionOn");
    expect(refusalText(parsed.result)).not.toContain("nothing was changed");
    expect(line).not.toContain("refusalClass");
    expect(entries(path).map((e) => e.outcome)).toEqual(["refused:DeadlineExceeded"]);
    expect([refusalOwner(parsed.result), refusalCode(parsed.result)]).toEqual(["world", "DeadlineExceeded"]);
  });

  it("says nothing was changed when the call never left, and never claims an unknown effect", async () => {
    const path = auditing();
    const { backend, id } = await silentOn("activateElement", new CdpDeadlineError({ method: "open", effectSent: false }));
    const { line, parsed } = await wire("activateElement", { id, action: "click" }, backend);

    expect(refusalText(parsed.result)).toContain("nothing was changed");
    expect(refusalText(parsed.result)).not.toContain("UNKNOWN");
    expect(line).not.toContain("refusalClass");
    expect(entries(path).map((e) => e.outcome)).toEqual(["refused:DeadlineExceeded"]);
    expect([refusalOwner(parsed.result), refusalCode(parsed.result)]).toEqual(["world", "DeadlineExceeded"]);
  });
});

describe("a read the browser never answered", () => {
  it("is a handler-level refusal naming the deadline, not the backend-unreadable backstop", async () => {
    const path = auditing();
    const { backend } = await silentOn("queryElements", new CdpDeadlineError({ method: "Accessibility.getFullAXTree", effectSent: true }));
    const { line, parsed } = await wire("queryElements", {}, backend);

    expect(refusalText(parsed.result)).toContain("did not answer");
    expect(refusalText(parsed.result)).toContain("nothing was changed");
    expect(refusalText(parsed.result)).not.toBe(BACKEND_UNREADABLE_REFUSAL);
    expect(line).not.toContain("refusalClass");
    expect(line).not.toContain(BACKEND_UNREADABLE_REFUSAL);
    expect(entries(path).map((e) => e.outcome)).toEqual(["refused:DeadlineExceeded"]);
    expect([refusalOwner(parsed.result), refusalCode(parsed.result)]).toEqual(["world", "DeadlineExceeded"]);
  });
});

describe("a page held by a native dialog", () => {
  const dialog = (effectSent: boolean) =>
    new DialogBlockingError({ type: "alert", message: "hi there", method: "Runtime.callFunctionOn", effectSent });

  it("refuses an effect naming the dialog, and says UNKNOWN only when the effect was sent", async () => {
    for (const sent of [true, false]) {
      const path = auditing();
      const { backend, id } = await silentOn("activateElement", dialog(sent));
      const { line, parsed } = await wire("activateElement", { id, action: "click" }, backend);
      expect(refusalText(parsed.result)).toContain('alert dialog ("hi there")');
      expect(refusalText(parsed.result)?.includes("UNKNOWN")).toBe(sent);
      expect(line).not.toContain("refusalClass");
      expect(entries(path).map((e) => e.outcome)).toEqual(["refused:BlockedByDialog"]);
    expect([refusalOwner(parsed.result), refusalCode(parsed.result)]).toEqual(["world", "BlockedByDialog"]);
    }
  });

  it("refuses a read at handler level, not with the backend-unreadable backstop", async () => {
    const path = auditing();
    const { backend } = await silentOn("queryElements", dialog(true));
    const { line, parsed } = await wire("queryElements", {}, backend);
    expect(refusalText(parsed.result)).toContain("until a person answers it");
    expect(refusalText(parsed.result)).not.toContain("UNKNOWN");
    expect(line).not.toContain("refusalClass");
    expect(line).not.toContain(BACKEND_UNREADABLE_REFUSAL);
    expect(entries(path).map((e) => e.outcome)).toEqual(["refused:BlockedByDialog"]);
    expect([refusalOwner(parsed.result), refusalCode(parsed.result)]).toEqual(["world", "BlockedByDialog"]);
  });
});

describe("a page that did not answer the attach", () => {
  it("says it may be a dialog or busy, and that nothing changed", async () => {
    auditing();
    const { backend } = await silentOn("queryElements", new CdpDeadlineError({ method: "Page.enable", effectSent: false }));
    const { parsed } = await wire("queryElements", {}, backend);
    expect(refusalText(parsed.result)).toContain("may be showing a dialog or be busy");
    expect(refusalText(parsed.result)).toContain("nothing was changed");
  });
});

describe("a page that does not answer when attached", () => {
  it("says it may be a dialog or a busy page, and that nothing was changed", async () => {
    const path = auditing();
    const { backend } = await silentOn("queryElements", new CdpDeadlineError({ method: "Page.enable", effectSent: false }));
    const { line, parsed } = await wire("queryElements", {}, backend);
    expect(refusalText(parsed.result)).toContain("may be showing a dialog or be busy");
    expect(refusalText(parsed.result)).toContain("nothing was changed");
    expect(line).not.toContain("refusalClass");
    expect(entries(path).map((e) => e.outcome)).toEqual(["refused:DeadlineExceeded"]);
    expect([refusalOwner(parsed.result), refusalCode(parsed.result)]).toEqual(["world", "DeadlineExceeded"]);
  });
});
