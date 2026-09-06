import { describe, expect, it } from "vitest";
import { handleRequest } from "../server.js";
import type { AccessibilityLayer, AccessibilityReport } from "../accessibility/index.js";
import { observeOnlyEffects } from "./support/observe-only.js";
import type { Backend } from "../backend.js";

// Measured 2026-09-05 on the demo container. The daemon was started with
// authority to switch the accessibility layer on, did so, served a run for
// several minutes - and then something on that desktop wrote IsEnabled back to
// false underneath it. Every query after that answered with an empty element
// list, which is the same shape a desktop with nothing running answers with,
// and the run above it concluded the desk was bare and gave up.
//
// Emptiness with the layer on is an answer. The same emptiness with the layer
// off is silence. These tests hold the two apart.

function layer(state: AccessibilityReport["state"], acquired: { count: number }): AccessibilityLayer {
  let current = state;
  return {
    acquirable: true,
    async acquire() {
      acquired.count += 1;
      current = "enabled";
    },
    async report() {
      return current === "cannot-tell" ? { state: "cannot-tell", reason: "no answer" } : { state: current };
    },
  };
}

function backend(elements: unknown[]): Backend {
  return {
    ...observeOnlyEffects,
    async queryElements() {
      return { elements } as never;
    },
    async discoverElements() {
      return { elements } as never;
    },
  } as unknown as Backend;
}

async function ask(back: Backend, accessibility: AccessibilityLayer, mayAcquire: boolean, method = "queryElements") {
  return (await handleRequest(
    { id: "1", method, params: method === "discoverElements" ? { application: "kate" } : {} } as never,
    back,
    { accessibility, mayAcquireAccessibility: mayAcquire } as never,
  )) as { result?: Record<string, unknown>; refusal?: string };
}

describe("an empty answer from a desk whose layer went off", () => {
  it("refuses rather than answering emptily, and says the layer is off and not the desk bare", async () => {
    const acquired = { count: 0 };
    const answer = (await ask(backend([]), layer("disabled", acquired), true)) as { result?: { refusal?: string } };
    expect(answer.result?.refusal).toContain("its accessibility layer is switched off");
    expect(answer.result?.refusal).toContain("not because nothing is running");
  });

  it("switches the layer back on within the authority this session already holds, and says so", async () => {
    const acquired = { count: 0 };
    const answer = (await ask(backend([]), layer("disabled", acquired), true)) as { result?: { refusal?: string } };
    expect(acquired.count).toBe(1);
    expect(answer.result?.refusal).toContain("ask the same question again");
  });

  it("does not switch anything on for a session that was never granted that act", async () => {
    const acquired = { count: 0 };
    const answer = (await ask(backend([]), layer("disabled", acquired), false)) as { result?: { refusal?: string } };
    expect(acquired.count).toBe(0);
    expect(answer.result?.refusal).toContain("its accessibility layer is switched off");
  });

  it("leaves an empty answer alone when the layer is on - that emptiness is an answer", async () => {
    const acquired = { count: 0 };
    const answer = (await ask(backend([]), layer("enabled", acquired), true)) as { result?: { elements?: unknown[]; refusal?: string } };
    expect(answer.result?.elements).toEqual([]);
    expect(answer.result?.refusal).toBeUndefined();
    expect(acquired.count).toBe(0);
  });

  it("does not ask about the layer at all when the query found something", async () => {
    const acquired = { count: 0 };
    const answer = (await ask(backend([{ id: "el-1" }]), layer("disabled", acquired), true)) as {
      result?: { elements?: unknown[]; refusal?: string };
    };
    expect(answer.result?.refusal).toBeUndefined();
    expect(acquired.count).toBe(0);
  });

  it("says nothing about a layer it could not read - that is a different question, with its own verb", async () => {
    const acquired = { count: 0 };
    const answer = (await ask(backend([]), layer("cannot-tell", acquired), true)) as { result?: { elements?: unknown[]; refusal?: string } };
    expect(answer.result?.elements).toEqual([]);
    expect(answer.result?.refusal).toBeUndefined();
  });

  it("holds the same line for discovery as for a query", async () => {
    const acquired = { count: 0 };
    const answer = (await ask(backend([]), layer("disabled", acquired), true, "discoverElements")) as { result?: { refusal?: string } };
    expect(answer.result?.refusal).toContain("its accessibility layer is switched off");
    expect(acquired.count).toBe(1);
  });
});
