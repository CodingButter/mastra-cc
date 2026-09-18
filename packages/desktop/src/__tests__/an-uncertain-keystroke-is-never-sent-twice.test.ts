import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AtspiBackend, type Channel, type LaunchContext, OwnershipTable, replayChannel, startServer } from "@mastra-cc/daemon";
import { MastraCC } from "../mastra.js";

// CC-02, the adapter half: "an uncertain first attempt cannot become duplicate
// insertion through adapter retries".
//
// The backend already says, in the diagnostic subtree, that a typed text was
// attempted and not verified (ADR-0098). What that leaves open is the layer
// above it: a tool wrapper that read "unverified" as "failed" and called
// again, or a transport that lost the answer and re-sent the request, would
// put the text into the field twice while every backend test stayed green.
//
// So this drives the REAL AtspiBackend over the recorded GTK dialog tape,
// through a real daemon on a socket, through the real transport and the real
// Mastra tool, and counts keyboard emissions at the D-Bus seam - the one place
// a duplicate would have to show up.

type DaemonServer = Awaited<ReturnType<typeof startServer>>;
const started: DaemonServer[] = [];
const open: MastraCC[] = [];
afterEach(async () => {
  for (const desk of open.splice(0)) await desk.close();
  for (const server of started.splice(0)) await new Promise((r) => server.close(r));
});

/** The recorded dialog, with the keyboard seam counted and focus never confirmed. */
function countingChannel(onEmit?: () => void) {
  const tape = replayChannel("gtk-dialog");
  const generated: unknown[][] = [];
  const channel: Channel = {
    async call(exchange) {
      if (exchange.member === "GenerateKeyboardEvent") {
        generated.push(exchange.body ?? []);
        onEmit?.();
        return [];
      }
      if (exchange.member === "GrabFocus") return [false];
      return tape.call(exchange);
    },
    watch: (subscribedTo, sink, anchor) => tape.watch(subscribedTo, sink, anchor),
    close: () => tape.close(),
  };
  return { channel, generated };
}

async function deskOver(channel: Channel) {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-cc02-")), "daemon.sock");
  const launch: LaunchContext = {
    permits: new Set(),
    allows: new Set(["observe", "rawInput"]),
    keys: { route: "test-route" },
    catalog: {},
    table: new OwnershipTable(),
    visibility: "all",
  };
  started.push(await startServer({ socketPath, backend: new AtspiBackend(channel, new Set(["yad"])), launch }));
  const desk = new MastraCC({ socketPath });
  open.push(desk);
  return desk;
}

async function aButton(desk: MastraCC) {
  const seen = (await desk.getTools().queryElements.execute!({}, {} as never)) as { elements?: { id: string; role: string }[] };
  const button = seen.elements?.find((element) => element.role === "button");
  expect(button, "the recorded dialog has a button to aim at").toBeDefined();
  return button!.id;
}

describe("an uncertain keystroke is never sent twice", () => {
  it("returns the unverified attempt as a result the model reads, after exactly one STRING emission", async () => {
    const seam = countingChannel();
    const desk = await deskOver(seam.channel);
    const id = await aButton(desk);

    const answer = (await desk.getTools().typeText.execute!({ id, text: "example.com" }, {} as never)) as {
      refusal?: string;
      element?: { diagnostic?: Record<string, string> };
    };

    // Not a refusal, not a throw: an element with its doubt written down.
    expect(answer.refusal).toBeUndefined();
    expect(answer.element?.diagnostic?.["mastra-cc/typing-unverified"]).toContain("do not automatically resend");
    // And the whole text went out once, as one STRING synth - the measured route.
    expect(seam.generated).toEqual([[0, "example.com", 4]]);
  });

  it("does not resend when the read-back after the keys went out fails", async () => {
    // The emission succeeded; the re-read that follows it (the one that would
    // have said what became of the text) dies on the bus. The daemon has no
    // result to give, so the caller gets an error - with the text already in
    // the field. This is the one moment a "helpful" retry would type it twice.
    let emitted = false;
    let died = false;
    const seam = countingChannel(() => { emitted = true; });
    const dying: Channel = {
      async call(exchange) {
        // The bus dies for ONE call - the first the re-read makes - and then
        // recovers, so a second attempt would find a working line. That is the
        // point: a retry here must be stopped by there being none, not by the
        // fixture being too broken to permit one.
        if (emitted && !died && exchange.member === "GetRoleName") {
          died = true;
          throw new Error("org.freedesktop.DBus.Error.NoReply: the read-back never came");
        }
        return seam.channel.call(exchange);
      },
      watch: (subscribedTo, sink, anchor) => seam.channel.watch(subscribedTo, sink, anchor),
      close: () => seam.channel.close(),
    };
    const desk = await deskOver(dying);
    const id = await aButton(desk);

    await expect(desk.getTools().typeText.execute!({ id, text: "example.com" }, {} as never)).rejects.toThrow();

    // The doubt is handed to the caller as an error, not resolved by trying
    // again. One emission, and the same dial is still open for the caller to
    // OBSERVE with, which is the next step ADR-0098 prescribes.
    expect(seam.generated).toEqual([[0, "example.com", 4]]);
  });
});
