import { describe, expect, it } from "vitest";
import { AttestationFailedError, commitDescription, WriteNotObservedError } from "../backend.js";
import type { Channel } from "../backends/atspi/channel.js";
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

  // A commit is the only verb whose success can destroy what it acted on, and
  // that makes the afterwards-read a different question here than it is for
  // edit or activate. Measured live on this session (proof leg s): DoAction on
  // a dialog's OK button was answered `true` in about a millisecond, and the
  // next read of the same element failed with NoReply - the application had
  // already disconnected from the bus, because committing is what closed it.
  //
  // The first live run of the proof reported that commit as "the desktop could
  // not be read by this session's backend". The commit had landed; the dialog
  // printed the committed form. A caller hearing a refusal for a commit that
  // happened would reasonably commit a second time, which is the one failure
  // this project cannot answer for - it is beyond the machine's ability to take
  // back, by definition.
  it("a commit whose success closes the application is reported as a commit, not as an unreadable desktop", async () => {
    const { backend, elements } = await recordedWorld();
    const describable = elements.find(
      (element) => element.name === "Close" && element.actions.length === 1,
    );
    expect(describable).toBeDefined();

    // The channel answers everything the tape holds until the commit is
    // performed, and refuses every exchange after it - the disappearance of the
    // application, expressed as the only thing the platform actually does when
    // it happens.
    const tape = replayChannel("gtk-dialog");
    let committed = false;
    const dyingChannel: Channel = {
      async call(exchange) {
        if (committed) throw new Error("Message recipient disconnected from message bus without replying");
        if (exchange.member === "DoAction") {
          committed = true;
          return [true];
        }
        return tape.call(exchange);
      },
      watch: (subscribedTo, sink, anchor) => tape.watch(subscribedTo, sink, anchor),
      close: () => tape.close(),
    };

    const dying = new AtspiBackend(dyingChannel, new Set(["yad"]));
    const seen = await dying.queryElements({});
    const target = seen.elements.find(
      (element) => element.name === "Close" && element.actions.length === 1,
    );
    expect(target).toBeDefined();
    const result = await dying.submitElement({
      id: target!.id,
      attestation: "closes the dialog",
    });

    // The commit is reported as one. The element is ABSENT rather than
    // fabricated: the wire allows that (submitElement's element is not
    // required), and echoing the pre-commit element back would be the return
    // value dressed as the read-back this whole seam exists to demand.
    expect(result.element).toBeUndefined();
    expect(committed).toBe(true);
    await dying.close();
    await backend.close();
  });

  // The tolerance above has a cost, and this is the test that keeps it paid
  // for. An omitted element means "committed, and there was nothing left to
  // read". Reading the world back cannot distinguish that from "declined, and
  // the world is exactly as it was", because a decline leaves no trace to read.
  // The platform's own `false` is the only place that fact exists, so it is the
  // one return value this seam consumes - as evidence of REFUSAL, never of
  // success. Two reviewers found this independently.
  it("a commit the application declines is refused, never reported as a commit with nothing left to read", async () => {
    const tape = replayChannel("gtk-dialog");
    let declined = false;
    // Declines the commit, then dies exactly as a closing application would.
    // Every observable signal except the boolean says "committed".
    const decliningChannel: Channel = {
      async call(exchange) {
        if (declined) throw new Error("Message recipient disconnected from message bus without replying");
        if (exchange.member === "DoAction") {
          declined = true;
          return [false];
        }
        return tape.call(exchange);
      },
      watch: (subscribedTo, sink, anchor) => tape.watch(subscribedTo, sink, anchor),
      close: () => tape.close(),
    };

    const declining = new AtspiBackend(decliningChannel, new Set(["yad"]));
    const seen = await declining.queryElements({});
    const target = seen.elements.find(
      (element) => element.name === "Close" && element.actions.length === 1,
    );
    expect(target).toBeDefined();

    const refused = await declining
      .submitElement({ id: target!.id, attestation: "closes the dialog" })
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(WriteNotObservedError);
    expect((refused as Error).message).toContain("declined");
    expect((refused as Error).message).toContain("Close");
    expect(declined).toBe(true);
    await declining.close();
  });
});
