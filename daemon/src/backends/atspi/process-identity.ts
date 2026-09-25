import { accessSync, constants, readlinkSync, realpathSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Channel } from "./channel.js";
import { applicationName } from "./names.js";

// A published application name is a claim any process can make (GLib's
// set_prgname is one line). Visibility binds to the PROCESS instead: the bus
// name that answers for an application is resolved to a PID by the bus daemon
// itself, the PID to the executable the kernel says it runs, and a grant
// admits the name only from an executable it names (ADR-0120).

export type Executables = ReadonlyMap<string, ReadonlySet<string>>;

export interface Identity {
  /** Whether the process behind this bus name runs an executable granted to this name. */
  admits(name: string, busName: string): Promise<boolean>;
}

// Where a bare granted name resolves to: the executable a shell would run for
// it, with every symlink followed. Snap puts /usr/bin/snap behind /snap/bin/<name>
// and runs the real binary from /snap/<name>/, so a snap resolution admits
// that tree instead of the launcher every snap shares.
export function executablesOfName(name: string, path = process.env.PATH ?? ""): string[] {
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      const real = realpathSync(candidate);
      if (real === "/usr/bin/snap") return [`/snap/${name}/`];
      return [real];
    } catch {
      continue;
    }
  }
  return [];
}

// Explicit grants ({"name", "executable"}) win; a bare name resolves through
// PATH once, at boot. A name that resolves to nothing admits nothing - an
// unresolvable grant fails closed, never open.
export function grantedExecutables(names: Iterable<string>, explicit: ReadonlyMap<string, readonly string[]>, resolve = executablesOfName): Executables {
  const out = new Map<string, Set<string>>();
  for (const raw of names) {
    const name = applicationName(raw);
    const given = explicit.get(name);
    out.set(name, new Set(given && given.length > 0 ? given : resolve(raw)));
  }
  return out;
}

function matches(allowed: ReadonlySet<string>, executable: string): boolean {
  for (const entry of allowed) {
    if (entry.endsWith("/") ? executable.startsWith(entry) : executable === entry) return true;
  }
  return false;
}

// The live identity: the bus daemon's GetConnectionUnixProcessID (the bus,
// not the application, says which process owns the connection), then
// /proc/<pid>/exe. Answers are cached per unique bus name, which the bus
// never reuses within its lifetime.
export function busIdentity(channel: Channel, executables: Executables, exeOf = (pid: number) => readlinkSync(`/proc/${pid}/exe`)): Identity {
  const cache = new Map<string, Promise<string | undefined>>();
  const executableOf = (busName: string): Promise<string | undefined> => {
    let known = cache.get(busName);
    if (!known) {
      known = channel
        .call({
          destination: "org.freedesktop.DBus",
          path: "/org/freedesktop/DBus",
          iface: "org.freedesktop.DBus",
          member: "GetConnectionUnixProcessID",
          signature: "s",
          body: [busName],
        })
        .then((reply) => {
          const pid = Number(reply[0]);
          if (!Number.isInteger(pid) || pid <= 0) return undefined;
          return exeOf(pid).replace(/ \(deleted\)$/, "");
        })
        .catch(() => {
          cache.delete(busName);
          return undefined;
        });
      cache.set(busName, known);
    }
    return known;
  };
  return {
    async admits(name, busName) {
      const allowed = executables.get(applicationName(name));
      if (!allowed || allowed.size === 0) return false;
      const executable = await executableOf(busName);
      return executable !== undefined && matches(allowed, executable);
    },
  };
}
