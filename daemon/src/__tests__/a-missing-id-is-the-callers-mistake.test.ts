import { describe, expect, it } from "vitest";
import type { Backend } from "../backend.js";
import { handleRequest, NO_PERMITS, type LaunchContext } from "../server.js";

// A MISSING ID IS THE CALLER'S MISTAKE.
//
// Every element method names its element by the string id a query returned.
// These handlers used to coerce anything else to "" and pass it on, so the
// backend looked for an element called "" and refused as if the WORLD had lost
// it (world/UnperformableElementError). The benchmark saw it live: a probe that
// sent `element` instead of `id` was told the element was gone. A request that
// names no element is refused as malformed - agent-owned - before any backend
// is asked anything.

const METHODS: Record<string, Record<string, unknown>> = {
  editElement: { value: "x" },
  activateElement: { action: "press" },
  submitElement: {},
  setElementValue: { value: 1 },
  setElementText: { text: "x" },
  setElementCaret: { offset: 0 },
  revealElement: {},
  sendKeyChord: { chord: "Tab" },
  clearElementText: {},
  clickElement: {},
  typeText: { text: "x" },
};

const EVERY_CLASS: LaunchContext = {
  ...NO_PERMITS,
  allows: new Set(["edit", "activate", "submit", "rawInput"]),
};

function recording(): { backend: Backend; calls: string[] } {
  const calls: string[] = [];
  const backend = new Proxy({} as Record<string, unknown>, {
    get(_, key) {
      if (key === "then") return undefined;
      if (key === "name") return "recording";
      return (...args: unknown[]) => {
        calls.push(`${String(key)}(${JSON.stringify(args[0] ?? null)})`);
        throw new Error("the recording backend answers nothing");
      };
    },
  }) as unknown as Backend;
  return { backend, calls };
}

const BAD_IDS: Record<string, (extra: Record<string, unknown>) => Record<string, unknown>> = {
  "no id": (extra) => ({ ...extra }),
  "a numeric id": (extra) => ({ ...extra, id: 7 }),
  "element instead of id": (extra) => ({ ...extra, element: "el-000000000001" }),
};

describe("a request without a string id", () => {
  for (const [method, extra] of Object.entries(METHODS)) {
    for (const [shape, build] of Object.entries(BAD_IDS)) {
      it(`${method} with ${shape} is agent/MalformedParameter and never reaches the backend`, async () => {
        const { backend, calls } = recording();
        const response = await handleRequest({ type: "request", id: 1, method, params: build(extra) }, backend, EVERY_CLASS);
        const refusal = (response as { result?: { refusal?: { class: string; code: string; message: string } } }).result?.refusal;
        expect(refusal?.class).toBe("agent");
        expect(refusal?.code).toBe("MalformedParameter");
        expect(refusal?.message).toContain(`"${method}" needs an "id" that is a string`);
        expect(calls).toEqual([]);
      });
    }

    it(`${method} with a string id still reaches the backend`, async () => {
      const { backend, calls } = recording();
      await handleRequest({ type: "request", id: 1, method, params: { ...extra, id: "el-000000000001" } }, backend, EVERY_CLASS);
      expect(calls.some((c) => c.includes("el-000000000001"))).toBe(true);
    });
  }
});
