import { afterEach, describe, expect, it, vi } from "vitest";
import { LabelReader } from "../labels.js";
import { type Channel, type Exchange, UnrecordedExchangeError, captureChannel, fixturesDir } from "../channel.js";
import { replayChannel } from "../../replay/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

const root = { busName: ":1.1", objectPath: "/app" };
const field = { busName: ":1.1", objectPath: "/field" };
const pair = (path: string) => [root.busName, path];
const available = { kind: "available", provenance: "immediate-combo-parent", parentRole: "combo box", relation: "labelled-by", label: "Search for:", immediateChildCount: 2, editableChildCount: 1, siblingRole: "menu" };
const unavailable = (reason: string) => ({ kind: "unavailable", reason });
const text = ["org.a11y.atspi.Text", "org.a11y.atspi.EditableText"];
function fixture(override: (x: Exchange, calls: Exchange[]) => unknown[] | undefined | Promise<unknown[] | undefined> = () => undefined) {
  const calls: Exchange[] = [];
  const roles: Record<string, string> = { "/field": "text", "/parent": "combo box", "/menu": "menu", "/label": "label" };
  const channel: Channel = {
    async call(x) {
      calls.push(x);
      const answer = await override(x, calls);
      if (answer !== undefined) return answer;
      if (x.body?.[1] === "Parent") return [pair(x.path === "/field" || x.path === "/menu" ? "/parent" : "/app")];
      if (x.body?.[1] === "Name") return ["Search for:"];
      if (x.member === "GetApplication") return [pair("/app")];
      if (x.member === "GetRoleName") return [roles[x.path]];
      if (x.member === "GetInterfaces") return [x.path === "/field" ? text : []];
      if (x.member === "GetChildren") return [x.path === "/parent" ? [pair("/menu"), pair("/field")] : []];
      if (x.member === "GetState") return [[0, 0]];
      if (x.member === "GetRelationSet") return [x.path === "/parent" ? [[2, [pair("/label")]]] : []];
      throw new Error(`unexpected ${JSON.stringify(x)}`);
    },
    async watch() { throw new Error("not used"); },
    async close() {},
  };
  return { reader: new LabelReader(channel), calls, channel };
}
const observe = async (f: ReturnType<typeof fixture>, waited = 0) => f.reader.readEnriched(field, root, { waited });
afterEach(() => vi.useRealTimers());

describe("bounded immediate composite observations", () => {
  it("keeps direct labels empty and uses both backlinks, not child order", async () => {
    const f = fixture();
    expect(await observe(f)).toEqual({ labelObservation: { kind: "available", labels: [] }, compositeObservation: available });
    expect(f.calls.filter(x => x.body?.[1] === "Name")).toHaveLength(2);
    expect(f.calls.some(x => x.path === "/menu" && x.member === "GetChildren")).toBe(false);
    const name = f.calls.findIndex(x => x.body?.[1] === "Name");
    for (const path of ["/field", "/parent", "/menu", "/label"]) {
      expect(f.calls.slice(0, name).some(x => x.path === path && x.member === "GetApplication")).toBe(true);
      expect(f.calls.slice(0, name).some(x => x.path === path && x.body?.[1] === "Parent")).toBe(true);
    }
  });
  it.each([
    ["nested target", "/field", "GetChildren", [pair("/nested")], "not-exposed"],
    ["missing backlink", "/parent", "GetChildren", [pair("/menu"), pair("/other")], "unreadable"],
    ["duplicate children", "/parent", "GetChildren", [pair("/field"), pair("/field")], "unreadable"],
    ["third child", "/parent", "GetChildren", [pair("/field"), pair("/menu"), pair("/other")], "not-exposed"],
    ["two editable children", "/menu", "GetInterfaces", text, "ambiguous"],
    ["unsupported sibling", "/menu", "GetRoleName", "text", "not-exposed"],
    ["protected target", "/field", "GetRoleName", "password text", "out-of-scope"],
    ["protected label", "/label", "GetRoleName", "password text", "out-of-scope"],
    ["wrong native owner", "/label", "GetApplication", pair("/other-app"), "out-of-scope"],
    ["missing label", "/parent", "GetRelationSet", [], "not-exposed"],
    ["competing labels", "/parent", "GetRelationSet", [[2, [pair("/label"), pair("/second-label")]]], "ambiguous"],
    ["malformed relations", "/parent", "GetRelationSet", [[2, null]], "unreadable"],
    ["stale menu", "/menu", "GetState", [1 << 27, 0], "unreadable"],
    ["defunct label", "/label", "GetState", [1 << 6, 0], "unreadable"],
    ["malformed states", "/field", "GetState", [], "unreadable"],
    ["missing Text interface", "/field", "GetInterfaces", ["org.a11y.atspi.EditableText"], "not-exposed"],
  ])("refuses %s", async (_name, path, member, value, reason) => {
    const f = fixture(x => x.path === path && x.member === member ? [value] : undefined);
    expect((await observe(f)).compositeObservation).toEqual(unavailable(String(reason)));
    expect(f.calls.some(x => x.body?.[1] === "Name")).toBe(false);
  });
  it("refuses foreign bus without querying it or reading label content", async () => {
    const f = fixture(x => x.path === "/parent" && x.member === "GetRelationSet" ? [[[2, [[":1.9", "/label"]]]]] : undefined);
    expect((await observe(f)).compositeObservation).toEqual(unavailable("out-of-scope"));
    expect(f.calls.some(x => x.destination === ":1.9" || x.body?.[1] === "Name")).toBe(false);
  });
  it("rejects ownership cycles and contradictory sibling backlinks", async () => {
    for (const parent of ["/menu", "/app"]) {
      const f = fixture(x => x.path === "/menu" && x.body?.[1] === "Parent" ? [pair(parent)] : undefined);
      expect((await observe(f)).compositeObservation).toEqual(unavailable(parent === "/menu" ? "out-of-scope" : "unreadable"));
      expect(f.calls.some(x => x.body?.[1] === "Name")).toBe(false);
    }
  });
  it.each([16, 17])("bounds ownership chain at %i edges", async hops => {
    const f = fixture(x => {
      if (x.body?.[1] !== "Parent") return undefined;
      if (x.path === "/label") return [pair("/hop1")];
      if (x.path.startsWith("/hop")) { const n = Number(x.path.slice(4)); return [pair(n === hops - 1 ? "/app" : `/hop${n + 1}`)]; }
      return undefined;
    });
    expect((await observe(f)).compositeObservation).toEqual(hops === 16 ? available : unavailable("out-of-scope"));
  });
  it.each(["x".repeat(1024), "😀".repeat(1024)])("accepts text at the limit", async name => {
    const f = fixture(x => x.body?.[1] === "Name" ? [name] : undefined);
    expect((await observe(f)).compositeObservation).toEqual({ ...available, label: name });
  });
  it.each(["x".repeat(1025), "😀".repeat(1025)])("refuses overlong label", async name => {
    const f = fixture(x => x.body?.[1] === "Name" ? [name] : undefined);
    expect((await observe(f)).compositeObservation).toEqual(unavailable("limit-exceeded"));
  });
  it.each(["GetRoleName", "GetInterfaces", "GetState", "GetChildren", "GetRelationSet", "GetApplication"]) ("rejects changed %s on recheck", async member => {
    let count = 0;
    const f = fixture(x => {
      if (x.path !== "/parent" || x.member !== member || ++count !== 2) return undefined;
      return member === "GetRoleName" ? ["list"] : member === "GetInterfaces" ? [["changed"]] : member === "GetState" ? [[1, 0]] : member === "GetChildren" ? [[pair("/field"), pair("/menu")]] : member === "GetRelationSet" ? [[]] : [pair("/other")];
    });
    expect((await observe(f)).compositeObservation).toEqual(unavailable("unreadable"));
  });
  it("propagates absent replay exchanges instead of reporting unavailable", async () => {
    const error = new UnrecordedExchangeError("missing synthetic composite exchange");
    const f = fixture(x => { if (x.path === "/parent" && x.member === "GetChildren") throw error; return undefined; });
    await expect(observe(f)).rejects.toBe(error);
  });
  it("replays the complete reciprocal observation without inventing direct labels", async () => {
    const directory = mkdtempSync(join(fixturesDir(), "synthetic-composite-"));
    const captured = captureChannel(fixture().channel, basename(directory));
    const reader = new LabelReader(captured);
    try {
      const answer = await reader.readEnriched(field, root, { waited: 0 });
      expect(answer).toEqual({ labelObservation: { kind: "available", labels: [] }, compositeObservation: available });
      await captured.close();
      const replay = new LabelReader(replayChannel(basename(directory)));
      expect(await replay.readEnriched(field, root, { waited: 0 })).toEqual(answer);
      replay.close();
    } finally { reader.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  it.each([true, false])("retains honest late composite capture with close-before-settlement=%s", async closeBefore => {
    const directory = mkdtempSync(join(fixturesDir(), "synthetic-composite-late-"));
    let release!: (value: unknown[]) => void;
    let hung = false;
    const f = fixture(x => {
      if (x.path === "/label" && x.body?.[1] === "Name" && !hung) {
        hung = true;
        return new Promise(resolve => { release = resolve; });
      }
      return undefined;
    });
    const captured = captureChannel(f.channel, basename(directory));
    const reader = new LabelReader(captured);
    try {
      const answer = await reader.readEnriched(field, root, { waited: 0 });
      expect(answer.compositeObservation).toEqual(unavailable("unreadable"));
      if (closeBefore) { reader.close(); await captured.close(); }
      release(["Search for:"]);
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!closeBefore) await captured.close();
      const replay = new LabelReader(replayChannel(basename(directory)));
      if (closeBefore) await expect(replay.readEnriched(field, root, { waited: 0 })).rejects.toBeInstanceOf(UnrecordedExchangeError);
      else expect((await replay.readEnriched(field, root, { waited: 0 })).compositeObservation).toEqual(available);
      expect(answer.compositeObservation).toEqual(unavailable("unreadable"));
      replay.close();
    } finally { reader.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  it("does no native work after cumulative budget exhaustion", async () => {
    const f = fixture();
    expect((await observe(f, 500)).compositeObservation).toEqual(unavailable("limit-exceeded"));
    expect(f.calls).toEqual([]);
  });
  it("shares the element deadline with direct labels and keeps a timed-out call in the slot", async () => {
    vi.useFakeTimers();
    let release: ((value: unknown[]) => void) | undefined;
    const f = fixture(x => x.member === "GetApplication" ? new Promise(resolve => { release = resolve; }) : undefined);
    const pending = observe(f);
    await vi.advanceTimersByTimeAsync(251);
    expect((await pending).compositeObservation).toEqual(unavailable("unreadable"));
    const count = f.calls.length;
    expect((await observe(f)).compositeObservation).toEqual(unavailable("unreadable"));
    expect(f.calls).toHaveLength(count);
    f.reader.close(); release?.([pair("/app")]);
    await vi.advanceTimersByTimeAsync(1);
    expect((await observe(f)).compositeObservation).toEqual(unavailable("unreadable"));
    expect(f.calls).toHaveLength(count);
  });
});
