import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTemplateStore } from "@mastra-cc/voice/node";

import { createWakeControl } from "../wake-control.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "wake-control-"));
  dirs.push(dir);
  let now = 1_000;
  let cancelled = false;
  const control = createWakeControl({
    origin: "http://127.0.0.1:4173",
    nonce: "n".repeat(64),
    now: () => now,
    templates: createTemplateStore(join(dir, "templates.json")),
    capture: async (signal) => {
      signal.addEventListener("abort", () => {
        cancelled = true;
      });
      return Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
    },
  });
  return { control, advance: (milliseconds: number) => (now += milliseconds), cancelled: () => cancelled };
}

describe("the widget-owned wake enrolment control boundary", () => {
  it("redeems the bootstrap nonce exactly once for the exact launched origin", () => {
    const { control } = fixture();
    expect(control.redeem("n".repeat(64), "http://127.0.0.1:4173").session).toHaveLength(64);
    expect(() => control.redeem("n".repeat(64), "http://127.0.0.1:4173")).toThrow(/bootstrap/);
  });

  it("rejects another scheme, host, or port", () => {
    const origins = ["https://127.0.0.1:4173", "http://localhost:4173", "http://127.0.0.1:4174"];
    for (const origin of origins) {
      const { control } = fixture();
      expect(() => control.redeem("n".repeat(64), origin)).toThrow(/origin/);
    }
  });

  it("binds commands to the session and strictly increasing command ids", () => {
    const { control } = fixture();
    const { session } = control.redeem("n".repeat(64), "http://127.0.0.1:4173");

    expect(control.command(session, "http://127.0.0.1:4173", { id: 1, type: "heartbeat" })).toEqual({ ok: true });
    expect(() => control.command(session, "http://127.0.0.1:4173", { id: 1, type: "heartbeat" })).toThrow(/sequence/);
    expect(() => control.command(session, "http://127.0.0.1:4173", { id: 3, type: "heartbeat" })).toThrow(/sequence/);
    expect(() => control.command(session, "http://127.0.0.1:9999", { id: 2, type: "heartbeat" })).toThrow(/origin/);
  });

  it("expires after three missed heartbeats and rejects every later command", () => {
    const { control, advance } = fixture();
    const { session } = control.redeem("n".repeat(64), "http://127.0.0.1:4173");
    advance(6_000);
    control.sweep();

    expect(() => control.command(session, "http://127.0.0.1:4173", { id: 1, type: "heartbeat" })).toThrow(/session/);
  });

  it("cancels an active take when the session expires", async () => {
    const { control, advance, cancelled } = fixture();
    const { session } = control.redeem("n".repeat(64), "http://127.0.0.1:4173");
    const take = control.command(session, "http://127.0.0.1:4173", { id: 1, type: "capture", takeId: "take-1" });
    advance(6_000);
    control.sweep();
    await take;

    expect(cancelled()).toBe(true);
    expect(control.snapshot().takes).toEqual([]);
  });

  it("publishes exactly five selected takes, returns the revision, and expires", async () => {
    const { control } = fixture();
    const { session } = control.redeem("n".repeat(64), "http://127.0.0.1:4173");
    for (let id = 1; id <= 5; id += 1) {
      await control.command(session, "http://127.0.0.1:4173", { id, type: "capture", takeId: `take-${id}` });
    }
    expect(
      control.command(session, "http://127.0.0.1:4173", {
        id: 6,
        type: "publish",
        takeIds: ["take-1", "take-2", "take-3", "take-4", "take-5"],
      }),
    ).toEqual({ revision: 1 });
    expect(() => control.command(session, "http://127.0.0.1:4173", { id: 7, type: "heartbeat" })).toThrow(/session/);
  });

  it("reset expires the session and discards every take", async () => {
    const { control } = fixture();
    const { session } = control.redeem("n".repeat(64), "http://127.0.0.1:4173");
    await control.command(session, "http://127.0.0.1:4173", { id: 1, type: "capture", takeId: "take-1" });
    expect(control.command(session, "http://127.0.0.1:4173", { id: 2, type: "reset" })).toEqual({ ok: true });
    expect(control.snapshot().takes).toEqual([]);
  });
});
