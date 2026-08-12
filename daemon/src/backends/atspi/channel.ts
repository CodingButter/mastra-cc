import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dbus from "dbus-native";
import type { DbusBus } from "dbus-native";
import { type BackendChange, type ChannelWatch, type TapeEvent, WatchUnsupportedError } from "../../backend.js";

// The channel: every D-Bus exchange the backend performs goes through exactly
// one call() seam. The live channel talks to the real accessibility bus; the
// capture wrapper records every exchange verbatim to a tape. The tape is the
// corpus Phase 5's replay backend answers from, which is why fixtures are
// captured, never hand-authored.

export interface Exchange {
  destination: string;
  path: string;
  iface: string;
  member: string;
  signature?: string;
  body?: unknown[];
}

export interface Channel {
  call(exchange: Exchange): Promise<unknown[]>;
  // The second direction on the same seam (ADR-0039): the caller registers a
  // sink and the channel feeds it, rather than the caller asking. No second
  // socket, no polling - a channel that cannot yet be told anything refuses by
  // name rather than accepting a watch that would stay silent.
  watch(subscribedTo: string, sink: (change: BackendChange) => void): Promise<ChannelWatch>;
  close(): Promise<void>;
}

// One stable key per exchange; the replay backend looks answers up by it.
// The body is part of the key on purpose: a looser key produced a false
// "identical" replay at plan time that a distinct-name check exposed.
export function exchangeKey(x: Exchange): string {
  return [x.destination, x.path, x.iface, x.member, JSON.stringify(x.body ?? [])].join("|");
}

// Thrown by the replay channel when asked for an exchange the tape never
// recorded. Lives here (not in replay/) so the tree walk can tell it apart
// from a live dead-node error: a dying process is skipped, an off-tape read
// is a refusal that must surface. Refuse-on-ignorance, not invention.
export class UnrecordedExchangeError extends Error {}

function invoke(bus: DbusBus, x: Exchange): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    bus.invoke(
      {
        destination: x.destination,
        path: x.path,
        interface: x.iface,
        member: x.member,
        ...(x.signature !== undefined ? { signature: x.signature } : {}),
        ...(x.body !== undefined ? { body: x.body } : {}),
      },
      (err, ...results) => {
        if (err) reject(new Error(`d-bus call failed for ${exchangeKey(x)}: ${JSON.stringify(err)}`));
        else resolve(results);
      },
    );
  });
}

// Lazy: nothing touches a bus until the first call, so constructing the
// backend (as the conformance suite does at collection time) is free.
export function liveChannel(): Channel {
  let session: DbusBus | null = null;
  let a11y: DbusBus | null = null;

  async function a11yBus(): Promise<DbusBus> {
    if (a11y) return a11y;
    session = dbus.sessionBus();
    const [address] = await invoke(session, {
      destination: "org.a11y.Bus",
      path: "/org/a11y/bus",
      iface: "org.a11y.Bus",
      member: "GetAddress",
    });
    a11y = dbus.createClient({ busAddress: String(address), direct: false });
    return a11y;
  }

  return {
    async call(exchange) {
      return invoke(await a11yBus(), exchange);
    },
    async watch() {
      // The bus signal registration lands with the accessibility stream
      // (Phase 4). Until it does, this route says so instead of handing back a
      // watch that would never speak.
      throw new WatchUnsupportedError(
        "the accessibility route cannot watch a subtree yet - it has registered for no signals, and a watch that reports nothing is indistinguishable from a quiet desktop",
      );
    },
    async close() {
      a11y?.connection.end();
      session?.connection.end();
      a11y = null;
      session = null;
    },
  };
}

export interface TapeEntry extends Exchange {
  reply: unknown[];
}

export interface Tape {
  exchanges: TapeEntry[];
  events: TapeEvent[];
}

// Tapes recorded before the channel had a second direction are a bare array of
// exchanges. They are read as what they are - a recording with no events - and
// never rewritten: a tape is what the world did, not what we would like it to
// have done.
export function asTape(recorded: unknown): Tape {
  if (Array.isArray(recorded)) return { exchanges: recorded as TapeEntry[], events: [] };
  const tape = recorded as Partial<Tape>;
  return { exchanges: tape.exchanges ?? [], events: tape.events ?? [] };
}

// Fixtures live under daemon/fixtures/, found by walking up from this module
// to the package root - NOT by a fixed number of ".." segments, because this
// module loads from two different depths (src/backends/atspi/ under the test
// runner, dist/ once bundled) and a fixed path silently writes elsewhere from
// one of them. Not cwd either: a daemon started from any directory must write
// to the same place.
export function fixturesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return join(dir, "fixtures");
    const parent = dirname(dir);
    if (parent === dir) throw new Error("capture: no package root above this module - refusing to guess a fixtures path");
    dir = parent;
  }
}

export function captureChannel(inner: Channel, captureName: string): Channel {
  const exchanges: TapeEntry[] = [];
  const events: TapeEvent[] = [];
  return {
    async call(exchange) {
      const reply = await inner.call(exchange);
      exchanges.push({ ...exchange, reply });
      return reply;
    },
    async watch(subscribedTo, sink) {
      // Changes are recorded as they arrive, on the way through to the caller:
      // a capture of a watch is a recording of what the desktop said, in the
      // order it said it.
      const began = Date.now();
      return inner.watch(subscribedTo, (change) => {
        events.push({ afterMs: Date.now() - began, subscribedTo, change });
        sink(change);
      });
    },
    async close() {
      const dir = join(fixturesDir(), captureName);
      mkdirSync(dir, { recursive: true });
      const tape: Tape = { exchanges, events };
      writeFileSync(join(dir, "tape.json"), `${JSON.stringify(tape, null, 1)}\n`);
      console.log(
        `capture: ${exchanges.length} exchange(s) and ${events.length} event(s) recorded to daemon/fixtures/${captureName}/tape.json`,
      );
      await inner.close();
    },
  };
}
