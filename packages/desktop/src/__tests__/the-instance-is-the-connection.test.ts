import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { METHOD_NAMES } from "@mastra-cc/protocol-types";
import { AtspiBackend, replayChannel, startServer } from "@mastra-cc/daemon";
import { MastraCC } from "../mastra.js";

type DaemonServer = Awaited<ReturnType<typeof startServer>>;

// THE INSTANCE IS THE CONNECTION (ADR-0060, as amended).
//
// The claim under test is an IDENTITY claim, not a counting one: everything an
// instance hands out is bound to the same client object. A counter would pass
// while broken - a second dial that happened to be opened lazily still leaves
// the count at one until someone calls a tool.
//
// `node:net` is not imported here, for a value or a type. Pin B5 scans this
// directory and a dial living in this package is exactly what it catches.

const started: DaemonServer[] = [];
const open: MastraCC[] = [];

afterEach(async () => {
  for (const desk of open.splice(0)) await desk.close();
  for (const server of started.splice(0)) await new Promise((r) => server.close(r));
});

async function daemonOnATape(): Promise<string> {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-instance-")), "daemon.sock");
  started.push(
    await startServer({ socketPath, backend: new AtspiBackend(replayChannel("gtk-dialog"), "all") }),
  );
  return socketPath;
}

function desk(socketPath: string): MastraCC {
  const instance = new MastraCC({ socketPath });
  open.push(instance);
  return instance;
}

describe("MastraCC", () => {
  it("dials once, however many times its surfaces are asked for", async () => {
    const instance = desk(await daemonOnATape());

    instance.getTools();
    instance.getTools();
    const first = await instance.client();
    const second = await instance.client();

    // Identity, not a count: the SAME object, so nothing can be holding a
    // second connection it opened quietly.
    expect(second).toBe(first);
  });

  it("does not dial until something actually needs the desk", async () => {
    // Constructing an agent at module scope must not be an I/O operation, so a
    // desk that is unreachable is only a problem for a caller that uses it.
    const instance = new MastraCC({ socketPath: "/nonexistent/never/dialled.sock" });
    open.push(instance);

    expect(() => instance.getTools()).not.toThrow();
    expect(Object.keys(instance.getTools()).sort()).toEqual([...METHOD_NAMES].sort());
  });

  it("reaches the real daemon through a tool built before the dial existed", async () => {
    const instance = desk(await daemonOnATape());
    const tools = instance.getTools();

    const result = (await tools.queryElements.execute!(
      { role: "window" } as never,
      undefined as never,
    )) as { elements?: unknown[] };

    expect(Array.isArray(result.elements)).toBe(true);
  });

  it("closes idempotently, and closing one that never dialled is not an error", async () => {
    const instance = desk(await daemonOnATape());
    await instance.client();

    await instance.close();
    await instance.close();

    const neverDialled = new MastraCC({ socketPath: "/nonexistent/never/dialled.sock" });
    await neverDialled.close();
  });

  it("refuses to dial again once closed, rather than quietly opening a different connection", async () => {
    // The failure this prevents is invisible: a re-dial gets a new daemon-side
    // identity and an empty subscription book, so tools would keep working while
    // every subscription made before the close is gone and any provider still
    // listening is attached to a dead client.
    const instance = desk(await daemonOnATape());
    await instance.client();
    await instance.close();

    await expect(instance.client()).rejects.toThrow(/closed/);
    await expect(
      instance.getTools().queryElements.execute!({ role: "window" } as never, undefined as never),
    ).rejects.toThrow(/closed/);
  });
});
