import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApplicationIdentityMismatchError } from "../backend.js";
import type { Channel } from "../backends/atspi/channel.js";
import { replayChannel } from "../backends/replay/index.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { busIdentity, executablesOfName, grantedExecutables } from "../backends/atspi/process-identity.js";

// ADR-0120 (audit M7). A published application name is a claim any process
// can make; the grant admits the name only from the executable it names.

function busAnswering(pids: Record<string, number>, calls: string[] = []): Channel {
  return {
    async call(exchange) {
      calls.push(`${exchange.member}:${String(exchange.body?.[0])}`);
      if (exchange.member !== "GetConnectionUnixProcessID") throw new Error(`unexpected ${exchange.member}`);
      const pid = pids[String(exchange.body?.[0])];
      if (pid === undefined) throw new Error("org.freedesktop.DBus.Error.NameHasNoOwner");
      return [pid];
    },
    watch: () => Promise.reject(new Error("no watches")),
    close: async () => {},
  };
}

describe("the process identity", () => {
  const exes: Record<number, string> = { 10: "/usr/bin/mousepad", 11: "/usr/bin/python3.12", 12: "/snap/firefox/7000/usr/lib/firefox/firefox" };
  const exeOf = (pid: number) => {
    const exe = exes[pid];
    if (exe === undefined) throw new Error("ENOENT");
    return exe;
  };

  it("admits a granted name from the granted executable, and refuses the same name from another", async () => {
    const identity = busIdentity(busAnswering({ ":1.10": 10, ":1.11": 11 }), new Map([["mousepad", new Set(["/usr/bin/mousepad"])]]), exeOf);
    expect(await identity.admits("Mousepad", ":1.10")).toBe(true);
    expect(await identity.admits("mousepad", ":1.11")).toBe(false);
  });

  it("admits a snap's own tree, and nothing that only shares its launcher", async () => {
    const identity = busIdentity(busAnswering({ ":1.12": 12, ":1.11": 11 }), new Map([["firefox", new Set(["/snap/firefox/"])]]), exeOf);
    expect(await identity.admits("firefox", ":1.12")).toBe(true);
    expect(await identity.admits("firefox", ":1.11")).toBe(false);
  });

  it("fails closed when the bus cannot say who owns the connection, and asks again next time", async () => {
    const calls: string[] = [];
    const pids: Record<string, number> = {};
    const identity = busIdentity(busAnswering(pids, calls), new Map([["mousepad", new Set(["/usr/bin/mousepad"])]]), exeOf);
    expect(await identity.admits("mousepad", ":1.10")).toBe(false);
    pids[":1.10"] = 10;
    expect(await identity.admits("mousepad", ":1.10")).toBe(true);
    expect(calls).toEqual(["GetConnectionUnixProcessID::1.10", "GetConnectionUnixProcessID::1.10"]);
  });

  it("admits nothing for a name the grants resolved to no executable", async () => {
    const identity = busIdentity(busAnswering({ ":1.10": 10 }), grantedExecutables(["ghost"], new Map(), () => []), exeOf);
    expect(await identity.admits("ghost", ":1.10")).toBe(false);
  });

  it("prefers an explicit executable over PATH, and resolves a snap launcher to its tree", () => {
    const resolved = grantedExecutables(["kate", "tool"], new Map([["tool", ["/usr/bin/python3.12"]]]), (name) => [`/usr/bin/${name}`]);
    expect([...(resolved.get("tool") ?? [])]).toEqual(["/usr/bin/python3.12"]);
    expect([...(resolved.get("kate") ?? [])]).toEqual(["/usr/bin/kate"]);
    const bin = realpathSync(mkdtempSync(join(tmpdir(), "grant-path-")));
    const launcher = join(bin, "snap");
    writeFileSync(launcher, "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(bin, "kate"), "#!/bin/sh\n", { mode: 0o755 });
    symlinkSync(launcher, join(bin, "firefox"));
    expect(executablesOfName("firefox", bin, launcher)).toEqual(["/snap/firefox/"]);
    expect(executablesOfName("kate", bin, launcher)).toEqual([join(bin, "kate")]);
    expect(executablesOfName("absent", bin, launcher)).toEqual([]);
  });
});

describe("the backend applies it at the visibility gate", () => {
  const refuse = { admits: async () => false };
  const admit = { admits: async () => true };

  it("hides an impostor from an unscoped query and refuses a scoped one as a mismatch", async () => {
    const honest = new AtspiBackend(replayChannel("gtk-dialog"), new Set(["yad"]), undefined, undefined, admit);
    expect((await honest.queryElements({})).elements.length).toBeGreaterThan(0);

    const impostor = new AtspiBackend(replayChannel("gtk-dialog"), new Set(["yad"]), undefined, undefined, refuse);
    expect((await impostor.queryElements({})).elements).toEqual([]);
    await expect(impostor.queryElements({ application: "yad" })).rejects.toBeInstanceOf(ApplicationIdentityMismatchError);
    await expect(impostor.discoverElements({ application: "yad" })).rejects.toBeInstanceOf(ApplicationIdentityMismatchError);
    expect(await impostor.focusedElement()).toBeUndefined();
  });
});
