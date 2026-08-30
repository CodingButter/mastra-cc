import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import { registry } from "../backends/registry.js";
import { type Pipe, serveConnection } from "../server.js";

// The protocol front end used to BE the socket callback. It is now one
// function driven through a narrow duplex, so that a second listener can drive
// the same logic instead of copying it. This file is what makes that provable
// without a listener of any kind: a fake pipe, in memory, exercising the
// corners the two real pipes must agree on.
//
// The corners that matter, and why each is here rather than assumed:
//  - the trailing "\n" is part of the payload, not socket framing, so it must
//    survive onto a pipe whose transport has message boundaries of its own;
//  - both hello-gate refusals return MID-BUFFER, abandoning lines already
//    parsed out of the same chunk - a behaviour, not an accident;
//  - a chunk carrying two messages produces two answers, which is the
//    property a per-frame JSON parser would quietly break.

function fakePipe(): Pipe & { written: string[]; ended: boolean; feed(chunk: string): void; drop(): void } {
  let onData: (chunk: string) => void = () => {};
  let onClose: () => void = () => {};
  let closed = false;
  const written: string[] = [];
  return {
    written,
    ended: false,
    write(line) {
      written.push(line);
    },
    end() {
      this.ended = true;
      closed = true;
    },
    get closed() {
      return closed;
    },
    onData(handler) {
      onData = handler;
    },
    onClose(handler) {
      onClose = handler;
    },
    feed(chunk) {
      onData(chunk);
    },
    drop() {
      closed = true;
      onClose();
    },
  };
}

function serve(): ReturnType<typeof fakePipe> {
  const pipe = fakePipe();
  // visibility "all": this file witnesses wire framing, not grant policy
  serveConnection(pipe, { backend: registry.replay({ visibility: "all" }), visibility: "all" });
  return pipe;
}

const hello = `${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`;

describe("one connection handler, driven through a pipe", () => {
  it("answers hello with the digest and version, and keeps the trailing newline on the payload", () => {
    const pipe = serve();
    pipe.feed(hello);
    expect(pipe.written).toHaveLength(1);
    // the newline is part of what the protocol writes, on every pipe
    expect(pipe.written[0].endsWith("\n")).toBe(true);
    expect(JSON.parse(pipe.written[0])).toEqual({ type: "hello", digest: SCHEMA_DIGEST, version: PROTOCOL_VERSION });
  });

  it("refuses a first message that is not hello, with the exact refusal, and ends the connection", () => {
    const pipe = serve();
    pipe.feed(`${JSON.stringify({ type: "request", id: 1, method: "queryElements", params: {} })}\n`);
    expect(pipe.written).toEqual([`${JSON.stringify({ type: "refusal", refusal: "daemon: hello with a schema digest must come first" })}\n`]);
    expect(pipe.ended).toBe(true);
  });

  it("refuses a hello carrying the wrong digest, naming both digests, and ends the connection", () => {
    const pipe = serve();
    pipe.feed(`${JSON.stringify({ type: "hello", digest: "deadbeefcafe" })}\n`);
    expect(pipe.written).toHaveLength(1);
    const parsed = JSON.parse(pipe.written[0]) as { type: string; refusal: string };
    expect(parsed.type).toBe("refusal");
    expect(parsed.refusal).toBe(
      `daemon: refused at connect - this daemon speaks schema digest ${SCHEMA_DIGEST} ` +
        `but the transport was built against schema digest deadbeefcafe (digest-agreement check)`,
    );
    expect(pipe.ended).toBe(true);
  });

  it("abandons the rest of the chunk when the hello gate refuses mid-buffer", () => {
    // The refusal `return`s out of the data handler rather than breaking the
    // loop, so lines already sitting behind it in the same chunk are never
    // seen. That is the behaviour both pipes must share; a WebSocket adapter
    // that drained its buffer differently would diverge here first.
    const pipe = serve();
    pipe.feed(`${JSON.stringify({ type: "hello", digest: "deadbeefcafe" })}\n${hello}`);
    expect(pipe.written).toHaveLength(1);
    expect((JSON.parse(pipe.written[0]) as { type: string }).type).toBe("refusal");
  });

  it("refuses a malformed line after hello and keeps serving", () => {
    const pipe = serve();
    pipe.feed(hello);
    pipe.feed("this is not json\n");
    expect(pipe.written).toHaveLength(2);
    expect((JSON.parse(pipe.written[1]) as { refusal: string }).refusal).toContain("not a JSON line");
    pipe.feed(`${JSON.stringify({ type: "chatter" })}\n`);
    expect((JSON.parse(pipe.written[2]) as { refusal: string }).refusal).toContain('{type:"request", id:number, method:string}');
  });

  it("answers both messages when one chunk carries two, and one message split across chunks once", () => {
    const pipe = serve();
    pipe.feed(`${hello}${JSON.stringify({ type: "chatter" })}\n`);
    expect(pipe.written).toHaveLength(2);
    expect((JSON.parse(pipe.written[0]) as { type: string }).type).toBe("hello");
    expect((JSON.parse(pipe.written[1]) as { type: string }).type).toBe("refusal");

    const halves = serve();
    const line = `${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST })}\n`;
    halves.feed(line.slice(0, 10));
    expect(halves.written).toHaveLength(0);
    halves.feed(line.slice(10));
    expect(halves.written).toHaveLength(1);
    expect((JSON.parse(halves.written[0]) as { type: string }).type).toBe("hello");
  });

  it("routes a real request and answers it on the same pipe", async () => {
    const pipe = serve();
    pipe.feed(hello);
    pipe.feed(`${JSON.stringify({ type: "request", id: 7, method: "queryElements", params: {} })}\n`);
    await vi.waitFor(() => expect(pipe.written).toHaveLength(2));
    const response = JSON.parse(pipe.written[1]) as { id: number; result: { elements: unknown[] } };
    expect(response.id).toBe(7);
    expect(response.result.elements.length).toBeGreaterThan(0);
  });
});
