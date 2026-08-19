import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ActivateElementResult,
  AttestElementParams,
  AttestElementResult,
  EditElementResult,
  QueryElementsParams,
  QueryElementsResult,
  RevealElementResult,
  SemanticElement,
  SetElementCaretResult,
  SetElementTextResult,
  SetElementValueResult,
  SubmitElementResult,
} from "@mastra-cc/protocol-types";
import {
  type Backend,
  type BackendChange,
  type BackendSubscription,
  FocusUnsupportedError,
  InventoryUnsupportedError,
  RecordingNotPerformableError,
  replayWatch,
} from "../../backend.js";
import type { InventoryEntry } from "../../inventory.js";
import type { Visibility } from "../../grants.js";
import { AtspiBackend } from "../atspi/index.js";
import { asTape, type Channel, exchangeKey, fixturesDir, type Tape, UnrecordedExchangeError } from "../atspi/channel.js";

// The replay backend: the SAME reader as the live backend, fed from a tape
// the Phase 4 capture path recorded off a real desktop. Nothing here invents
// tree data - the walk, the role map, the identity derivation and the NFKC
// name matching are all the atspi reader's own; only the channel differs.
// This is what gives a machine with no desktop (the factory lane) real work:
// the offline lane exercises a recording of a real tree, not a hand-authored
// guess.

export function tapePath(fixture: string): string {
  return join(fixturesDir(), fixture, "tape.json");
}

export function loadTape(fixture: string): Tape {
  const file = tapePath(fixture);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`replay: no tape at ${file} - fixtures are captured with --capture, never hand-authored`);
  }
  return asTape(JSON.parse(text));
}

export function replayChannel(fixture: string): Channel {
  let table: Map<string, unknown[]> | null = null;
  return {
    async call(exchange) {
      if (table === null) table = new Map(loadTape(fixture).exchanges.map((e) => [exchangeKey(e), e.reply]));
      const reply = table.get(exchangeKey(exchange));
      if (reply === undefined) {
        throw new UnrecordedExchangeError(
          `no recorded exchange for ${exchangeKey(exchange)} - refusing to invent a reply`,
        );
      }
      return reply;
    },
    async watch(subscribedTo, sink) {
      // A tape that recorded no events answers a watch normally and says
      // nothing. That is a valid recording of a quiet subtree, not an error.
      return replayWatch(loadTape(fixture).events, subscribedTo, sink);
    },
    async close() {
      // no bus was ever contacted; nothing to release
    },
  };
}

export class ReplayBackend implements Backend {
  readonly name = "replay";
  private readonly inner: AtspiBackend;

  // Visibility threads through to the same reader: the replay lane enforces
  // deny-by-default exactly as the live lane does (same guard, same code).
  constructor(fixture: string, visibility?: Visibility) {
    this.inner = new AtspiBackend(replayChannel(fixture), visibility);
  }

  queryElements(params: QueryElementsParams): Promise<QueryElementsResult> {
    return this.inner.queryElements(params);
  }

  attestElement(params: AttestElementParams): Promise<AttestElementResult> {
    return this.inner.attestElement(params);
  }

  subscribeElement(id: string, sink: (change: BackendChange) => void): Promise<BackendSubscription> {
    return this.inner.subscribeElement(id, sink);
  }

  // Shares the live reader here, as with every observe-side question: the
  // recorded world names its applications exactly as the live one does.
  applicationOfElement(id: string): string | undefined {
    return this.inner.applicationOfElement(id);
  }

  // NOT delegated, unlike every other observe-side question. The live reader
  // would scan the machine THIS process is running on, and a tape's answers
  // would then be mixed with a live fact from somewhere else entirely - an
  // offline lane reporting the developer's own installed applications as if
  // they were the recording's. A tape records a tree; it never recorded a
  // catalogue, so this route says so by name.
  async installedApplications(): Promise<InventoryEntry[]> {
    throw new InventoryUnsupportedError(
      "this session's backend answers from a recording, and the recording holds a tree rather than a list of what is installed",
    );
  }

  unsubscribeElement(subscriptionId: string): Promise<void> {
    return this.inner.unsubscribeElement(subscriptionId);
  }

  // The focus SPLITS across the two halves of this backend, and the split is
  // the honest one rather than a convenient one. Reading what held focus is an
  // observe-side question a tape genuinely answers: the recording captured the
  // focused state along with every other state, so this is the recorded tree's
  // own fact and it is delegated like every other read.
  focusedElement(): Promise<SemanticElement | undefined> {
    return this.inner.focusedElement();
  }

  // Restoring it is not. A recording cannot be acted upon, and answering with
  // the tape's focused element after a restore that never happened would be
  // the worst answer available here: it would look exactly like a successful
  // restoration, because the tape's focus never moved in the first place. That
  // is a test that passes while measuring nothing (ADR-0044 clause 3).
  async restoreFocus(): Promise<SemanticElement | undefined> {
    throw new FocusUnsupportedError(
      "the replay route cannot restore the focus: it answers from a recording, and a recording holds the focus it was captured with",
    );
  }

  // A recording cannot be acted upon, and this is the ONE place the replay lane
  // deliberately stops sharing the live reader. Reading is delegated because a
  // tape holds real answers to real questions; performing has no answer on a
  // tape at all, and the two ways of pretending otherwise - inventing an
  // outcome, or letting the write fall through to a channel that would refuse
  // the exchange anyway - both end with a test that says a verb worked when
  // nothing happened. It refuses by name instead, which is the same promise
  // `replay-invents-a-reply-for-an-unrecorded-exchange` already pins on the
  // reading side.
  private refuseToPerform(verb: string): never {
    throw new RecordingNotPerformableError(
      `the replay route cannot ${verb}: it answers from a recording, and a recording cannot be acted upon`,
    );
  }

  async editElement(): Promise<EditElementResult> {
    this.refuseToPerform("edit an element");
  }

  async activateElement(): Promise<ActivateElementResult> {
    this.refuseToPerform("perform an action");
  }

  async submitElement(): Promise<SubmitElementResult> {
    this.refuseToPerform("submit");
  }

  async setElementValue(): Promise<SetElementValueResult> {
    this.refuseToPerform("set a value");
  }

  async setElementText(): Promise<SetElementTextResult> {
    this.refuseToPerform("set text");
  }

  async setElementCaret(): Promise<SetElementCaretResult> {
    this.refuseToPerform("place the caret");
  }

  async revealElement(): Promise<RevealElementResult> {
    this.refuseToPerform("reveal an element");
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}
