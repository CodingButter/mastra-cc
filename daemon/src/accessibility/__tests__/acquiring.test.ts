import { describe, expect, it } from "vitest";
import { accessibilityLayer } from "../linux-atspi.js";
import { unsupportedPlatform } from "../index.js";

// ACQUIRING THE LAYER, at the adapter level (segment 02, phase 2). The gates
// that decide WHETHER an acquire may happen live in the server and are tested
// there; what is tested here is the adapter's half - that it writes through the
// same status object it reads, that a refused write surfaces rather than being
// swallowed, and that a platform with no adapter is not acquirable at all.

function scriptedLayer(options: { writable: boolean; refuses?: string }) {
  let enabled = false;
  const writes: Array<[string, boolean]> = [];
  const layer = accessibilityLayer(
    async () => enabled,
    async (property, value) => {
      writes.push([property, value]);
      if (!options.writable) throw new Error("this session's status object is read-only");
      if (property === options.refuses) throw new Error(`this session's status object refuses ${property}`);
      if (property === "IsEnabled") enabled = value;
    },
  );
  return { layer, writes };
}

describe("acquiring this machine's accessibility layer", () => {
  it("switches the layer on, and the state that follows is the one it re-read", async () => {
    const { layer, writes } = scriptedLayer({ writable: true });
    expect(await layer.report()).toEqual({ state: "disabled" });
    await layer.acquire();
    // Both properties, in this order. The second one is what makes a browser
    // publish its page; see the acquire() comment and ADR-0075.
    expect(writes).toEqual([
      ["IsEnabled", true],
      ["ScreenReaderEnabled", true],
    ]);
    // The measurement, taken after the fact. acquire() returns nothing on
    // purpose: a route that reported its own intention would say "enabled"
    // about a machine that ignored the write.
    expect(await layer.report()).toEqual({ state: "enabled" });
  });

  it("surfaces a write the machine refused instead of reporting success", async () => {
    const { layer } = scriptedLayer({ writable: false });
    await expect(layer.acquire()).rejects.toThrow();
    // And the desk is where it was. This is the case that makes the re-read
    // load-bearing rather than ceremonial.
    expect(await layer.report()).toEqual({ state: "disabled" });
  });

  it("refuses a desk that took the layer but not the screen reader, rather than half-acquiring it", async () => {
    // The dangerous machine: the first write lands, the second does not. Such
    // a desk answers "enabled" and shows a browser's windows with nothing
    // inside them. The throw is the only thing between an operator and a
    // desk that looks working and is blind wherever it matters most.
    const { layer, writes } = scriptedLayer({ writable: true, refuses: "ScreenReaderEnabled" });
    await expect(layer.acquire()).rejects.toThrow();
    expect(writes).toEqual([
      ["IsEnabled", true],
      ["ScreenReaderEnabled", true],
    ]);
  });

  it("never reaches the screen reader property when the layer itself refused", async () => {
    const { layer, writes } = scriptedLayer({ writable: false });
    await expect(layer.acquire()).rejects.toThrow();
    expect(writes).toEqual([["IsEnabled", true]]);
  });

  it("is not acquirable at all on a platform this build has no adapter for", async () => {
    const layer = unsupportedPlatform("darwin");
    expect(layer.acquirable).toBe(false);
    // The flag is what the server reads to choose not-exposed over
    // disabled-by-configuration: no setting on this machine would help.
    await expect(layer.acquire()).rejects.toThrow();
  });

  it("says the implemented platform can be acquired", async () => {
    expect(accessibilityLayer(async () => true).acquirable).toBe(true);
  });
});
