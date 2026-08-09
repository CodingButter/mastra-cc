import { describe, expect, it } from "vitest";
import { replayChannel } from "../index.js";

// An unrecorded read refuses, naming the key it could not find - the same
// refuse-on-ignorance the real backend applies to a missing element. Replay
// must never invent an answer.
//
// Note the shape of "unrecorded" here: the walk's exchanges are query-
// independent (the same tree is enumerated whatever name is asked for), so a
// query string alone can never leave the tape. What leaves the tape is a
// CHANGED READER - a code change that issues a new exchange - and that is
// exactly when a loud refusal beats a quietly invented reply.

describe("the replay channel refuses what the tape never recorded", () => {
  it("refuses an off-tape exchange and names the missing key", async () => {
    const channel = replayChannel("gtk-dialog");
    await expect(
      channel.call({
        destination: ":1.999",
        path: "/org/a11y/atspi/accessible/root",
        iface: "org.a11y.atspi.Accessible",
        member: "GetChildAtIndex",
        body: [99],
      }),
    ).rejects.toThrow(
      "no recorded exchange for :1.999|/org/a11y/atspi/accessible/root|org.a11y.atspi.Accessible|GetChildAtIndex|[99]",
    );
  });

  it("distinguishes recorded from unrecorded by the full key, body included", async () => {
    const channel = replayChannel("gtk-dialog");
    // recorded: the registry root's children (the capture's first exchange)
    const [apps] = await channel.call({
      destination: "org.a11y.atspi.Registry",
      path: "/org/a11y/atspi/accessible/root",
      iface: "org.a11y.atspi.Accessible",
      member: "GetChildren",
    });
    expect(Array.isArray(apps)).toBe(true);
    expect((apps as unknown[]).length).toBeGreaterThan(0);

    // same destination, path, iface - different member: unrecorded
    await expect(
      channel.call({
        destination: "org.a11y.atspi.Registry",
        path: "/org/a11y/atspi/accessible/root",
        iface: "org.a11y.atspi.Accessible",
        member: "GetIndexInParent",
      }),
    ).rejects.toThrow(/no recorded exchange for /);
  });

  it("refuses a fixture that was never captured, naming the missing tape", async () => {
    const channel = replayChannel("never-captured");
    await expect(
      channel.call({
        destination: "org.a11y.atspi.Registry",
        path: "/org/a11y/atspi/accessible/root",
        iface: "org.a11y.atspi.Accessible",
        member: "GetChildren",
      }),
    ).rejects.toThrow(/no tape at .*never-captured.*never hand-authored/);
  });
});
