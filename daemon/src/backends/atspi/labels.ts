import { CallDeadlineError } from "../../backend.js";
import { performance } from "node:perf_hooks";
import type { LabelObservation as Observation, CompositeObservation } from "@mastra-cc/protocol-types";
import type { Channel, Exchange } from "./channel.js";
import { UnrecordedExchangeError } from "./channel.js";

interface NativeRef { busName: string; objectPath: string }
export interface LabelBudget { waited: number }
type Reason = Extract<Observation, { kind: "unavailable" }>["reason"];
const ACCESSIBLE = "org.a11y.atspi.Accessible";
const NULL_PATH = "/org/a11y/atspi/null";
class Unavailable extends Error {
  constructor(readonly reason: Reason) { super(reason); }
}
class CompositeUnavailable extends Error {
  constructor(readonly reason: Extract<CompositeObservation, { kind: "unavailable" }>["reason"]) { super(reason); }
}
function reference(raw: unknown): NativeRef {
  if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== "string" || !raw[0] || typeof raw[1] !== "string" || !raw[1].startsWith("/") || raw[1] === NULL_PATH) throw new Unavailable("unreadable");
  return { busName: raw[0], objectPath: raw[1] };
}
function unwrap(raw: unknown): unknown {
  return Array.isArray(raw) && Array.isArray(raw[1]) ? raw[1][0] : raw;
}
function key(ref: NativeRef): string { return `${ref.busName}\0${ref.objectPath}`; }

// This slot belongs to the backend, not a query. Timeouts abandon only the
// waiter: a hung native call must still occupy the slot until it settles.
export class LabelReader {
  private busy = false;
  private closed = false;
  constructor(private readonly channel: Channel) {}
  close(): void { this.closed = true; }

  private context(root: NativeRef | undefined, budget: LabelBudget, started: number) {
    const call = async (ref: NativeRef, member: string, property?: string): Promise<unknown> => {
      if (budget.waited >= 500) throw new Unavailable("limit-exceeded");
      const operationRemaining = 500 - budget.waited;
      const elementRemaining = 250 - (performance.now() - started);
      const timeoutReason = operationRemaining <= elementRemaining ? "limit-exceeded" : "unreadable";
      const left = Math.min(operationRemaining, elementRemaining);
      if (left <= 0) throw new Unavailable(timeoutReason);
      if (this.closed || this.busy) throw new Unavailable("unreadable");
      const exchange: Exchange = { destination: ref.busName, path: ref.objectPath, iface: ACCESSIBLE, member };
      if (property !== undefined) Object.assign(exchange, { iface: "org.freedesktop.DBus.Properties", signature: "ss", body: [ACCESSIBLE, property] });
      this.busy = true;
      const before = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const pending = Promise.resolve().then(() => {
          if (this.closed) throw new Unavailable("unreadable");
          return this.channel.call(exchange);
        }).finally(() => { this.busy = false; });
        const reply = await Promise.race([
          pending,
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Unavailable(timeoutReason)), left); }),
        ]);
        if (performance.now() - before >= left) throw new Unavailable(timeoutReason);
        if (reply.length !== 1) throw new Unavailable("unreadable");
        return property === undefined ? reply[0] : unwrap(reply[0]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        budget.waited += performance.now() - before;
      }
    };
    const owned = async (target: NativeRef) => {
      if (root === undefined || target.busName !== root.busName) throw new Unavailable("out-of-scope");
      const seen = new Set<string>();
      let here = target;
      for (let hops = 0; hops <= 16; hops += 1) {
        if (key(here) === key(root)) return [...seen, key(root)];
        if (hops === 16 || here.busName !== root.busName || seen.has(key(here))) throw new Unavailable("out-of-scope");
        seen.add(key(here));
        let raw: unknown;
        try { raw = await call(here, "Get", "Parent"); }
        catch (error) {
          if (error instanceof UnrecordedExchangeError || error instanceof CallDeadlineError || error instanceof Unavailable) throw error;
          throw new Unavailable("out-of-scope");
        }
        try { here = reference(raw); } catch { throw new Unavailable("out-of-scope"); }
      }
    };
    return { call, owned };
  }

  async readEnriched(field: NativeRef, root: NativeRef | undefined, budget: LabelBudget) {
    const started = performance.now();
    const labelObservation = await this.read(field, root, budget, started);
    const compositeObservation = await this.readComposite(field, root, budget, started);
    return { labelObservation, compositeObservation };
  }

  private async readComposite(field: NativeRef, root: NativeRef | undefined, budget: LabelBudget, started: number): Promise<CompositeObservation> {
    const fail = (reason: Extract<CompositeObservation, { kind: "unavailable" }>["reason"]): never => { throw new CompositeUnavailable(reason); };
    const { call, owned } = this.context(root, budget, started);
    try {
      if (root === undefined || field.busName !== root.busName) return fail("out-of-scope");
      const observe = async () => {
        const trace: unknown[] = [];
        const read = async (ref: NativeRef, member: string, property?: string) => {
          if (ref.busName !== root.busName) return fail("out-of-scope");
          const result = await call(ref, member, property);
          trace.push([key(ref), member, property, result]);
          return result;
        };
        const ownership = async (ref: NativeRef) => {
          trace.push([key(ref), "ownership", await owned(ref)]);
          const owner = reference(await read(ref, "GetApplication"));
          if (key(owner) !== key(root)) return fail("out-of-scope");
        };
        const properties = async (ref: NativeRef) => {
          await ownership(ref);
          const role = await read(ref, "GetRoleName");
          if (typeof role !== "string" || !role) return fail("unreadable");
          if (role === "password text") return fail("out-of-scope");
          const states = await read(ref, "GetState");
          if (!Array.isArray(states) || states.length !== 2 || !states.every(Number.isInteger)) return fail("unreadable");
          if ((states[0] & ((1 << 6) | (1 << 27))) !== 0) return fail("unreadable");
          const interfaces = await read(ref, "GetInterfaces");
          if (!Array.isArray(interfaces) || !interfaces.every(i => typeof i === "string")) return fail("unreadable");
          return { role, editable: interfaces.includes("org.a11y.atspi.EditableText"), text: interfaces.includes("org.a11y.atspi.Text") };
        };
        const target = await properties(field);
        if (target.role !== "text" || !target.editable || !target.text) return fail("not-exposed");
        const descendants = await read(field, "GetChildren");
        if (!Array.isArray(descendants)) return fail("unreadable");
        if (descendants.length !== 0) return fail("not-exposed");
        const parentRaw = await read(field, "Get", "Parent");
        if (Array.isArray(parentRaw) && parentRaw[1] === NULL_PATH) return fail("not-exposed");
        const parent = reference(parentRaw);
        const parentProperties = await properties(parent);
        if (parentProperties.role !== "combo box") return fail("not-exposed");
        const rawChildren = await read(parent, "GetChildren");
        if (!Array.isArray(rawChildren)) return fail("unreadable");
        if (rawChildren.length !== 2) return fail("not-exposed");
        const children = rawChildren.map(reference);
        if (key(children[0]!) === key(children[1]!)) return fail("unreadable");
        if (!children.some(c => key(c) === key(field))) return fail("unreadable");
        const sibling = children.find(c => key(c) !== key(field))!;
        const siblingProperties = await properties(sibling);
        if (siblingProperties.editable) return fail("ambiguous");
        if (siblingProperties.role !== "menu") return fail("not-exposed");
        for (const child of children) {
          if (key(reference(await read(child, "Get", "Parent"))) !== key(parent)) return fail("unreadable");
        }
        const relations = await read(parent, "GetRelationSet");
        if (!Array.isArray(relations)) return fail("unreadable");
        const labels: NativeRef[] = [];
        for (const relation of relations) {
          if (!Array.isArray(relation) || relation.length !== 2 || !Number.isInteger(relation[0]) || !Array.isArray(relation[1])) return fail("unreadable");
          if (relation[0] !== 2) continue;
          for (const raw of relation[1]) {
            labels.push(reference(raw));
            if (labels.length > 1) return fail("ambiguous");
          }
        }
        if (labels.length === 0) return fail("not-exposed");
        const label = labels[0]!;
        if (new Set([field, parent, sibling, label].map(key)).size !== 4) return fail("unreadable");
        const labelProperties = await properties(label);
        if (labelProperties.role !== "label") return fail("not-exposed");
        const name = await read(label, "Get", "Name");
        if (typeof name !== "string" || name.trim() === "") return fail("unreadable");
        if (name.length > 2048 || [...name].length > 1024) return fail("limit-exceeded");
        return { name, trace: JSON.stringify(trace) };
      };
      const before = await observe();
      const after = await observe().catch(error => {
        if (error instanceof UnrecordedExchangeError || error instanceof CallDeadlineError) throw error;
        if ((error instanceof Unavailable || error instanceof CompositeUnavailable) && error.reason === "limit-exceeded") throw error;
        return fail("unreadable");
      });
      if (before.trace !== after.trace) return fail("unreadable");
      if (budget.waited >= 500) return fail("limit-exceeded");
      if (this.closed || performance.now() - started >= 250) return fail("unreadable");
      return { kind: "available", provenance: "immediate-combo-parent", parentRole: "combo box", relation: "labelled-by", label: after.name, immediateChildCount: 2, editableChildCount: 1, siblingRole: "menu" };
    } catch (error) {
      if (error instanceof UnrecordedExchangeError || error instanceof CallDeadlineError) throw error;
      return { kind: "unavailable", reason: error instanceof CompositeUnavailable || error instanceof Unavailable ? error.reason : "unreadable" };
    }
  }

  async read(field: NativeRef, root: NativeRef | undefined, budget: LabelBudget, started = performance.now()): Promise<Observation> {
    const { call, owned } = this.context(root, budget, started);
    try {
      if (budget.waited >= 500) throw new Unavailable("limit-exceeded");
      if (root === undefined || field.busName !== root.busName) throw new Unavailable("out-of-scope");
      let relations: unknown;
      try { relations = await call(field, "GetRelationSet"); }
      catch (error) {
        if (error instanceof UnrecordedExchangeError || error instanceof CallDeadlineError) throw error;
        if (error instanceof Error && /org\.freedesktop\.DBus\.Error\.(UnknownMethod|UnknownInterface)(?:["\s:]|$)/.test(error.message)) throw new Unavailable("not-exposed");
        throw error;
      }
      if (!Array.isArray(relations)) throw new Unavailable("unreadable");
      const targets = new Map<string, NativeRef>();
      for (const relation of relations) {
        if (!Array.isArray(relation) || relation.length !== 2 || !Number.isInteger(relation[0]) || !Array.isArray(relation[1])) throw new Unavailable("unreadable");
        if (relation[0] !== 2) continue;
        for (const raw of relation[1]) {
          const target = reference(raw);
          targets.set(key(target), target);
          if (targets.size > 8) throw new Unavailable("limit-exceeded");
        }
      }
      const labels: string[] = [];
      let total = 0;
      for (const target of targets.values()) {
        await owned(target);
        const role = await call(target, "GetRoleName");
        if (typeof role !== "string" || !role) throw new Unavailable("unreadable");
        if (role === "password text") throw new Unavailable("out-of-scope");
        const states = await call(target, "GetState");
        if (!Array.isArray(states) || states.length !== 2 || !states.every(Number.isInteger)) throw new Unavailable("unreadable");
        // AT-SPI STATE_DEFUNCT (6) and STATE_STALE (27) cannot supply fresh evidence.
        if ((states[0] & ((1 << 6) | (1 << 27))) !== 0) throw new Unavailable("unreadable");
        const name = await call(target, "Get", "Name");
        if (typeof name !== "string" || name.trim() === "") throw new Unavailable("unreadable");
        if (name.length > 2048) throw new Unavailable("limit-exceeded");
        const length = [...name].length;
        total += length;
        if (length > 1024 || total > 4096) throw new Unavailable("limit-exceeded");
        labels.push(name);
      }
      if (budget.waited >= 500) throw new Unavailable("limit-exceeded");
      if (performance.now() - started >= 250) throw new Unavailable("unreadable");
      return { kind: "available", labels };
    } catch (error) {
      if (error instanceof UnrecordedExchangeError || error instanceof CallDeadlineError) throw error;
      return { kind: "unavailable", reason: error instanceof Unavailable ? error.reason : "unreadable" };
    }
  }
}
