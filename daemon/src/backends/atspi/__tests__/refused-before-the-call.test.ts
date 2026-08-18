import { describe, expect, it } from "vitest";
import type { Backend } from "../../../backend.js";
import { MagnitudeOutOfRangeError, RecordingNotPerformableError, UnpublishedActionError } from "../../../backend.js";
import { ReplayBackend, replayChannel } from "../../replay/index.js";
import { AtspiBackend } from "../index.js";

// Two refusals that reach their answer WITHOUT performing anything, tested
// against the recorded world rather than a scripted one. That is what makes
// them testable here at all: the tape can answer every question these checks
// ask - which interfaces an element carries, what it names its actions, what
// bounds it published - and the refusal lands before any write would.
//
// The numbers below are the ones the tape recorded from a real GTK dialog: a
// slider publishing 0 to 100. Nothing here invents a range.

async function recordedWorld() {
  const backend = new AtspiBackend(replayChannel("gtk-dialog"), new Set(["yad"]));
  const { elements } = await backend.queryElements({});
  return { backend, elements };
}

describe("a verb refused before the call never touches the element", () => {
  it("refuses an action the element does not publish, naming what it does publish", async () => {
    const { backend, elements } = await recordedWorld();
    const target = elements.find((element) => element.actions.some((action) => action.name === "click"));
    expect(target, "the recorded world publishes no action - a re-capture failed").toBeDefined();

    const failure = await backend
      .activateElement({ id: target!.id, action: "press" })
      .catch((error: unknown) => error);

    // "press" is the deleted table's word. It is not a synonym for "click"
    // here, because nothing in this daemon is allowed to decide that two names
    // mean the same thing (ADR-0045 clause 2).
    expect(failure).toBeInstanceOf(UnpublishedActionError);
    // The refusal names the check that ran: the element's own published list.
    expect((failure as Error).message).toContain("click");
    await backend.close();
  });

  it("refuses a magnitude outside the range the tape recorded, before writing anything", async () => {
    const { backend, elements } = await recordedWorld();
    const withRange = elements.find((element) =>
      (element.operations ?? []).some((operation) => operation.range !== undefined),
    );
    expect(withRange, "the recorded world publishes no range - a re-capture failed").toBeDefined();
    const recorded = (withRange!.operations ?? []).find((operation) => operation.operation === "setValue")?.range;
    expect(recorded).toEqual({ minimum: 0, maximum: 100, current: 0, step: 1 });

    // 60 would be a perfectly ordinary "sixty percent" on a 0..1 slider, and is
    // inside this one's range. The refusal has to come from the range the
    // ELEMENT published, not from a unit the daemon assumed.
    const failure = await backend
      .setElementValue({ id: withRange!.id, value: recorded!.maximum + 1 })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MagnitudeOutOfRangeError);
    expect((failure as Error).message).toContain("100");

    // Non-vacuity: a check that refused everything would satisfy the assertion
    // above. 60 is inside this element's published range - a number that would
    // read as "sixty percent" on a 0..1 slider and is an ordinary value here -
    // so it passes the bounds check and reaches for the platform. It fails
    // beyond that point, because a recording holds no answer for a write, and
    // failing THERE is the proof that the range check let it through.
    const allowed = await backend
      .setElementValue({ id: withRange!.id, value: 60 })
      .catch((error: unknown) => error);
    expect(allowed).not.toBeInstanceOf(MagnitudeOutOfRangeError);
    await backend.close();
  });

  it("still refuses to PERFORM on a recording, so nothing above mistakes a refusal for a relaxation", async () => {
    // The fake-channel tests in effects.test.ts drive real backend logic with
    // scripted replies. This is the guard that they did not quietly become a
    // licence for the replay route to act: a recording answers questions and
    // performs nothing, by name.
    // Held as the seam type on purpose: the promise being tested is the one the
    // interface makes to every caller, not one this class happens to keep.
    const backend: Backend = new ReplayBackend("gtk-dialog", new Set(["yad"]));
    const { elements } = await backend.queryElements({});
    expect(elements.length).toBeGreaterThan(0);

    await expect(backend.editElement({ id: elements[0].id, value: "typed" })).rejects.toBeInstanceOf(
      RecordingNotPerformableError,
    );
    await expect(backend.activateElement({ id: elements[0].id, action: "click" })).rejects.toBeInstanceOf(
      RecordingNotPerformableError,
    );
    await backend.close();
  });
});
