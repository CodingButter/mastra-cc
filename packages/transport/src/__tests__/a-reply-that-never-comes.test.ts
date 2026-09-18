import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { connect, isUnansweredRequestError, UnansweredRequestError } from "../index.js";

// CC-02's last open edge, and the one that is not about duplication.
//
// A lost reply on a LIVE connection had no budget at all. The socket is fine,
// the daemon has not refused, and the caller's await never returns - the agent
// loop simply stops, holding a desk it will never hear from again. Nothing in
// the transport noticed, because nothing was watching.
//
// What this must not become is the other failure. A desk operation has no
// length this transport knows: launching an application, typing a paragraph
// and waiting on a modal dialog are all legitimately slow. So the budget is the
// caller's and there is no default, and when it runs out the answer is that
// the outcome is UNKNOWN - not that the request failed. An effect that was
// sent may have landed, and a transport that reported "failed" here would be
// inviting exactly the resend CC-02 spent its evidence preventing.

const hello = `${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`;

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve));
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

/**
 * A daemon that says hello and then answers only what it is told to answer.
 * Requests it is not told about are received, held, and never replied to -
 * which is the whole point: the line stays open and healthy.
 */
async function deafDaemon(options: { answer?: (request: { id: number; method: string }) => unknown } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "unanswered-"));
  directories.push(directory);
  const socketPath = join(directory, "d.sock");
  const received: string[] = [];
  let live: Socket | undefined;
  const server = createServer((socket) => {
    live = socket;
    socket.write(hello);
    socket.on("data", (chunk) => {
      for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
        const request = JSON.parse(line) as { id: number; method: string };
        if (request.method !== undefined) received.push(request.method);
        const answer = options.answer?.(request);
        if (answer !== undefined) socket.write(`${JSON.stringify(answer)}\n`);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return { socketPath, received, reply: (line: unknown) => live?.write(`${JSON.stringify(line)}\n`) };
}

describe("a reply that never comes", () => {
  it("waits forever when the caller named no budget, because a slow desk is not a broken one", async () => {
    const daemon = await deafDaemon();
    const client = await connect({ socketPath: daemon.socketPath });
    let settled = false;
    void client.queryElements({}).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(daemon.received).toEqual(["queryElements"]);
    expect(settled, "an unbudgeted request must not give up on its own").toBe(false);
    client.close();
  });

  it("gives up on one request at the caller's budget and calls the outcome unknown, not failed", async () => {
    const daemon = await deafDaemon();
    const client = await connect({ socketPath: daemon.socketPath, replyBudgetMs: 40 });
    const failure = await client.typeText({ id: "el-0123456789ab", text: "hello" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnansweredRequestError);
    expect(isUnansweredRequestError(failure)).toBe(true);
    expect((failure as UnansweredRequestError).method).toBe("typeText");
    expect((failure as UnansweredRequestError).waitedMs).toBe(40);
    // The wording is the contract here: a caller told "failed" resends.
    expect((failure as UnansweredRequestError).message).toMatch(/UNKNOWN/);
    expect((failure as UnansweredRequestError).message).toMatch(/do not resend/);
    expect((failure as UnansweredRequestError).message).not.toMatch(/failed/);
    client.close();
  });

  it("keeps the connection usable: the budget is one request's, not the line's", async () => {
    const daemon = await deafDaemon({
      answer: (request) =>
        request.method === "queryElements" ? { type: "response", id: request.id, result: { elements: [] } } : undefined,
    });
    const client = await connect({ socketPath: daemon.socketPath, replyBudgetMs: 40 });
    await expect(client.typeText({ id: "el-0123456789ab", text: "hello" })).rejects.toBeInstanceOf(
      UnansweredRequestError,
    );
    // The same client, immediately afterwards, on the same socket.
    await expect(client.queryElements({})).resolves.toEqual({ elements: [] });
    client.close();
  });

  it("discards an answer that arrives after the caller gave up, rather than resolving it late", async () => {
    let held: { id: number } | undefined;
    const daemon = await deafDaemon({
      answer: (request) => {
        held = request;
        return undefined;
      },
    });
    const client = await connect({ socketPath: daemon.socketPath, replyBudgetMs: 40 });
    const first = client.readElementContent({ id: "el-0123456789ab", offset: 0, limit: 10 }).catch((error: unknown) => error);
    expect(await first).toBeInstanceOf(UnansweredRequestError);

    // The daemon answers the abandoned request, late. Nothing may come of it:
    // the caller has already been told the outcome is unknown, and a late
    // resolution would contradict that after the fact.
    daemon.reply({ type: "response", id: held?.id, result: { element: { id: "el-0123456789ab" } } });
    await new Promise((resolve) => setTimeout(resolve, 60));
    await expect(client.queryElements({}).catch(() => "still unanswered")).resolves.toBe("still unanswered");
    client.close();
  });

  it("does not report a request answered inside the budget as unanswered", async () => {
    const daemon = await deafDaemon({
      answer: (request) => ({ type: "response", id: request.id, result: { elements: [] } }),
    });
    const client = await connect({ socketPath: daemon.socketPath, replyBudgetMs: 40 });
    await expect(client.queryElements({})).resolves.toEqual({ elements: [] });
    await new Promise((resolve) => setTimeout(resolve, 60));
    client.close();
  });
});
