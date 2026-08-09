import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dbus from "dbus-native";
import type { DbusBus } from "dbus-native";

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
  const tape: TapeEntry[] = [];
  return {
    async call(exchange) {
      const reply = await inner.call(exchange);
      tape.push({ ...exchange, reply });
      return reply;
    },
    async close() {
      const dir = join(fixturesDir(), captureName);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tape.json"), `${JSON.stringify(tape, null, 1)}\n`);
      console.log(`capture: ${tape.length} exchange(s) recorded to daemon/fixtures/${captureName}/tape.json`);
      await inner.close();
    },
  };
}
