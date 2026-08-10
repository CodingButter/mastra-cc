import dbus from "dbus-native";
import type { DbusBus } from "dbus-native";
import { createRequire } from "node:module";

// The concurrency-measurement primitive (07-ROADMAP.md:80, ADR-0030 clause 3).
// It lives in the daemon because only daemon/ may import a D-Bus binding (B1);
// tools/proofs/concurrent-accessibility.mjs consumes it through the built
// package. The two phases are deliberately separate so the measurement can
// attribute a failure: SETUP is the socket, the authentication handshake and
// one round-trip on the a11y bus; READ is GetChildren on the registry root.

const REGISTRY_DEST = "org.a11y.atspi.Registry";
const ROOT_PATH = "/org/a11y/atspi/accessible/root";

export interface A11yProbeConnection {
  readApplications(): Promise<number>;
  close(): Promise<void>;
}

function invoke(bus: DbusBus, message: Parameters<DbusBus["invoke"]>[0]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    bus.invoke(message, (err, ...results) => {
      if (err) reject(new Error(`probe call failed: ${JSON.stringify(err)}`));
      else resolve(results);
    });
  });
}

// Resolves only once the connection is ESTABLISHED: socket connected, Hello
// exchanged, and one round-trip (ListNames) answered by the a11y bus itself.
export async function openA11yConnection(): Promise<A11yProbeConnection> {
  const session = dbus.sessionBus();
  const [address] = await invoke(session, {
    destination: "org.a11y.Bus",
    path: "/org/a11y/bus",
    interface: "org.a11y.Bus",
    member: "GetAddress",
  });
  const a11y = dbus.createClient({ busAddress: String(address), direct: false });
  await invoke(a11y, {
    destination: "org.freedesktop.DBus",
    path: "/org/freedesktop/DBus",
    interface: "org.freedesktop.DBus",
    member: "ListNames",
  });
  return {
    async readApplications() {
      const [children] = await invoke(a11y, {
        destination: REGISTRY_DEST,
        path: ROOT_PATH,
        interface: "org.a11y.atspi.Accessible",
        member: "GetChildren",
      });
      return (children as unknown[]).length;
    },
    async close() {
      a11y.connection.end();
      session.connection.end();
    },
  };
}

// The binding's identity for the proof artifact, reported from here so the
// proof script never has to name the module (B1 bans the name outside daemon/).
export function bindingIdentity(): string {
  const require = createRequire(import.meta.url);
  const manifest = require("dbus-native/package.json") as { name: string; version: string };
  return `${manifest.name}@${manifest.version}`;
}
