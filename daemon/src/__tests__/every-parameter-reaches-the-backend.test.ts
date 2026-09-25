import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// EVERY PARAMETER REACHES THE BACKEND (audit M4).
//
// `capturedAt` was added to the schema, validated by the server, and then
// silently not handed to the backend: the check it existed for never ran. This
// test reads the contract and the server side by side. For every method the
// server forwards to a backend method of the same name, the object it passes
// must name every parameter the schema defines for that method. A parameter the
// contract accepts but the server drops goes red here, by name.

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, "../../../protocol/schema.json"), "utf8")) as {
  methods: Record<string, { params?: Record<string, unknown> }>;
};
const server = readFileSync(join(here, "../server.ts"), "utf8");

// Methods the server hands straight to `backend.<same name>({ ... })`. The
// others are answered by the daemon itself (scoping, grants, subscriptions)
// and have their own tests; this list is closed so a forwarded method cannot
// quietly leave it.
const FORWARDED = [
  "editElement",
  "activateElement",
  "submitElement",
  "setElementValue",
  "setElementText",
  "setElementCaret",
  "revealElement",
  "sendKeyChord",
  "typeText",
  "clearElementText",
  "clickElement",
];

function forwardedKeys(method: string): string[][] {
  const calls = [...server.matchAll(new RegExp(`backend\\.${method}\\(\\{([^}]*)\\}`, "g"))];
  return calls.map((call) =>
    call[1]
      .split(",")
      .map((part) => part.trim().split(":")[0].trim())
      .filter(Boolean),
  );
}

describe("every schema parameter of a forwarded method reaches the backend", () => {
  for (const method of FORWARDED) {
    it(method, () => {
      const params = Object.keys(schema.methods[method]?.params ?? {});
      const calls = forwardedKeys(method);
      expect(calls.length, `server.ts never calls backend.${method}({ ... })`).toBeGreaterThan(0);
      for (const keys of calls) expect(keys).toEqual(expect.arrayContaining(params));
    });
  }
});
