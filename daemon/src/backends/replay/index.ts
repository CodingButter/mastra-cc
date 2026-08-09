import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AttestElementParams, AttestElementResult, QueryElementsParams, QueryElementsResult } from "@mastra-cc/protocol-types";
import type { Backend } from "../../backend.js";
import { AtspiBackend } from "../atspi/index.js";
import {
  type Channel,
  exchangeKey,
  fixturesDir,
  type TapeEntry,
  UnrecordedExchangeError,
} from "../atspi/channel.js";

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

export function loadTape(fixture: string): TapeEntry[] {
  const file = tapePath(fixture);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`replay: no tape at ${file} - fixtures are captured with --capture, never hand-authored`);
  }
  return JSON.parse(text) as TapeEntry[];
}

export function replayChannel(fixture: string): Channel {
  let table: Map<string, unknown[]> | null = null;
  return {
    async call(exchange) {
      if (table === null) table = new Map(loadTape(fixture).map((e) => [exchangeKey(e), e.reply]));
      const reply = table.get(exchangeKey(exchange));
      if (reply === undefined) {
        throw new UnrecordedExchangeError(
          `no recorded exchange for ${exchangeKey(exchange)} - refusing to invent a reply`,
        );
      }
      return reply;
    },
    async close() {
      // no bus was ever contacted; nothing to release
    },
  };
}

export class ReplayBackend implements Backend {
  readonly name = "replay";
  private readonly inner: AtspiBackend;

  constructor(fixture: string) {
    this.inner = new AtspiBackend(replayChannel(fixture));
  }

  queryElements(params: QueryElementsParams): Promise<QueryElementsResult> {
    return this.inner.queryElements(params);
  }

  attestElement(params: AttestElementParams): Promise<AttestElementResult> {
    return this.inner.attestElement(params);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}
