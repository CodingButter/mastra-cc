import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { METHOD_NAMES } from "@mastra-cc/protocol-types";
import { AtspiBackend, replayChannel, startServer } from "@mastra-cc/daemon";
import { connect, SOCKET_ENV, URL_ENV } from "../index.js";

// The server type comes from startServer's own return rather than an import of
// `node:net`: naming that module here, even for a type, is what pin B5 reads.
type DaemonServer = Awaited<ReturnType<typeof startServer>>;

// WHAT THIS PACKAGE OWES THE PROTOCOL.
//
// It is a wrapper, so the interesting failures are not "does a call work" -
// transport answers that, and is tested for it. They are the ones a wrapper
// introduces: a method the wrapper forgot to pass through, an address the
// wrapper invented, a close that stops at the wrapper.
//
// The server here is the REAL daemon on a replay tape, reached over a unix
// socket. Note what is absent: `node:net` is imported for a TYPE only, and no
// socket is opened in this package. Pin B5 scans this directory, and it should
// - a second dial living here would be exactly the violation it exists to
// catch.

const started: DaemonServer[] = [];
const restore: Array<() => void> = [];

afterEach(async () => {
  for (const server of started.splice(0)) await new Promise((r) => server.close(r));
  for (const undo of restore.splice(0)) undo();
});

function setEnv(name: string, value: string | undefined) {
  const before = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  restore.push(() => {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  });
}

async function daemonOnATape(): Promise<string> {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-desktop-")), "daemon.sock");
  started.push(
    await startServer({ socketPath, backend: new AtspiBackend(replayChannel("gtk-dialog"), "all") }),
  );
  return socketPath;
}

describe("the installable package", () => {
  // METHOD_NAMES is GENERATED from protocol/schema.json. A method added to the
  // contract tomorrow and not re-exported here fails this without anyone
  // remembering to come back - which a hand-written list of fourteen names
  // would never do.
  it("hands the agent every method the contract names", async () => {
    const client = await connect({ socketPath: await daemonOnATape() });
    try {
      const missing = METHOD_NAMES.filter(
        (name) => typeof (client as unknown as Record<string, unknown>)[name] !== "function",
      );
      expect(missing).toEqual([]);
      expect(METHOD_NAMES.length).toBeGreaterThan(0);
    } finally {
      client.close();
    }
  });

  it("carries a real answer back from a real daemon", async () => {
    const client = await connect({ socketPath: await daemonOnATape() });
    try {
      const found = await client.queryElements({ role: "dialog" });
      expect(Array.isArray(found.elements)).toBe(true);
    } finally {
      client.close();
    }
  });

  // The wrapper's close must reach the wire, not just the wrapper: a client
  // that "closed" and left a connection open is the kind of lie this project
  // spends its gates on.
  it("closes the connection underneath it", async () => {
    const socketPath = await daemonOnATape();
    const client = await connect({ socketPath });
    client.close();
    await expect(client.queryElements({ role: "dialog" })).rejects.toThrow();
  });

  it("takes its address from the environment when given none", async () => {
    const socketPath = await daemonOnATape();
    setEnv(SOCKET_ENV, socketPath);
    setEnv(URL_ENV, undefined);
    const client = await connect();
    try {
      expect(typeof client.queryElements).toBe("function");
    } finally {
      client.close();
    }
  });

  // Mutual exclusion is TRANSPORT'S rule and this package does not own a copy
  // of it. What is asserted is that both addresses reach the one client and
  // its refusal comes back unaltered - if this package ever grew its own
  // check, this test would still pass, which is why the refusal TEXT is
  // compared rather than merely the fact of a rejection.
  it("lets the one client refuse two addresses, in its own words", async () => {
    setEnv(SOCKET_ENV, "/tmp/nowhere.sock");
    setEnv(URL_ENV, "ws://127.0.0.1:1/");
    const fromEnv = await connect().catch((error: Error) => error.message);
    const fromArgs = await connect({ socketPath: "/tmp/nowhere.sock", url: "ws://127.0.0.1:1/" }).catch(
      (error: Error) => error.message,
    );
    expect(fromEnv).toBe(fromArgs);
    // `transport:` is the prefix that says WHO refused. If this package ever
    // grew its own copy of the rule, the sentence would come back in this
    // package's name instead - which is the drift worth catching.
    expect(fromArgs).toBe(
      "transport: refused at connect - a socket path and a websocket URL were both given; one connection has one address, so say which one",
    );
  });
});
