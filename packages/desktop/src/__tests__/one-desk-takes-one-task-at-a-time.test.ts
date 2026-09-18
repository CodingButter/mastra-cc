import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Backend, type LaunchContext, OwnershipTable, startServer } from "@mastra-cc/daemon";
import { DeskBusyError, MastraCC, WAITING_TASK_LIMIT } from "../mastra.js";

// CC-05, the half a daemon cannot enforce.
//
// The daemon already refuses a second driver: one connection owns the desk, and
// a contender is turned away before any effect. That is the whole guarantee,
// and it is not enough. A single consumer serving two agent loops holds ONE
// connection and is therefore ONE driver, while two unrelated goals interleave
// keystrokes into whatever window is focused at the moment each one resumes.
// Every individual call is serialized; the TASKS are not; and the desk cannot
// tell the difference, because from where it stands there is no difference.
//
// So the lease lives in the consumer, where the two loops are distinguishable
// from each other. What the tests below insist on:
//
//   - a task holds the desk, and a rival loop's EFFECT is refused, not queued
//     behind it: an effect aimed from an observation taken before someone
//     else's task ran is aimed at a desk that is gone
//   - the refusal happens before anything is sent
//   - OBSERVING is never refused - it is how the second loop learns to wait
//   - a waiting task gets the desk when the holder finishes, including when
//     the holder finishes by throwing
//   - waiting is bounded: past the limit the desk says it is busy rather than
//     accepting work it would run against an unrecognisable desk
//   - a consumer that never asked for a task is not serialized behind anyone

type DaemonServer = Awaited<ReturnType<typeof startServer>>;
const started: DaemonServer[] = [];
const open: MastraCC[] = [];
afterEach(async () => {
  for (const desk of open.splice(0)) await desk.close();
  for (const server of started.splice(0)) await new Promise((r) => server.close(r));
});

const ELEMENT = { id: "el-0123456789ab", role: "textbox" as const, name: "field", actions: [] };

/** A backend that records every effect it is asked to perform. */
function recordingBackend(performed: string[]): Backend {
  const element = { ...ELEMENT };
  return {
    name: "task-fixture",
    queryElements: async () => ({ elements: [element] }),
    readElementContent: async () => ({ element }),
    setElementText: async () => {
      performed.push("setElementText");
      return { element };
    },
    applicationOfElement: () => "fixture",
    close: () => undefined,
  } as unknown as Backend;
}

async function deskWith(performed: string[]): Promise<MastraCC> {
  const socketPath = join(mkdtempSync(join(tmpdir(), "one-task-")), "d.sock");
  const server = await startServer({
    socketPath,
    backend: recordingBackend(performed),
    launch: {
      permits: new Set(["fixture"]),
      allows: new Set(["observe", "edit"]),
      table: new OwnershipTable(),
      visibility: "all",
    } as unknown as LaunchContext,
  });
  started.push(server);
  const desk = new MastraCC({ socketPath });
  open.push(desk);
  return desk;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("one desk takes one task at a time", () => {
  it("refuses a rival loop's effect while a task holds the desk, and sends nothing", async () => {
    const performed: string[] = [];
    const desk = await deskWith(performed);
    const tools = desk.getTools();

    // The rival loop runs OUTSIDE the task's async context, which is what a
    // second agent loop sharing this instance actually is: its own call stack,
    // resuming whenever its own await returns.
    let letRivalGo: () => void = () => undefined;
    const rivalTurn = new Promise<void>((resolve) => {
      letRivalGo = resolve;
    });
    const rival = rivalTurn
      .then(() => tools.setElementText.execute!({ id: ELEMENT.id, text: "from the other goal" }, {} as never))
      .then(() => undefined as unknown)
      .catch((failure: unknown) => failure);

    await desk.withTask("file the invoice", async () => {
      expect(desk.heldBy).toBe("file the invoice");
      letRivalGo();
      await rival;
      // The holder itself is not refused: it is the task that holds the desk.
      await tools.setElementText.execute!({ id: ELEMENT.id, text: "from this task" }, {} as never);
    });

    const refusal = await rival;
    expect(refusal).toBeInstanceOf(DeskBusyError);
    expect((refusal as DeskBusyError).holder).toBe("file the invoice");
    expect((refusal as DeskBusyError).message).toMatch(/refused and nothing was sent/);
    expect(performed).toEqual(["setElementText"]);
  });

  it("never refuses an observation, because that is how the other loop learns to wait", async () => {
    const performed: string[] = [];
    const desk = await deskWith(performed);
    const tools = desk.getTools();
    // From OUTSIDE the holding task: the rival loop looks, and is answered.
    let letRivalLook: () => void = () => undefined;
    const rivalTurn = new Promise<void>((resolve) => {
      letRivalLook = resolve;
    });
    const seen = rivalTurn
      .then(() => tools.queryElements.execute!({ role: "textbox" }, {} as never))
      .catch((failure: unknown) => failure);

    await desk.withTask("hold it", async () => {
      expect(desk.heldBy).toBe("hold it");
      letRivalLook();
      const answer = await seen;
      expect(answer).not.toBeInstanceOf(DeskBusyError);
      expect((answer as { elements: Array<{ id: string }> }).elements[0]?.id).toBe(ELEMENT.id);
    });
    expect(performed).toEqual([]);
  });

  it("hands the desk to a waiting task in turn, including when the holder fails", async () => {
    const performed: string[] = [];
    const desk = await deskWith(performed);
    const order: string[] = [];

    let releaseFirst: () => void = () => undefined;
    const first = desk.withTask("first", async () => {
      order.push("first started");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("first threw");
      throw new Error("the first task failed");
    });
    await settle();
    const second = desk.withTask("second", async () => {
      order.push("second started");
    });
    await settle();
    expect(order).toEqual(["first started"]);
    expect(desk.heldBy).toBe("first");

    releaseFirst();
    await expect(first).rejects.toThrow("the first task failed");
    await second;
    expect(order).toEqual(["first started", "first threw", "second started"]);
    expect(desk.heldBy).toBeUndefined();
  });

  it("refuses a task rather than queueing one past the waiting limit", async () => {
    const performed: string[] = [];
    const desk = await deskWith(performed);
    let release: () => void = () => undefined;
    const holder = desk.withTask("holder", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await settle();

    const waiting = Array.from({ length: WAITING_TASK_LIMIT }, (_, index) =>
      desk.withTask(`waiter ${index}`, async () => undefined),
    );
    await settle();
    await expect(desk.withTask("one too many", async () => undefined)).rejects.toBeInstanceOf(DeskBusyError);

    release();
    await holder;
    await Promise.all(waiting);
    expect(desk.heldBy).toBeUndefined();
  });

  it("does not serialize a consumer that never asked for a task", async () => {
    const performed: string[] = [];
    const desk = await deskWith(performed);
    const tools = desk.getTools();
    await tools.setElementText.execute!({ id: ELEMENT.id, text: "no task here" }, {} as never);
    await tools.setElementText.execute!({ id: ELEMENT.id, text: "still none" }, {} as never);
    expect(performed).toEqual(["setElementText", "setElementText"]);
    expect(desk.heldBy).toBeUndefined();
  });
});
