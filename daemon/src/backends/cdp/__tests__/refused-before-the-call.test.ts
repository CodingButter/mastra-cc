import { describe, expect, it } from "vitest";
import type { Backend } from "../../../backend.js";
import { RecordingNotPerformableError, UnperformableElementError } from "../../../backend.js";
import { replayCdpChannel } from "../channel.js";
import { CdpBackend, CdpReplayBackend } from "../index.js";

// The browser route's refusals, over the recorded chrome-page world. Nothing
// here performs anything: these are the answers that arrive BEFORE any call
// reaches a page, which is the only place a refusal can be honest about a
// value that was never written.
const recordedWorld = (): Backend => new CdpReplayBackend("chrome-page", "all");

// The PERFORMING class over the recorded channel. The replay flavour refuses as
// a tape before it resolves anything - correctly, and asserted below - so it
// cannot be the instrument for testing id resolution. This is the class that
// performs, reading the same recorded world.
const performingOverARecording = (): Backend => new CdpBackend(replayCdpChannel("chrome-page"), "all");

describe("the browser route refuses before it acts", () => {
  it("refuses an id it never answered without saying whether such an element exists", async () => {
    const backend = performingOverARecording();
    const { elements } = await backend.queryElements({});
    expect(elements.length).toBeGreaterThan(0);

    // Two ids this backend never answered: one shaped like an element that
    // could plausibly exist, one that could not. Both are refused the same
    // way - a refusal that varied between them would be an existence oracle
    // (ADR-0008 rule 6, ADR-0036).
    const never = backend.editElement({ id: "el-000000000000", value: "x" });
    const alsoNever = backend.editElement({ id: "el-ffffffffffff", value: "x" });
    const [first, second] = await Promise.allSettled([never, alsoNever]);

    expect(first.status).toBe("rejected");
    expect(second.status).toBe("rejected");
    expect((first as PromiseRejectedResult).reason).toBeInstanceOf(UnperformableElementError);
    const message = (settled: PromiseSettledResult<unknown>) =>
      settled.status === "rejected" ? String((settled.reason as Error).message).replace(/el-[0-9a-f]{12}/, "<id>") : "";
    expect(message(first)).toBe(message(second));

    await backend.close();
  });
});

// The performing-side twin of `replay-invents-a-reply-for-an-unrecorded-
// exchange`, stated by name so the scripted-channel tests in effects.test.ts
// can never be mistaken for a relaxation of this. The live browser route CAN
// perform now; a recording of it still cannot.
describe("a recording of a browser still refuses to be acted upon", () => {
  it("refuses every verb as a recording, before it resolves the element", async () => {
    const backend = recordedWorld();
    const { elements } = await backend.queryElements({});
    const id = elements[0].id;

    // The id is one this backend DID answer, so a refusal here cannot be about
    // an unknown element. It is about the tape.
    await expect(backend.editElement({ id, value: "x" })).rejects.toBeInstanceOf(RecordingNotPerformableError);
    await expect(backend.activateElement({ id, action: "focus" })).rejects.toBeInstanceOf(RecordingNotPerformableError);
    await expect(backend.revealElement({ id })).rejects.toBeInstanceOf(RecordingNotPerformableError);
    await expect(backend.editElement({ id, value: "x" })).rejects.not.toBeInstanceOf(UnperformableElementError);

    await backend.close();
  });
});
