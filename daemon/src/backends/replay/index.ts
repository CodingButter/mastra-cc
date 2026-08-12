import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AttestElementParams, AttestElementResult, QueryElementsParams, QueryElementsResult } from "@mastra-cc/protocol-types";
import { type Backend, type BackendChange, type BackendSubscription, replayWatch } from "../../backend.js";
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

  unsubscribeElement(subscriptionId: string): Promise<void> {
    return this.inner.unsubscribeElement(subscriptionId);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}
