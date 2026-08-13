import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dbus from "dbus-native";
import type { DbusBus, DbusWireMessage } from "dbus-native";
import type { BackendChange, ChannelWatch, TapeEvent } from "../../backend.js";
import { type AtspiWatchAnchor, openSignalStream, type SignalBusOps } from "./signal-stream.js";

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
  watch(subscribedTo: string, sink: (change: BackendChange) => void, anchor: AtspiWatchAnchor): Promise<ChannelWatch>;
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

// D-Bus wire message type for a signal, and the serial counter for the ones
// this daemon emits itself (the self-caused probe). Serials only have to be
// unique per sending connection for reply matching, and signals get no reply;
// starting high keeps them visibly apart from invoke()'s own counter.
const SIGNAL_MESSAGE_TYPE = 4;
let signalSerial = 0x40000000;

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
    async watch(subscribedTo, sink, anchor) {
      const bus = await a11yBus();
      // Proof-only deaf switch, read from the environment and never from the
      // wire: leg M of the live proof disables the bus-side registration to
      // show that a route that cannot hear REFUSES instead of returning a
      // subscription that will never speak. In every other run this is off.
      const deaf = process.env.MASTRA_CC_ATSPI_DEAF_FOR_PROOF === "1";
      const ops: SignalBusOps = {
        call: (exchange) =>
          deaf && exchange.member === "AddMatch" ? Promise.resolve([]) : invoke(bus, exchange),
        emit(msg) {
          signalSerial += 1;
          bus.connection.message({
            type: SIGNAL_MESSAGE_TYPE,
            serial: signalSerial,
            path: msg.path,
            interface: msg.iface,
            member: msg.member,
            signature: msg.signature,
            body: msg.body,
          });
        },
        onSignal(listener) {
          const handler = (msg: DbusWireMessage) => {
            if (msg.type !== SIGNAL_MESSAGE_TYPE) return;
            listener({
              sender: String(msg.sender ?? ""),
              path: String(msg.path ?? ""),
              iface: String(msg.interface ?? ""),
              member: String(msg.member ?? ""),
              body: Array.isArray(msg.body) ? msg.body : [],
            });
          };
          bus.connection.on("message", handler);
          return () => bus.connection.removeListener("message", handler);
        },
      };
      return openSignalStream(ops, subscribedTo, anchor, sink);
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
    async watch(subscribedTo, sink, anchor) {
      // Changes are recorded as they arrive, on the way through to the caller:
      // a capture of a watch is a recording of what the desktop said, in the
      // order it said it.
      const began = Date.now();
      return inner.watch(
        subscribedTo,
        (change) => {
          events.push({ afterMs: Date.now() - began, subscribedTo, change });
          sink(change);
        },
        anchor,
      );
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
