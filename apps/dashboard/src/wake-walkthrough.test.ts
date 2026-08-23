import { describe, expect, it } from "vitest";

import { advanceWakeWalkthrough, initialWakeWalkthrough } from "./wake-walkthrough.js";

function capture(state = initialWakeWalkthrough, takeId = "take-1") {
  state = advanceWakeWalkthrough(state, { type: "start" });
  state = advanceWakeWalkthrough(state, { type: "cue-complete" });
  state = advanceWakeWalkthrough(state, { type: "countdown-complete" });
  return advanceWakeWalkthrough(state, { type: "capture-complete", takeId });
}

describe("wake enrolment walkthrough", () => {
  it("requires the audible cue before capture", () => {
    const started = advanceWakeWalkthrough(initialWakeWalkthrough, { type: "start" });
    expect(started.phase).toBe("cue");
    expect(advanceWakeWalkthrough(started, { type: "countdown-complete" })).toBe(started);
  });

  it("auto-advances through exactly five takes", () => {
    let state = initialWakeWalkthrough;
    for (let slot = 0; slot < 5; slot += 1) state = capture(state, `take-${slot + 1}`);
    expect(state.phase).toBe("ready");
    expect(state.takes.map((take) => take.takeId)).toEqual(["take-1", "take-2", "take-3", "take-4", "take-5"]);
  });

  it("re-records only the selected slot with a new immutable take id", () => {
    let state = initialWakeWalkthrough;
    for (let slot = 0; slot < 5; slot += 1) state = capture(state, `take-${slot + 1}`);
    state = advanceWakeWalkthrough(state, { type: "rerecord", slot: 2 });
    state = advanceWakeWalkthrough(state, { type: "cue-complete" });
    state = advanceWakeWalkthrough(state, { type: "countdown-complete" });
    state = advanceWakeWalkthrough(state, { type: "capture-complete", takeId: "take-6" });
    expect(state.takes.map((take) => take.takeId)).toEqual(["take-1", "take-2", "take-6", "take-4", "take-5"]);
  });

  it("resets every take and publishes only five valid takes", () => {
    expect(advanceWakeWalkthrough(initialWakeWalkthrough, { type: "publish" })).toBe(initialWakeWalkthrough);
    const reset = advanceWakeWalkthrough(capture(), { type: "reset" });
    expect(reset).toEqual(initialWakeWalkthrough);
  });

  it("records the published template revision", () => {
    let state = initialWakeWalkthrough;
    for (let slot = 0; slot < 5; slot += 1) state = capture(state, `take-${slot + 1}`);
    state = advanceWakeWalkthrough(state, { type: "publish" });
    state = advanceWakeWalkthrough(state, { type: "published", revision: 7 });
    expect(state).toMatchObject({ phase: "complete", revision: 7 });
  });
});
