import { afterEach, describe, expect, it, vi } from "vitest";
import { LabelReader } from "../labels.js";
import { AtspiBackend } from "../index.js";
import { deriveId } from "../identity.js";
import { UnrecordedExchangeError, captureChannel, fixturesDir, type Channel, type Exchange } from "../channel.js";
import { replayChannel } from "../../replay/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

const root = { busName: ":1.1", objectPath: "/app" };
const field = { busName: ":1.1", objectPath: "/field" };
const pair = (path: string, bus = root.busName) => [bus, path];
const unavailable = (reason: string) => ({ kind: "unavailable", reason });
// Deliberately synthetic channel; measured native captures are separate proof data.
function synthetic(overrides: (x: Exchange) => unknown[] | undefined = () => undefined) {
  const calls: Exchange[] = [];
  const channel: Channel = {
    async call(x) {
      calls.push(x);
      const answer = overrides(x);
      if (answer !== undefined) return answer;
      if (x.member === "GetRelationSet") return [[[2, [pair("/label")]]]];
      if (x.body?.[1] === "Parent") return [pair("/app")];
      if (x.body?.[1] === "Name") return ["Receipt number"];
      if (x.member === "GetRoleName") return ["label"];
      if (x.member === "GetState") return [[0, 0]];
      throw new Error(`unexpected synthetic call ${JSON.stringify(x)}`);
    },
    async watch() { throw new Error("not used"); },
    async close() {},
  };
  return { channel, calls, reader: new LabelReader(channel) };
}
afterEach(() => vi.useRealTimers());

function nativeDesk() {
  const fixture = synthetic(x => {
    if (x.member === "GetChildren") return [x.destination === "org.a11y.atspi.Registry" ? [pair("/app")] : x.path === "/app" ? [pair("/second"), pair("/first")] : []];
    if (x.member === "GetRoleName") return [x.path === "/app" ? "application" : x.path.startsWith("/label") ? "label" : "text"];
    if (x.member === "GetInterfaces") return [[]];
    if (x.body?.[1] === "Name") return [x.path === "/app" ? "Synthetic form" : x.path === "/label-first" ? "Receipt number" : x.path === "/label-second" ? "Total paid" : ""];
    if (x.member === "GetRelationSet") return [[[2, [pair(`/label-${x.path.slice(1)}`)]]]];
    return undefined;
  });
  return { ...fixture, backend: new AtspiBackend(fixture.channel, new Set(["synthetic form"])) };
}

describe("label observation integration", () => {
  it("maps reversed fields without changing names or matching, and retains roots for attestation", async () => {
    const { backend } = nativeDesk();
    const { elements } = await backend.queryElements({ role: "text" });
    expect(elements.map(x => [x.name, x.labelObservation])).toEqual([
      ["", { kind: "available", labels: ["Total paid"] }],
      ["", { kind: "available", labels: ["Receipt number"] }],
    ]);
    expect((await backend.queryElements({ name: "Receipt number" })).elements).toEqual([]);
    for (const element of elements) expect(await backend.attestElement({ id: element.id })).toEqual({ element });
    await backend.close();
  });
  it("does not register relation targets or read labels during metadata-only discovery", async () => {
    const { backend, calls } = nativeDesk();
    await backend.queryElements({ role: "text" });
    expect(await backend.attestElement({ id: deriveId("text", root.busName, "/label-first") })).toMatchObject({ refusalClass: "UnknownElement" });
    calls.length = 0;
    const discovery = await backend.discoverElements({ application: "Synthetic form" });
    expect(JSON.stringify(discovery)).not.toContain("labelObservation");
    expect(calls.some(x => x.member === "GetRelationSet" || x.path.startsWith("/label"))).toBe(false);
    await backend.close();
  });
});

describe("explicit native labels", () => {
  it("reads the named relation, not sibling order, and preserves verbatim text", async () => {
    const { reader, calls } = synthetic(x => x.body?.[1] === "Name" ? ["  Å Receipt\n"] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual({ kind: "available", labels: ["  Å Receipt\n"] });
    expect(calls.some(x => x.member === "GetChildren" || x.member === "GetText")).toBe(false);
    expect(calls.findIndex(x => x.body?.[1] === "Parent")).toBeLessThan(calls.findIndex(x => x.body?.[1] === "Name"));
  });
  it("distinguishes successful empty from missing support and arbitrary errors", async () => {
    expect(await synthetic(x => x.member === "GetRelationSet" ? [[]] : undefined).reader.read(field, root, { waited: 0 })).toEqual({ kind: "available", labels: [] });
    for (const [message, reason] of [["org.freedesktop.DBus.Error.UnknownMethod", "not-exposed"], ["NoReply", "unreadable"]]) {
      const { reader } = synthetic(() => { throw new Error(message); });
      expect(await reader.read(field, root, { waited: 0 })).toEqual(unavailable(reason!));
    }
  });
  it("deduplicates references, not text from distinct labels", async () => {
    const { reader, calls } = synthetic(x => x.member === "GetRelationSet" ? [[[2, [pair("/one"), pair("/one"), pair("/two")]]]] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual({ kind: "available", labels: ["Receipt number", "Receipt number"] });
    expect(calls.filter(x => x.body?.[1] === "Name")).toHaveLength(2);
  });
  it("keeps labels in the order the platform related them, not sorted", async () => {
    const { reader } = synthetic(x => x.member === "GetRelationSet"
      ? [[[2, [pair("/zulu"), pair("/alpha")]]]]
      : x.body?.[1] === "Name" ? [x.path === "/zulu" ? "Zulu total" : "Alpha amount"] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual({ kind: "available", labels: ["Zulu total", "Alpha amount"] });
  });
  it.each([null, {}, [2], [[2, null]], [[2, [[1, "/bad"]]]]])("refuses malformed synthetic relations %j", async relations => {
    const { reader } = synthetic(x => x.member === "GetRelationSet" ? [relations] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual(unavailable("unreadable"));
  });
  it.each(["", " \t\n"])("refuses blank target %j", async name => {
    const { reader } = synthetic(x => x.body?.[1] === "Name" ? [name] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual(unavailable("unreadable"));
  });
  it("never reads cross-bus target properties", async () => {
    const { reader, calls } = synthetic(x => x.member === "GetRelationSet" ? [[[2, [pair("/label", ":1.2")]]]] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual(unavailable("out-of-scope"));
    expect(calls).toHaveLength(1);
  });
  it("requires a root witness before scheduling anything", async () => {
    const { reader, calls } = synthetic();
    expect(await reader.read(field, undefined, { waited: 0 })).toEqual(unavailable("out-of-scope"));
    expect(calls).toHaveLength(0);
  });
  it.each(["/other", "/label", "/org/a11y/atspi/null"])("refuses nonmatching or cyclic parent %s", async parent => {
    const { reader, calls } = synthetic(x => x.body?.[1] === "Parent" ? [pair(parent)] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual(unavailable("out-of-scope"));
    expect(calls.some(x => x.body?.[1] === "Name")).toBe(false);
  });
  it("bounds an acyclic parent chain to sixteen reads", async () => {
    let n = 0;
    const { reader, calls } = synthetic(x => x.body?.[1] === "Parent" ? [pair(`/p${++n}`)] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual(unavailable("out-of-scope"));
    expect(calls.filter(x => x.body?.[1] === "Parent")).toHaveLength(16);
  });
  it("accepts a root at exactly sixteen hops and wrapped native properties", async () => {
    let n = 0;
    const { reader } = synthetic(x => x.body?.[1] === "Parent" ? [["(so)", [pair(++n === 16 ? "/app" : `/p${n}`)]]] : x.body?.[1] === "Name" ? [["s", ["Exact"]]] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual({ kind: "available", labels: ["Exact"] });
  });
  it("never reads protected target names", async () => {
    const { reader, calls } = synthetic(x => x.member === "GetRoleName" ? ["password text"] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual(unavailable("out-of-scope"));
    expect(calls.some(x => x.body?.[1] === "Name")).toBe(false);
  });
  it("refuses defunct targets and discards partial evidence", async () => {
    const { reader } = synthetic(x => x.member === "GetRelationSet" ? [[[2, [pair("/one"), pair("/two")]]]] : x.path === "/two" && x.member === "GetState" ? [[1 << 6, 0]] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual(unavailable("unreadable"));
  });
  it("enforces eight targets before reading any names", async () => {
    const { reader, calls } = synthetic(x => x.member === "GetRelationSet" ? [[[2, Array.from({ length: 9 }, (_, i) => pair(`/label${i}`))]]] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual(unavailable("limit-exceeded"));
    expect(calls).toHaveLength(1);
  });
  it.each([1024, 1025])("counts Unicode code points at per-label bound %i", async size => {
    const name = "😀".repeat(size);
    const { reader } = synthetic(x => x.body?.[1] === "Name" ? [name] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual(size === 1024 ? { kind: "available", labels: [name] } : unavailable("limit-exceeded"));
  });
  it.each([4, 5])("bounds cumulative label text for %i targets", async count => {
    const name = "x".repeat(1024);
    const { reader } = synthetic(x => x.member === "GetRelationSet" ? [[[2, Array.from({ length: count }, (_, i) => pair(`/label${i}`))]]] : x.body?.[1] === "Name" ? [name] : undefined);
    expect(await reader.read(field, root, { waited: 0 })).toEqual(count === 4 ? { kind: "available", labels: Array(count).fill(name) } : unavailable("limit-exceeded"));
  });
  it("propagates unrecorded exchanges rather than inventing empty evidence", async () => {
    const missing = new UnrecordedExchangeError("missing exchange");
    const { reader } = synthetic(() => { throw missing; });
    await expect(reader.read(field, root, { waited: 0 })).rejects.toBe(missing);
  });
  it.each([true, false])("captures synthetic delayed replies with close-before-settlement=%s", async closeBefore => {
    const directory = mkdtempSync(join(fixturesDir(), "synthetic-label-timing-"));
    const { channel } = synthetic(() => [[]]);
    let settle!: (reply: unknown[]) => void;
    let pending!: Promise<unknown[]>;
    channel.call = () => pending = new Promise(resolve => { settle = resolve; });
    const captured = captureChannel(channel, basename(directory));
    const reader = new LabelReader(captured);
    try {
      const result = await reader.read(field, root, { waited: 0 });
      expect(result).toEqual(unavailable("unreadable"));
      if (closeBefore) {
        reader.close();
        await captured.close();
      }
      settle([[]]);
      await pending;
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!closeBefore) await captured.close();
      const replay = new LabelReader(replayChannel(basename(directory)));
      if (closeBefore) {
        await expect(replay.read(field, root, { waited: 0 })).rejects.toBeInstanceOf(UnrecordedExchangeError);
        expect(await reader.read(field, root, { waited: 0 })).toEqual(unavailable("unreadable"));
      } else {
        expect(await replay.read(field, root, { waited: 0 })).toEqual({ kind: "available", labels: [] });
      }
      expect(result).toEqual(unavailable("unreadable"));
      replay.close();
    } finally {
      reader.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("does not schedule when operation waiting is exhausted or the backend closes", async () => {
    const { reader, calls } = synthetic();
    expect(await reader.read(field, root, { waited: 500 })).toEqual(unavailable("limit-exceeded"));
    reader.close();
    expect(await reader.read(field, root, { waited: 0 })).toEqual(unavailable("unreadable"));
    expect(calls).toHaveLength(0);
  });
  it("shares the operation wait budget across 100 sequential fields", async () => {
    const { channel } = synthetic();
    let calls = 0;
    channel.call = async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 180));
      return [[]];
    };
    const reader = new LabelReader(channel);
    const budget = { waited: 0 };
    const started = performance.now();
    const answers = [];
    for (let i = 0; i < 100; i++) answers.push(await reader.read(field, root, budget));
    expect(performance.now() - started).toBeLessThan(600);
    expect(calls).toBe(3);
    expect(answers.slice(0, 2)).toEqual(Array(2).fill({ kind: "available", labels: [] }));
    expect(answers[2]).toEqual(unavailable("limit-exceeded"));
    expect(answers.slice(3).every(x => x.kind === "unavailable")).toBe(true);
    reader.close();
    await new Promise(resolve => setTimeout(resolve, 190));
  });
  it("keeps one hung call across 100 fields and concurrent operations, then recovers without changing old answers", async () => {
    let settle!: (value: unknown[]) => void;
    const { channel } = synthetic(x => x.member === "GetRelationSet" ? [[]] : undefined);
    const original = channel.call;
    let count = 0;
    channel.call = x => ++count === 1 ? new Promise(resolve => { settle = resolve; }) : original(x);
    const reader = new LabelReader(channel);
    const started = performance.now();
    const first = reader.read(field, root, { waited: 0 });
    const other = await Promise.all(Array.from({ length: 99 }, () => reader.read(field, root, { waited: 0 })));
    const result = await first;
    expect(performance.now() - started).toBeLessThan(600);
    expect(result).toEqual(unavailable("unreadable"));
    expect(other.every(x => x.kind === "unavailable" && x.reason === "unreadable")).toBe(true);
    expect(count).toBe(1);
    settle([[]]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await reader.read(field, root, { waited: 0 })).toEqual({ kind: "available", labels: [] });
    expect(result).toEqual(unavailable("unreadable"));
  });
});
