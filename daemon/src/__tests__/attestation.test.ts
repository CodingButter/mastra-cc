import { describe, expect, it } from "vitest";
import { AttestationFailedError, commitDescription } from "../backend.js";
import { AtspiBackend } from "../backends/atspi/index.js";
import { replayChannel } from "../backends/replay/index.js";

// ATTESTATION_FAILED: the daemon refuses to commit what it cannot describe
// (ADR-0008 rule 2, ADR-0021, docs/07-ROADMAP.md:157).
//
// The check under test is the DAEMON'S, not the caller's. A caller's
// attestation is their restatement of the commit, and the daemon has no way to
// tell a true restatement from a plausible one - so a check of the caller's
// sentence would be theatre. What the daemon can honestly ask is whether IT can
// say what the commit would do, and that question has a real answer either way:
// it reads the element as it stands and looks for a name and a single verb.
//
// Driven against the recorded world rather than a hand-built element, through
// the PERFORMING class over a recorded channel (AtspiBackend + replayChannel),
// because a test that constructed its own element would be asserting against a
// fiction of its own making. The tape's GTK dialog happens to contain both
// shapes - buttons that name themselves and publish exactly one verb, and
// unnamed generic containers that publish none - which is why both sides of
// this check are testable at all.

async function recordedWorld() {
  const backend = new AtspiBackend(replayChannel("gtk-dialog"), new Set(["yad"]));
  const { elements } = await backend.queryElements({});
  return { backend, elements };
}

describe("the daemon refuses to commit what it cannot describe", () => {
  it("describes a commit on an element that names itself and publishes one verb", async () => {
    const { backend, elements } = await recordedWorld();
    const describable = elements.find(
      (element) => element.name === "Close" && element.actions.length === 1,
    );
    expect(describable, "the recorded world has no named single-verb element - a re-capture failed").toBeDefined();

    // The positive case is what makes the refusals below mean something: a
    // check that failed on everything would satisfy every negative assertion
    // in this file and describe nothing.
    const description = commitDescription(describable!);
    expect(description).toContain("Close");
    expect(description).toContain(describable!.actions[0]!.name);
    await backend.close();
  });

  it("refuses a commit on an element publishing no verb, naming the check and what would change it", async () => {
    const { backend, elements } = await recordedWorld();
    const verbless = elements.find((element) => element.name !== "" && element.actions.length === 0);
    expect(verbless, "the recorded world has no named verbless element - a re-capture failed").toBeDefined();

    const failure = (() => {
      try {
        return commitDescription(verbless!);
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(AttestationFailedError);
    const message = (failure as Error).message;
    // Names the check that ran, and what would change the answer - the shape
    // every refusal on this wire owes its caller.
    expect(message).toContain("attestation check");
    expect(message).toContain("no verb to perform");
    expect(message).toContain("publishing exactly one verb");
    await backend.close();
  });

  it("refuses a commit on a nameless element, because a description naming nothing is not reviewable", async () => {
    const { backend, elements } = await recordedWorld();
    const nameless = elements.find((element) => element.name === "");
    expect(nameless, "the recorded world has no nameless element - a re-capture failed").toBeDefined();

    const failure = (() => {
      try {
        return commitDescription(nameless!);
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(AttestationFailedError);
    expect((failure as Error).message).toContain("publishes no name");
    await backend.close();
  });

  it("refuses when several verbs are published, because which one commits would be a guess", () => {
    // The one shape the recorded GTK dialog does not contain: every element in
    // it publishes zero or one action. Constructed here deliberately and
    // narrowly - the input is two action names, which is the entire condition
    // under test - because the alternative is leaving the branch that matters
    // most untested. Approving a guess is worse than refusing outright, and
    // this is the branch that refuses the guess.
    const failure = (() => {
      try {
        return commitDescription({ name: "Send", actions: [{ name: "click" }, { name: "showContextMenu" }] });
      } catch (error) {
        return error;
      }
    })();

    expect(failure).toBeInstanceOf(AttestationFailedError);
    const message = (failure as Error).message;
    expect(message).toContain("Send");
    expect(message).toContain("2 verbs");
    expect(message).toContain("would be a guess");
    // Both verbs are named: a refusal that hid what it saw would leave the
    // caller unable to act on it.
    expect(message).toContain("click");
    expect(message).toContain("showContextMenu");
  });

  it("submitElement refuses a commit it cannot describe, and the refusal reaches the caller as one", async () => {
    // End to end through the verb, on the performing class: the refusal is not
    // a property of commitDescription being called somewhere, it is what the
    // caller hears when they ask to commit on an element the daemon cannot
    // describe. Nothing is performed - the tape holds no answer for a write, so
    // reaching one would fail differently and loudly.
    const { backend, elements } = await recordedWorld();
    const undescribable = elements.find((element) => element.name === "" && element.actions.length === 0);
    expect(undescribable).toBeDefined();

    const failure = await backend
      .submitElement({ id: undescribable!.id, attestation: "sends the message" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AttestationFailedError);
    await backend.close();
  });

  it("the caller's attestation is never what is judged - a perfect one does not rescue an undescribable commit", async () => {
    // The inverse mistake, pinned: a daemon that validated the caller's
    // sentence would let a confident string through and refuse a hesitant one,
    // which is a check on prose rather than on the commit. Two attestations,
    // one careful and one empty, get the same answer, because neither is the
    // check that runs.
    const { backend, elements } = await recordedWorld();
    const undescribable = elements.find((element) => element.name === "" && element.actions.length === 0);

    const careful = await backend
      .submitElement({ id: undescribable!.id, attestation: "commits the order for 24 units at the quoted price" })
      .catch((error: unknown) => error);
    const empty = await backend
      .submitElement({ id: undescribable!.id, attestation: "" })
      .catch((error: unknown) => error);

    expect(careful).toBeInstanceOf(AttestationFailedError);
    expect(empty).toBeInstanceOf(AttestationFailedError);
    expect((careful as Error).message).toBe((empty as Error).message);
    await backend.close();
  });
});
