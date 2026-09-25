// FOUND BY THE COMPLETION BENCHMARK. Three answers reached a cold agent as
// daemon-class refusals although the daemon knew exactly what had happened:
//   - a screen grab the display refused (GNOME Wayland answers xwd with
//     BadMatch) arrived as daemon/Unclassified, because the capture handler
//     dropped the class of the refusal it was passing through;
//   - a capture on the browser route, which has no view of the screen, arrived
//     as daemon/BackendUnreadable, because the handler let that known refusal
//     fall to the backstop;
//   - an application that answers Component.ScrollTo with NotSupported made a
//     reveal arrive as daemon/BackendUnreadable.
// Each is a fact about this desk or this route, said with its own code.

import { describe, expect, it } from "vitest";
import { handleRequest } from "../server.js";
import { EffectUnsupportedError, UnperformableElementError, type Backend } from "../backend.js";
import { scrollIntoView } from "../backends/atspi/effects.js";
import { observeOnlyEffects } from "./support/observe-only.js";

function capturing(failure: Error): Backend {
  return {
    ...observeOnlyEffects,
    name: "failing-capture",
    queryElements: async () => ({ elements: [] }),
    applicationOfElement: () => "kate",
    captureElement: async () => {
      throw failure;
    },
    close: async () => undefined,
  } as unknown as Backend;
}

async function refusalOf(failure: Error) {
  const response = await handleRequest({ type: "request", id: 1, method: "captureElement", params: { id: "el-000000000000" } }, capturing(failure));
  return (response.result as { refusal?: { class: string; code: string; message: string } }).refusal;
}

describe("a route that cannot do a thing says so with its own code", () => {
  it("a screen grab the display refuses is the desk's answer, not an unclassified daemon fault", async () => {
    const refusal = await refusalOf(new UnperformableElementError("screen grab failed: X Error of failed request:  BadMatch (invalid parameter attributes)"));
    expect(refusal).toMatchObject({ class: "world", code: "UnperformableElementError" });
    expect(refusal?.message).toContain("BadMatch");
  });

  it("a capture on a route with no view of the screen is refused as unsupported, not as an unreadable desk", async () => {
    const refusal = await refusalOf(new EffectUnsupportedError("this route reads a browser through its debugging protocol and has no view of the machine's screen"));
    expect(refusal).toMatchObject({ class: "world", code: "EffectUnsupportedError" });
  });

  it.each(["org.freedesktop.DBus.Error.NotSupported", "org.freedesktop.DBus.Error.UnknownMethod"])(
    "an application answering ScrollTo with %s declines the reveal, and nothing is read afterwards",
    async (dbusName) => {
      const calls: string[] = [];
      const seam = {
        call: async (m: { iface: string; member: string }) => {
          calls.push(m.member);
          if (m.member === "GetInterfaces") return [["org.a11y.atspi.Component"]];
          if (m.member === "ScrollTo") throw new Error(`d-bus call failed: {"name":"DBusError","dbusName":"${dbusName}","body":[""]}`);
          return [[0, 0]];
        },
      };
      await expect(scrollIntoView(seam as never, { busName: ":1.1", objectPath: "/o" } as never)).rejects.toThrow(UnperformableElementError);
      expect(calls).not.toContain("GetState");
    },
  );

  it("any other failure of ScrollTo is still not dressed up as the application's answer", async () => {
    const seam = {
      call: async (m: { member: string }) => {
        if (m.member === "GetInterfaces") return [["org.a11y.atspi.Component"]];
        throw new Error("d-bus call failed: connection reset");
      },
    };
    await expect(scrollIntoView(seam as never, { busName: ":1.1", objectPath: "/o" } as never)).rejects.not.toThrow(UnperformableElementError);
  });
});
