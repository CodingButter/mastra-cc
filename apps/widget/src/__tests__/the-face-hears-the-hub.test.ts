import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLaneHub } from "@mastra-cc/hub";
import { serveLane, type LaneServer } from "@mastra-cc/transport";
import { applyFrame, connectToHub, INITIAL_FACE_STATE, type HubConnection } from "../hub-connection.js";

// THE FACE HEARS THE HUB - end to end, with the REAL hub and the REAL carrier.
//
// The transport package's own suite tests the wire against a miniature of the
// hub, because that package sits below the hub and cannot import it. This file
// is one layer up and therefore has both, so this is the only place where the
// hub's actual lane behaviour meets the actual socket. The PR #230 guarantee is
// asserted here against `createLaneHub` itself rather than a stand-in.

const dirs: string[] = [];
const servers: LaneServer[] = [];
const clients: HubConnection[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) await server.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function socketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "face-hears-"));
  dirs.push(dir);
  return join(dir, "lane.sock");
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`never happened: ${what}`);
}

async function face(hub: ReturnType<typeof createLaneHub>) {
  const path = socketPath();
  servers.push(await serveLane({ source: hub, socketPath: path }));
  const states: Array<ReturnType<typeof applyFrame>> = [];
  const connection = await connectToHub({ socketPath: path, onState: (state) => states.push(state) });
  clients.push(connection);
  return { states, connection };
}

describe("the face hears the hub", () => {
  it("shows what the hub is doing", async () => {
    const hub = createLaneHub();
    const { states } = await face(hub);

    hub.publish("progress", "reading your mail");
    await until(() => states.length > 0, "the face heard progress");

    expect(states.at(-1)).toEqual({
      ...INITIAL_FACE_STATE,
      visible: true,
      working: true,
      caption: "reading your mail",
    });
  });

  // PR #230, ASSERTED AGAINST THE REAL HUB.
  //
  // A face that starts after a voice session opened must learn the session is
  // open. The edge already fired; nothing will fire it again. A face that
  // ignores the handoff sits in the wrong mode forever, which is the same bug
  // one process over.
  it("learns a voice session is already open when it starts mid-session", async () => {
    const hub = createLaneHub();
    hub.openVoiceSession("a-session-that-began-before-the-face-did");

    const { states } = await face(hub);
    await until(() => states.length > 0, "the late joiner was told the state");

    expect(states.at(-1)?.voiceOpen).toBe(true);
  });

  it("does not believe a session is open when none is", async () => {
    const hub = createLaneHub();
    const { states } = await face(hub);

    hub.publish("answer", "your inbox is empty");
    await until(() => states.length > 0, "the face heard an answer");

    expect(states.at(-1)?.voiceOpen).toBe(false);
  });

  it("stops showing work in progress once the answer arrives", async () => {
    const hub = createLaneHub();
    const { states } = await face(hub);

    hub.publish("progress", "looking");
    await until(() => states.length > 0, "progress arrived");
    hub.publish("answer", "found it");
    await until(() => states.length > 1, "the answer arrived");

    expect(states.at(-1)).toEqual({
      ...INITIAL_FACE_STATE,
      visible: true,
      caption: "found it",
    });
  });

  it("is hung up on by the hub when it stops answering", async () => {
    const hub = createLaneHub();
    const { connection } = await face(hub);
    await connection.close();

    hub.sweep();
    hub.sweep();

    // Nothing is delivered to a hung-up peer: publishing after the sweep
    // reaches no one, which is the observable form of the hang-up from here.
    expect(() => hub.publish("progress", "anyone there?")).not.toThrow();
  });

  it("says the hub is absent rather than blaming the face", async () => {
    const path = socketPath();
    await expect(connectToHub({ socketPath: path, onState: () => {} })).rejects.toThrow(
      /no hub is listening/,
    );
  });

  it("applies each event in the vocabulary and invents no state of its own", () => {
    expect(applyFrame(INITIAL_FACE_STATE, { event: "progress", detail: "a" })).toEqual({
      ...INITIAL_FACE_STATE,
      visible: true,
      working: true,
      caption: "a",
    });
    expect(applyFrame(INITIAL_FACE_STATE, { event: "answer", detail: "b" })).toEqual({
      ...INITIAL_FACE_STATE,
      visible: true,
      caption: "b",
    });
    expect(applyFrame(INITIAL_FACE_STATE, { event: "voice_opened" })).toEqual({
      ...INITIAL_FACE_STATE,
      voiceOpen: true,
      microphoneGateOpen: true,
    });
    expect(
      applyFrame(
        { ...INITIAL_FACE_STATE, voiceOpen: true, microphoneGateOpen: true },
        { event: "voice_closed" },
      ),
    ).toEqual(INITIAL_FACE_STATE);
  });

  // B5's GUARANTEE, ASSERTED IN THE CONSUMER (ADR-0052's recorded cost).
  //
  // The pin says no socket implementation lives outside `packages/transport`.
  // It cannot say that a package importing that transport for one wire declines
  // to use the other, and this widget now imports it. So the second half is
  // here: the widget names neither daemon entry point.
  it("reaches the hub and never the daemon", () => {
    const sources = readSources(join(import.meta.dirname, ".."));
    expect(sources.length).toBeGreaterThan(0);

    const reaching = sources.filter(
      ([, text]) => /\bconnect\s*\(/.test(text) || /defaultSocketPath/.test(text),
    );
    expect(reaching.map(([name]) => name)).toEqual([]);
  });

  // ADR-0041, AND A HAZARD THIS FILE INTRODUCED.
  //
  // The end-to-end cases above need the real hub, so `@mastra-cc/hub` is now a
  // DEVELOPMENT dependency of this package - which means a shipped source file
  // could import it and the build would be perfectly happy. An agent in the
  // client is exactly what ADR-0041 forbids: "every agent runs in the hub; a
  // client carries a microphone, a speaker, pixels and a socket, and nothing
  // else". A dependency that only tests can use is a rule nothing enforces, so
  // this is the enforcement.
  it("carries no agent: no shipped source imports the hub", () => {
    const sources = readSources(join(import.meta.dirname, ".."));
    expect(sources.length).toBeGreaterThan(0);

    const importing = sources.filter(([, text]) => /@mastra-cc\/hub/.test(text));
    expect(importing.map(([name]) => name)).toEqual([]);
  });

  it("replays the current face state after the renderer starts listening", () => {
    const source = join(import.meta.dirname, "..");
    const preload = readFileSync(join(source, "preload.cjs"), "utf8");
    const main = readFileSync(join(source, "main.ts"), "utf8");

    expect(preload).toMatch(/ipcRenderer\.on\("face:state"[\s\S]*ipcRenderer\.send\("face:ready"\)/);
    expect(main).toMatch(/ipcMain\.on\("face:ready"[\s\S]*render\(state\)/);
  });
});

/** Every shipped source file in the widget, comments stripped, tests excluded. */
function readSources(dir: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...readSources(path));
      continue;
    }
    if (!/\.(ts|js|mjs)$/.test(entry)) continue;
    const text = readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    found.push([entry, text]);
  }
  return found;
}
