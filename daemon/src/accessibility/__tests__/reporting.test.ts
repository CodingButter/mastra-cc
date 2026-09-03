import { describe, expect, it } from "vitest";
import { unsupportedPlatform } from "../index.js";
import { accessibilityLayer } from "../linux-atspi.js";
import { selectAccessibilityLayer } from "../select.js";

// WHETHER THE MACHINE CAN BE HEARD (segment 02).
//
// The tests that matter are the three answers, and the third is the reason
// this is a report and not a boolean: a daemon that could not find out must
// say so rather than report the desk switched off. The last test is the seam
// test roadmap P2 asks for - nothing a caller receives may name a bus, a
// protocol, or this platform's accessibility stack.

const enabledBus = async () => [["b"], [true]];
const disabledBus = async () => [["b"], [false]];
const unwrappedBus = async () => true;
const deadBus = async () => {
  throw new Error("could not connect to the session bus");
};

describe("reporting whether this machine's accessibility layer is switched on", () => {
  it("reports enabled when the layer says it is on", async () => {
    expect(await accessibilityLayer(enabledBus).report()).toEqual({ state: "enabled" });
  });

  it("reports disabled when the layer says it is off", async () => {
    // A MEASUREMENT, and it carries no reason: a reason attached to an answer
    // this daemon actually took would be noise, and worse, would blur the one
    // signal that says "I did not find out".
    expect(await accessibilityLayer(disabledBus).report()).toEqual({ state: "disabled" });
  });

  it("reads the answer whether or not the platform wrapped it", async () => {
    // Observed live on this machine: the same read comes back unwrapped or as
    // a signature/value pair. The element backend accepts both and so does
    // this, rather than the shape deciding what the desk is doing.
    expect(await accessibilityLayer(unwrappedBus).report()).toEqual({ state: "enabled" });
  });

  it("says cannot-tell, with a reason, when the layer does not answer", async () => {
    // The failure this segment exists for. Silence and "switched off" look
    // identical from here and are different facts: one is a desk with
    // accessibility off, the other is a daemon that could not reach the thing
    // that would know. Reporting disabled would send an operator to switch on
    // something that was never off.
    const report = await accessibilityLayer(deadBus).report();

    expect(report.state).toBe("cannot-tell");
    expect(report.reason).toBeTruthy();
  });

  it("says cannot-tell when the answer is not readable as yes or no", async () => {
    const report = await accessibilityLayer(async () => [["s"], ["maybe"]]).report();

    expect(report.state).toBe("cannot-tell");
    expect(report.reason).toBeTruthy();
  });

  it("says cannot-tell and names the platform when this build has no adapter for it", async () => {
    // Never disabled: this build has no way to look at that machine, and
    // saying it is off would be an invented fact about a desk it cannot see.
    const report = await selectAccessibilityLayer("darwin").report();

    expect(report.state).toBe("cannot-tell");
    expect(report.reason).toContain("darwin");
  });

  it("picks the implemented adapter on the platform it implements", async () => {
    // Constructing it must not touch a bus - the same laziness the element
    // channel has - so this asserts selection without reading.
    // Comparing the two objects would compare freshly-built closures and pass
    // whatever was returned, so the assertion is on what the choice MEANS: the
    // implemented adapter can act, and the fallback for a platform with no
    // adapter cannot.
    expect(selectAccessibilityLayer("linux").acquirable).toBe(true);
    expect(unsupportedPlatform("linux").acquirable).toBe(false);
    expect((await unsupportedPlatform("linux").report()).state).toBe("cannot-tell");
  });

  it("never lets the platform's vocabulary reach anything a caller receives", async () => {
    // The seam-leakage test (roadmap P2). A caller learns whether the machine
    // can be heard; it never learns which bus was asked, because that is the
    // thing a second platform would answer differently.
    const reports = [
      await accessibilityLayer(enabledBus).report(),
      await accessibilityLayer(disabledBus).report(),
      await accessibilityLayer(deadBus).report(),
      await accessibilityLayer(async () => [["s"], ["maybe"]]).report(),
    ];

    for (const report of reports) {
      const text = JSON.stringify(report).toLowerCase();
      for (const leak of ["at-spi", "atspi", "d-bus", "dbus", "org.a11y", "linux", "gnome", "kde", "x11", "wayland"]) {
        expect(text).not.toContain(leak);
      }
    }
  });
});
