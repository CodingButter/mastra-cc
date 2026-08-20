import { describe, expect, it } from "vitest";
import { UnperformableElementError, WriteNotObservedError } from "../../../backend.js";
import type { Channel } from "../channel.js";
import { replayChannel } from "../../replay/index.js";
import { AtspiBackend } from "../index.js";

// The contract that separates this seam from one that reports its own wishes:
// an effect verb answers with the element AS IT READS AFTERWARDS. Not the
// caller's input reflected back, not a cached snapshot from the walk - a fresh
// read of the tree.
//
// The world is the recorded gtk-dialog tape (a real GTK dialog over the
// accessibility bus). Only the WRITE half is scripted, at the Channel seam: a
// tape holds no answer for an exchange nobody recorded, and the do-not list
// forbids hand-authoring one. Everything the assertions look at comes from the
// recording.

function writableTape(onWrite: (member: string) => void) {
  const recorded = replayChannel("gtk-dialog");
  return {
    ...recorded,
    async call(exchange: Parameters<typeof recorded.call>[0]) {
      if (exchange.member === "SetTextContents" || exchange.member === "DoAction") {
        onWrite(exchange.member);
        return [true];
      }
      return recorded.call(exchange);
    },
  };
}

describe("an effect verb answers with what it read afterwards", () => {
  it("returns a re-read of the element, not the caller's input echoed back", async () => {
    const written: string[] = [];
    const backend = new AtspiBackend(writableTape((member) => written.push(member)), "all");
    const { elements } = await backend.queryElements({});
    // The recorded world's action-publishing elements: buttons that answered
    // "click" per index. Nothing on this tape publishes an editable-text
    // interface, so this is the verb the world supports - the alternative is
    // asserting against a world that was never recorded.
    const target = elements.find((element) => element.actions.some((action) => action.name === "click"));
    expect(target, "the recorded world publishes no action - a re-capture failed").toBeDefined();

    const result = await backend.activateElement({ id: target!.id, action: "click" });

    expect(written, "the action never reached the platform").toContain("DoAction");
    // The answer is the element as the tree reads afterwards, under the id the
    // walk gave it. A backend echoing its input would report a world where
    // every verb always succeeded.
    expect(result.element?.id).toBe(target!.id);
    expect(result.element?.name).toBe(target!.name);
    expect(result.element?.actions.map((action) => action.name)).toEqual(["click"]);
    await backend.close();
  });

  // A re-read is evidence that the world is as it now stands - it is not
  // evidence that this call changed it. When the application DECLINES the
  // action, nothing happened, and the world therefore reads exactly as it did
  // before: the re-read comes back full and healthy and says nothing at all
  // about the verb. The platform's own `false` is the only place that fact
  // exists, which is why performAction carries it out as evidence of REFUSAL.
  // This is the same reasoning submitElement already applies (attestation.test
  // .ts) - an activate is not exempt from it.
  it("refuses an action the application declined, rather than answering with a re-read that shows nothing happened", async () => {
    const recorded = replayChannel("gtk-dialog");
    // Declines the action and stays alive: every observable signal except the
    // boolean is indistinguishable from a clean success.
    const decliningChannel: Channel = {
      async call(exchange) {
        if (exchange.member === "DoAction") return [false];
        return recorded.call(exchange);
      },
      watch: (subscribedTo, sink, anchor) => recorded.watch(subscribedTo, sink, anchor),
      close: () => recorded.close(),
    };

    const backend = new AtspiBackend(decliningChannel, "all");
    const { elements } = await backend.queryElements({});
    const target = elements.find((element) => element.actions.some((action) => action.name === "click"));
    expect(target, "the recorded world publishes no action - a re-capture failed").toBeDefined();

    await expect(backend.activateElement({ id: target!.id, action: "click" })).rejects.toThrow(
      WriteNotObservedError,
    );
    // The refusal names the verb the application declined, so the caller is
    // told which of its own words was turned down.
    await expect(backend.activateElement({ id: target!.id, action: "click" })).rejects.toThrow(/"click"/);
    await backend.close();
  });

  it("refuses an id it never answered, rather than performing against a guess", async () => {
    const backend = new AtspiBackend(writableTape(() => undefined), "all");
    await backend.queryElements({});

    await expect(backend.editElement({ id: "el-000000000000", value: "x" })).rejects.toBeInstanceOf(
      UnperformableElementError,
    );
    await backend.close();
  });
});
