import { readFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AttestationFailedError,
  type Backend,
  type BackendChange,
  EffectUnsupportedError,
  MagnitudeOutOfRangeError,
  OperationNotExposedError,
  RecordingNotPerformableError,
  TextOffsetOutOfRangeError,
  UnknownSubscriptionError,
  UnperformableElementError,
  UnpublishedActionError,
  UnwatchableElementError,
  WriteNotObservedError,
  mintSubscriptionId,
} from "../backend.js";
import {
  isRefusalClass,
  leakedTerms,
  openAuditLog,
  REFUSAL_CLASSES,
  useAuditLog,
  type AuditEntry,
} from "../audit.js";
import type { Channel, Exchange } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { registry } from "../backends/registry.js";
import { handleRequest, SubscriptionBook, type LaunchContext } from "../server.js";
import { OwnershipTable } from "../launch/table.js";
import { DEFANGED_CATALOG } from "./support/defanged-catalog.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// THE RECEIPT NAMES WHAT WAS TOUCHED, AND NOTHING ELSE (ADR-0026, ADR-0042).
//
// Every test here drives the DAEMON - handleRequest, the real dispatch, over a
// real backend - and then reads the file back off the disk. None of them call
// the audit module directly, and that is the whole design of this suite: a test
// that calls the writer straight proves the writer works, and proves nothing
// about whether the daemon ever calls it. The mutations in Phase 2 delete the
// CALL SITES, not the writer, and a suite pointed at the writer would stay
// green through every one of them.
//
// Two worlds are used, for two different reasons. The recorded gtk-dialog tape
// is a real captured tree and answers reads honestly, which is what the read
// receipt needs. It refuses every effect ("a recording cannot be acted upon"),
// so the performed-effect cases stage a Channel in the shape
// effects-are-observed.test.ts established: a small measured-shaped tree that
// answers only the members the reader uses, and a platform that actually obeys.

const ENABLED_BIT = 8;
const VISIBLE_BIT = 30;
const SHOWING_BIT = 25;

const ACTION_IFACE = "org.a11y.atspi.Action";
const COMPONENT_IFACE = "org.a11y.atspi.Component";

const BUS = ":1.subject";
const APP = "/app";
const SUBJECT = "/subject";

// The staged element's name is the user's own text, deliberately. It is the
// exact thing ADR-0026 says an access record must not hold, so every assertion
// below about content staying off the disk has something real to look for.
const SUBJECT_NAME = "Reply to Dave about the unpaid invoice";
const APPLICATION_NAME = "subject-app";
const ACTION_NAME = "click";

interface Staged {
  performs: boolean;
}

function stage(overrides: Partial<Staged> = {}): Channel {
  const staged: Staged = { performs: true, ...overrides };
  const bits = (1 << ENABLED_BIT) | (1 << VISIBLE_BIT) | (1 << SHOWING_BIT);

  return {
    async call(exchange: Exchange): Promise<unknown[]> {
      if (exchange.destination === "org.a11y.atspi.Registry" && exchange.member === "GetChildren") {
        return [[[BUS, APP]]];
      }
      const isApp = exchange.path === APP;
      switch (exchange.member) {
        case "GetChildren":
          return [isApp ? [[BUS, SUBJECT]] : []];
        case "GetRoleName":
          return [isApp ? "application" : "push button"];
        case "GetState":
          return [[bits, 0]];
        case "GetInterfaces":
          return [isApp ? [] : [ACTION_IFACE, COMPONENT_IFACE]];
        case "GetActions":
          return [isApp ? [] : [[ACTION_NAME, "", ""]]];
        case "GetNActions":
          return [isApp ? 0 : 1];
        case "GetName":
          return [ACTION_NAME];
        case "DoAction":
          return [staged.performs];
        case "Get": {
          const [, property] = exchange.body as [string, string];
          if (property === "Name") return [isApp ? APPLICATION_NAME : SUBJECT_NAME];
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

// The one place a test says which classes this session may exercise. Everything
// below runs with all three effect classes held, so a refusal that shows up in
// a receipt is the one the test provoked and never the scope gate by accident.
function context(overrides: Partial<LaunchContext> = {}): LaunchContext {
  return {
    permits: new Set(),
    catalog: DEFANGED_CATALOG,
    table: new OwnershipTable(),
    allows: new Set(["edit", "activate", "submit"]),
    ...overrides,
  };
}

let temporary: string | undefined;

function auditing(): string {
  temporary = mkdtempSync(join(tmpdir(), "mastra-cc-audit-"));
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

async function call(method: string, params: unknown, backend: Parameters<typeof handleRequest>[1], launch = context()) {
  const response = await handleRequest({ type: "request", id: 1, method, params }, backend, launch);
  return response as { result?: Record<string, unknown>; refusal?: string };
}

// A watch has to be driven through the real dispatch like everything else, and
// the recorded tape cannot watch ("this channel does not watch"), so the
// backend that answers a subscription is staged in the shape
// subscription-lifetime.test.ts established.
const WATCHED = "el-0123456789ab";

function watchable() {
  const sinks = new Map<string, (change: BackendChange) => void>();
  const backend: Backend = {
    ...observeOnlyEffects,
    name: "watchable",
    queryElements: async () => ({ elements: [] }),
    attestElement: async () => ({}),
    readElementContent: async () => ({ content: { kind: "unavailable", reason: "not-exposed" } }),
    subscribeElement: async (id, sink) => {
      if (id !== WATCHED) throw new UnwatchableElementError(id);
      const subscriptionId = mintSubscriptionId();
      sinks.set(subscriptionId, sink);
      return {
        subscriptionId,
        application: "test-app",
        close: async () => {
          sinks.delete(subscriptionId);
        },
      };
    },
    applicationOfElement: () => undefined,
    unsubscribeElement: async (subscriptionId) => {
      if (!sinks.has(subscriptionId)) throw new UnknownSubscriptionError(subscriptionId);
      sinks.delete(subscriptionId);
    },
    close: async () => undefined,
  };
  return { backend };
}

async function watch(method: string, params: unknown, backend: Backend, book: SubscriptionBook) {
  const response = await handleRequest({ type: "request", id: 1, method, params }, backend, context(), book);
  return response as { result?: Record<string, unknown>; refusal?: string };
}

async function stagedSubject(channel: Channel): Promise<{ backend: AtspiBackend; id: string }> {
  const backend = new AtspiBackend(channel, "all");
  const { elements } = await backend.queryElements({});
  const found = elements.find((element) => element.role === "button");
  expect(found, "the staged tree published no subject element").toBeDefined();
  return { backend, id: found!.id };
}

// THE FIXTURE'S OWN WORDS, read out of the tape rather than typed here. A
// re-capture brings its own vocabulary with it and this check never decays into
// a search for terms the recording stopped saying. Names and action words only:
// the application name and the daemon's role vocabulary are recorded ON
// PURPOSE, and a detector handed those would report the entry shape working as
// designed as a leak.
function fixtureVocabulary(): string[] {
  const tape = JSON.parse(readFileSync(join(process.cwd(), "fixtures/gtk-dialog/tape.json"), "utf8")) as {
    exchanges: { member: string; body?: unknown[]; reply?: unknown }[];
  };
  const words = new Set<string>();
  for (const exchange of tape.exchanges) {
    const reply = exchange.reply as unknown[] | undefined;
    if (reply === undefined) continue;
    if (exchange.member === "Get" && (exchange.body as string[] | undefined)?.[1] === "Name") {
      if (typeof reply[0] === "string") words.add(reply[0]);
    }
    if (exchange.member === "GetName" && typeof reply[0] === "string") words.add(reply[0]);
    if (exchange.member === "GetActions" && Array.isArray(reply[0])) {
      for (const triple of reply[0] as unknown[][]) for (const part of triple) if (typeof part === "string") words.add(part);
    }
  }
  // The application's own name IS recorded, by design: an access record that
  // could not say which application was touched would not be an access record.
  words.delete("yad");
  words.delete("");
  const vocabulary = [...words];
  // A vocabulary that came back empty would make every check against it pass
  // for ever, and it would look exactly like a record that leaks nothing.
  expect(vocabulary.length, "the tape yielded no vocabulary - the extraction, not the record, is what broke").toBeGreaterThan(3);
  expect(vocabulary, "the tape's own words are what this looks for").toContain("OK");
  return vocabulary;
}

describe("an effect writes exactly one receipt, and it names the element by identity", () => {
  it("1: a performed effect writes one entry naming the element the daemon answered", async () => {
    const path = auditing();
    const { backend, id } = await stagedSubject(stage());

    const answer = await call("activateElement", { id, action: ACTION_NAME }, backend);
    await backend.close();

    expect(answer.result?.refusal, "the staged platform obeys; this should have performed").toBeUndefined();
    const written = entries(path);
    expect(written).toHaveLength(1);
    expect(written[0]!.element).toEqual([{ id, role: "button" }]);
    expect(written[0]!.outcome).toBe("performed");
    expect(written[0]!.scope).toBe("activate");
  });

  it("1b: an effect that FAILED is recorded as an attempt, not omitted as untidy", async () => {
    const path = auditing();
    // A platform that answers the walk and then breaks on the effect itself.
    // What comes back is not a refusal from the seam - it is an error nobody
    // classified - and the caller gets the opaque backstop. An access record
    // that keeps only the tidy cases is a record of the tidy cases.
    const channel = stage();
    const { backend, id } = await stagedSubject(channel);
    const broken = {
      ...channel,
      async call(exchange: Parameters<Channel["call"]>[0]) {
        if (exchange.member === "DoAction") throw new Error("the bus went away mid-effect");
        return channel.call(exchange);
      },
    };
    const failing = new AtspiBackend(broken, "all");
    await failing.queryElements({});

    const answer = await call("activateElement", { id, action: ACTION_NAME }, failing);
    await failing.close();
    await backend.close();

    // The backstop constant, at the top of the response rather than inside a
    // result: an unclassified throw never became an answer.
    expect(answer.refusal, "an unclassified throw reaches the caller as the backstop").toBeDefined();
    const written = entries(path);
    expect(written).toHaveLength(1);
    expect(written[0]!.outcome).toBe("failed");
    expect(written[0]!.element).toEqual([{ id }]);
    expect(written[0]!.scope).toBe("activate");
    // The thrown sentence is the daemon's own internal noise and belongs to
    // neither the caller nor the disk.
    expect(readFileSync(path, "utf8")).not.toContain("the bus went away");
  });

  it("2a: the entry carries exactly seven fields - the set is frozen, not merely free of a name key", async () => {
    const path = auditing();
    const { backend, id } = await stagedSubject(stage());
    await call("activateElement", { id, action: ACTION_NAME }, backend);
    await backend.close();

    // A differing-set assertion rather than "no name key": the second kind
    // passes forever while a `text` field creeps in beside it.
    const keys = Object.keys(entries(path)[0]!).sort();
    expect(keys).toEqual(["application", "at", "attestation", "cause", "element", "outcome", "scope"]);
  });

  it("2b: no word the tree said about itself reaches the record", async () => {
    const path = auditing();
    const { backend, id } = await stagedSubject(stage());
    await call("activateElement", { id, action: ACTION_NAME }, backend);
    await backend.close();

    const record = readFileSync(path, "utf8");
    // The staged tree's own vocabulary, on the same terms fixtureVocabulary()
    // uses for the tape: the element's name and the verb it publishes.
    expect(leakedTerms(record, [SUBJECT_NAME, ACTION_NAME])).toEqual([]);
    // Non-vacuity: the detector finds a planted term, so an empty answer above
    // means it looked and found nothing rather than that it cannot look.
    expect(leakedTerms(`${record} ${SUBJECT_NAME}`, [SUBJECT_NAME])).toEqual([SUBJECT_NAME]);
  });

  it("3: a refused effect records the refusal's CLASS, and the refusal's sentence stays off the disk", async () => {
    const path = auditing();
    const { backend, id } = await stagedSubject(stage({ performs: false }));

    const answer = await call("activateElement", { id, action: ACTION_NAME }, backend);
    await backend.close();

    // The platform declined, so the seam refuses in its own words - and those
    // words quote the element's name, which is exactly why they do not travel.
    expect(answer.result?.refusal).toContain("declined");
    const written = entries(path);
    expect(written).toHaveLength(1);
    expect(written[0]!.outcome).toBe("refused:WriteNotObservedError");
    expect(readFileSync(path, "utf8")).not.toContain(answer.result!.refusal as string);
    expect(leakedTerms(readFileSync(path, "utf8"), [SUBJECT_NAME])).toEqual([]);
  });

  it("4: an effect that could name no application is recorded as unattributed, not guessed at", async () => {
    const path = auditing();
    const backend = registry.replay({ visibility: new Set(["yad"]) });

    // An id this daemon never answered: the backend can name no application for
    // it, so the verb names nothing and the attribution machinery's honest
    // third answer is what lands on the disk (ADR-0039).
    await call("activateElement", { id: "el-000000000000", action: ACTION_NAME }, backend);
    await backend.close();

    const written = entries(path);
    expect(written).toHaveLength(1);
    expect(written[0]!.application).toBeNull();
    expect(written[0]!.cause.attribution).toBe("unattributed");
    expect(written[0]!.cause.causeId).toBeUndefined();
  });
});

describe("the receipt is kept only when one was asked for, and never at the cost of the effect", () => {
  it("5: a daemon nobody asked to keep a receipt writes no file at all", async () => {
    temporary = mkdtempSync(join(tmpdir(), "mastra-cc-audit-"));
    const path = join(temporary, "audit.jsonl");
    useAuditLog(undefined);

    const { backend, id } = await stagedSubject(stage());
    const answer = await call("activateElement", { id, action: ACTION_NAME }, backend);
    await backend.close();

    expect(answer.result?.element, "the effect still happens").toBeDefined();
    expect(existsSync(path)).toBe(false);
  });

  it("6: a sink that cannot be written to reports the lost entry, and the effect still completes", async () => {
    // /dev/null is a file, so neither the directory nor the append can be made.
    const path = "/dev/null/nowhere/audit.jsonl";
    useAuditLog(openAuditLog(path));
    const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { backend, id } = await stagedSubject(stage());
    const answer = await call("activateElement", { id, action: ACTION_NAME }, backend);
    await backend.close();

    expect(answer.result?.element, "bookkeeping never costs the effect (ADR-0022)").toBeDefined();
    expect(reported).toHaveBeenCalledTimes(1);
    const said = reported.mock.calls[0]![0] as string;
    expect(said).toContain("audit entry NOT WRITTEN");
    // The report names the entry by identity, on the same terms as the entry.
    expect(said).toContain(id);
    expect(said).not.toContain(SUBJECT_NAME);
    reported.mockRestore();
  });
});

describe("the launch and the read keep receipts of their own", () => {
  it("7: a launch writes a receipt - the one effect no element verb passes through", async () => {
    const path = auditing();
    const backend = registry.replay({ visibility: new Set(["yad"]) });

    const answer = await call("openApplication", { name: "yad" }, backend, context({ permits: new Set() }));
    await backend.close();

    expect(answer.result?.refusal, "no permit, so the launch gate refuses").toBeDefined();
    const written = entries(path);
    expect(written).toHaveLength(1);
    expect(written[0]!.scope).toBe("launch");
    expect(written[0]!.application).toBe("yad");
    expect(written[0]!.outcome).toBe("refused:LaunchUnavailable");
    expect(written[0]!.element).toEqual([]);
  });

  // The launch route's own FAILED path. performEffect has one and the observe
  // point has one; without this the launch was the single route where a throw
  // nobody classified reached the caller as the opaque backstop and left the
  // record silent about the attempt entirely.
  it("7b: a launch that throws unclassified is recorded as an attempt", async () => {
    const path = auditing();
    const backend = registry.replay({ visibility: new Set(["yad"]) });
    const table = new OwnershipTable();
    // The table is what openApplication consults past the permit gate; a table
    // that throws stands in for any internal failure the route does not catch.
    vi.spyOn(table, "ownsName").mockImplementation(() => {
      throw new Error("the ownership table went away mid-launch");
    });

    const answer = await call("openApplication", { name: "yad" }, backend, context({ permits: new Set(["yad"]), table }));
    await backend.close();

    // The caller gets the opaque backstop, as it always has - the throw stays
    // on this side of the wire.
    expect(answer.refusal).toContain("the desktop could not be read");
    expect(answer.refusal).not.toContain("went away mid-launch");

    const written = entries(path);
    expect(written).toHaveLength(1);
    expect(written[0]!.scope).toBe("launch");
    expect(written[0]!.outcome).toBe("failed");
    expect(written[0]!.application).toBe("yad");
    expect(written[0]!.element).toEqual([]);
    // The thrown sentence is the daemon's own internal noise. It goes to the
    // caller as the opaque backstop and it does not go to the disk.
    expect(readFileSync(path, "utf8")).not.toContain("went away mid-launch");
  });

  it("8: a read writes exactly one entry naming every element it answered", async () => {
    const path = auditing();
    const backend = registry.replay({ visibility: new Set(["yad"]) });

    const answer = await call("queryElements", { name: "OK" }, backend);
    await backend.close();

    const answered = (answer.result?.elements ?? []) as { id: string; role: string }[];
    // The capture found a button and a label both named OK, and both replay.
    expect(answered.length).toBeGreaterThan(1);

    const written = entries(path);
    expect(written).toHaveLength(1);
    expect(written[0]!.scope).toBe("observe");
    expect(written[0]!.outcome).toBe("read");
    expect(written[0]!.application).toBeNull();
    expect(written[0]!.element).toEqual(answered.map((element) => ({ id: element.id, role: element.role })));
    // The read receipt is the entry exit box 5 is about, and it is also the
    // artifact Segment 2 asserts against across a process boundary. Whatever
    // the tape says the query answers, the record says the same and no more.
    const record = readFileSync(path, "utf8");
    const vocabulary = fixtureVocabulary();
    expect(leakedTerms(record, vocabulary)).toEqual([]);
    // The detector looked. A record with one of the tape's words spliced in is
    // found, so the empty answer above is a finding and not a broken instrument.
    expect(leakedTerms(`${record} ${vocabulary[0]}`, vocabulary)).toEqual([vocabulary[0]]);

    // THE LINE ITSELF, which Segment 2 asserts against across a process
    // boundary. Recorded here so that assertion has a literal to match rather
    // than a remembered phrasing - the tape answers TWO elements for "OK", a
    // label and a button, and a single-element assertion over there would be
    // the wrong one.
    //
    //   {"at":"...","application":null,"element":[{"id":"el-a174b78401c1","role":"label"},
    //    {"id":"el-47577e4569ef","role":"button"}],"scope":"observe",
    //    "cause":{"attribution":"external"},"attestation":null,"outcome":"read"}
    //
    // The ids are derived from the tape's own bus names and paths, so they are
    // stable across runs of this fixture; `at` is the only field that moves.
    expect(written[0]!.cause).toEqual({ attribution: "external" });
    expect(written[0]!.attestation).toBeNull();
    expect(answered.map((element) => element.id).sort()).toEqual(["el-47577e4569ef", "el-a174b78401c1"]);
  });

  // A WATCH IS A STANDING READ, and it is the one observe-class answer whose
  // result shape names no element: subscribe answers a subscription and
  // unsubscribe answers a boolean. Both therefore state their subject directly
  // (auditElement), and both are asserted here for the reason the plan gives -
  // an entry that still writes, still says `read`, and names NOTHING would look
  // exactly like a scored receipt while reporting nothing at all. That is the
  // failure mode this whole suite exists to refuse, one level down.
  it("8b: establishing a watch records the element the watch was established ON", async () => {
    const path = auditing();
    const world = watchable();
    const book = new SubscriptionBook(() => undefined);

    const answer = await watch("subscribeElement", { id: WATCHED, priority: "medium" }, world.backend, book);

    expect(answer.result?.refusal, "the staged backend accepts this watch").toBeUndefined();
    const written = entries(path);
    expect(written).toHaveLength(1);
    expect(written[0]!.scope).toBe("observe");
    expect(written[0]!.outcome).toBe("read");
    expect(written[0]!.element).toEqual([{ id: WATCHED }]);
    // The subscription id is the daemon's own minting and is not the access;
    // the element watched is. A receipt naming the id and not the element would
    // say a watch happened without saying on what.
    expect(JSON.stringify(written[0]!)).not.toContain(
      (answer.result?.subscription as { subscriptionId: string }).subscriptionId,
    );
  });

  it("8c: ending a watch records which element stopped being watched", async () => {
    const path = auditing();
    const world = watchable();
    const book = new SubscriptionBook(() => undefined);

    const opened = await watch("subscribeElement", { id: WATCHED, priority: "medium" }, world.backend, book);
    const subscriptionId = (opened.result?.subscription as { subscriptionId: string }).subscriptionId;
    const closed = await watch("unsubscribeElement", { subscriptionId }, world.backend, book);

    expect(closed.result?.ended, "the watch was open, so ending it succeeds").toBe(true);
    const written = entries(path);
    expect(written).toHaveLength(2);
    // Asked before the book forgets. Once `end` has run the book no longer
    // holds the element, so a receipt built afterwards could only name the
    // subscription - which is why the server reads it first.
    expect(written[1]!.element).toEqual([{ id: WATCHED }]);
    expect(written[1]!.scope).toBe("observe");
    expect(written[1]!.outcome).toBe("read");
  });
});

describe("the refusal vocabulary is closed", () => {
  it("9: every class the daemon records is in the set, and the set holds nothing else", () => {
    // The set, restated. A differing-set assertion here is the point: adding a
    // class is a deliberate act with an ADR behind it, not a quiet append.
    expect([...REFUSAL_CLASSES].sort()).toEqual(
      [
        // The two acquire refusals (ADR-0064): the machine's accessibility
        // layer cannot be switched on by this build, and an attempt that was
        // permitted and did not take. Named rather than folded into an
        // existing class because an operator's remedy differs for each.
        "AccessibilityNotAcquirable",
        "AccessibilityNotAcquired",
        "AlreadyRunning",
        "AttestationFailedError",
        "BackendUnreadable",
        "CouldNotStart",
        "DisabledByConfiguration",
        "EffectClassGate",
        "EffectUnsupportedError",
        "ElementGone",
        "EnforcementUnrepresentable",
        "InventoryUnsupported",
        "LaunchUnavailable",
        "MagnitudeOutOfRangeError",
        "MalformedParameter",
        "NoConnection",
        "NoMatch",
        "NoRecipe",
        "NotReadableInTime",
        "OneBrowserIdentity",
        "OperationNotExposedError",
        "RecordingNotPerformableError",
        // The three restart refusals (ADR-0065). Separate classes because the
        // remedies are three different things: nothing this daemon opened,
        // the application itself said no and put up a dialog, and it neither
        // closed nor said anything within the wait.
        "RestartNotConfirmed",
        "RestartNotOurs",
        "RestartRefusedByApplication",
        "TextOffsetOutOfRangeError",
        "UnknownElement",
        "UnknownMethod",
        "UnknownSubscription",
        "UnperformableElementError",
        "UnpublishedActionError",
        "WatchDeaf",
        "WatchUnknownElement",
        "WatchUnsupported",
        "WriteNotObservedError",
      ].sort(),
    );
  });

  it("9b: every seam class performEffect translates records under a name the set holds", () => {
    // The effect path records `error.constructor.name`, so the name that
    // reaches the disk is the constructor's - asked of the classes themselves
    // rather than of a list that could drift away from them.
    const translated = [
      new AttestationFailedError("m"),
      new UnperformableElementError("m"),
      new UnpublishedActionError("m"),
      new OperationNotExposedError("m"),
      new MagnitudeOutOfRangeError("m"),
      new TextOffsetOutOfRangeError("m"),
      new WriteNotObservedError("m"),
      new EffectUnsupportedError("m"),
      new RecordingNotPerformableError("m"),
    ];
    for (const error of translated) {
      expect(isRefusalClass(error.constructor.name), `${error.constructor.name} is not in the vocabulary`).toBe(true);
    }
  });
});
