// A PRESS AIMED FROM AN OLD PICTURE (ADR-0107).
//
// A caller who looks at a picture and chooses a fraction inside it is aiming
// at the desk AS IT WAS when the picture was taken. The press itself goes to
// the element's freshly read rectangle, which is right - but the FRACTION was
// chosen against the old rectangle, and if the desk has moved in between the
// press lands on whatever now sits where the caller was looking. This is the
// staleness CC-07 asks the daemon to refuse rather than paper over.
//
// The caller names the picture by its capturedAt. The daemon checks two things
// before anything is sent: that this is the LATEST picture it answered for the
// element (a newer one means the caller is aiming from something already
// superseded), and that the element still sits in the rectangle the picture
// was cropped from. Each refusal says which, and a capturedAt the daemon never
// answered is refused too - a claim the daemon cannot check is not a claim.
// A press that names no picture is exactly what it was before: aimed from the
// fresh rectangle, with no promise about any picture.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "../backends/atspi/channel.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { replayChannel } from "../backends/replay/index.js";
import { PointerBlockedError, UnperformableElementError } from "../backend.js";

// Replace only the external executables. xwd answers a 200x200 blue desk at
// the origin; xwininfo answers a display large enough to hold it. Everything
// between - the crop, the encode, the geometry checks - is production code.
const tools = mkdtempSync(join(tmpdir(), "stale-picture-"));
function dump(width: number, height: number): Buffer {
  const header = Buffer.alloc(100);
  const words = [100, 7, 2, 24, width, height, 0, 0, 32, 0, 32, 32, width * 4, 4, 0xff0000, 0xff00, 0xff, 8, 256, 0, width, height, 0, 0, 0];
  words.forEach((word, index) => header.writeUInt32BE(word >>> 0, index * 4));
  return Buffer.concat([header, Buffer.alloc(width * height * 4, 0x40)]);
}
beforeEach(() => {
  writeFileSync(join(tools, "desk.xwd"), dump(200, 200));
  writeFileSync(join(tools, "xwd"), `#!/bin/sh\ncat "${join(tools, "desk.xwd")}"\n`, { mode: 0o700 });
  writeFileSync(
    join(tools, "xwininfo"),
    '#!/bin/sh\nprintf "  Absolute upper-left X: 0\\n  Absolute upper-left Y: 0\\n  Width: 1024\\n  Height: 768\\n"\n',
    { mode: 0o700 },
  );
  vi.stubEnv("PATH", `${tools}:${process.env.PATH ?? ""}`);
  vi.stubEnv("DISPLAY", ":stale-picture-test");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => rmSync(tools, { recursive: true, force: true }));

// A desk whose one element sits where the test says, and can be moved.
function deskAt(initial: [number, number, number, number]) {
  const tape = replayChannel("gtk-dialog");
  const presses: Array<{ x: number; y: number }> = [];
  let published = initial;
  const channel: Channel = {
    async call(exchange) {
      if (exchange.member === "GrabFocus") return [true];
      if (exchange.member === "GenerateMouseEvent") {
        const body = exchange.body as unknown[];
        presses.push({ x: Number(body[0]), y: Number(body[1]) });
        return [];
      }
      if (exchange.member === "ScrollTo") return [];
      if (exchange.member === "GetExtents") return [published];
      return tape.call(exchange);
    },
    watch: (subscribedTo, sink, anchor) => tape.watch(subscribedTo, sink, anchor),
    close: () => tape.close(),
  };
  return {
    backend: new AtspiBackend(channel, "all"),
    presses,
    moveTo(rectangle: [number, number, number, number]) {
      published = rectangle;
    },
  };
}

async function aPicture(backend: AtspiBackend, id: string): Promise<number> {
  const { image } = await backend.captureElement({ id });
  expect(image, "the backend answered no picture").toBeDefined();
  return (image as { capturedAt: number }).capturedAt;
}

async function anElement(backend: AtspiBackend): Promise<string> {
  const { elements } = await backend.queryElements({ role: "label" });
  const found = elements[0]?.id;
  expect(found, "the tape stopped answering with an element to aim at").toBeDefined();
  return found as string;
}

describe("a press that names the picture it was aimed from", () => {
  it("is sent when the picture is the latest and the element has not moved", async () => {
    const desk = deskAt([10, 20, 40, 30]);
    const id = await anElement(desk.backend);
    const capturedAt = await aPicture(desk.backend, id);
    await desk.backend.clickElement({ id, capturedAt, x: 0, y: 0 });
    expect(desk.presses).toEqual([{ x: 10, y: 20 }]);
  });

  it("is refused, and nothing sent, when the element moved since the picture", async () => {
    const desk = deskAt([10, 20, 40, 30]);
    const id = await anElement(desk.backend);
    const capturedAt = await aPicture(desk.backend, id);
    desk.moveTo([60, 20, 40, 30]);
    await expect(desk.backend.clickElement({ id, capturedAt })).rejects.toSatisfy(
      (error: unknown) => error instanceof PointerBlockedError && /moved under the picture/.test((error as Error).message),
    );
    expect(desk.presses).toEqual([]);
  });

  it("is refused, and nothing sent, when the element has been re-photographed since", async () => {
    const desk = deskAt([10, 20, 40, 30]);
    const id = await anElement(desk.backend);
    const first = await aPicture(desk.backend, id);
    // A second look, deliberately after the clock has moved on.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await aPicture(desk.backend, id);
    expect(second).toBeGreaterThan(first);
    await expect(desk.backend.clickElement({ id, capturedAt: first })).rejects.toSatisfy(
      (error: unknown) => error instanceof PointerBlockedError && /re-photographed/.test((error as Error).message),
    );
    expect(desk.presses).toEqual([]);
    // The newest picture still aims.
    await desk.backend.clickElement({ id, capturedAt: second });
    expect(desk.presses).toHaveLength(1);
  });

  it("is refused when it names a picture this daemon never answered", async () => {
    const desk = deskAt([10, 20, 40, 30]);
    const id = await anElement(desk.backend);
    await expect(desk.backend.clickElement({ id, capturedAt: 1234 })).rejects.toSatisfy(
      (error: unknown) => error instanceof PointerBlockedError && /no picture/.test((error as Error).message),
    );
    await expect(desk.backend.clickElement({ id, capturedAt: Number.NaN })).rejects.toBeInstanceOf(UnperformableElementError);
    expect(desk.presses).toEqual([]);
  });

  it("names no picture and is aimed from the fresh rectangle, as before", async () => {
    const desk = deskAt([10, 20, 40, 30]);
    const id = await anElement(desk.backend);
    await desk.backend.captureElement({ id });
    desk.moveTo([60, 20, 40, 30]);
    await desk.backend.clickElement({ id });
    expect(desk.presses).toEqual([{ x: 80, y: 35 }]);
  });
});
