// BACKENDS ANSWER INTERLEAVED CALLS (ADR-0118).
//
// With per-target queues a backend may serve several observations at once.
// Its shared state - element memory, attribution, reverse maps - must give the
// same answers interleaved as it gives one call at a time.

import { describe, expect, it } from "vitest";
import type { QueryElementsResult } from "@mastra-cc/protocol-types";
import { AtspiBackend, TRAVERSAL_LIMITS } from "../backends/atspi/index.js";
import { CdpBackend } from "../backends/cdp/index.js";
import { replayCdpChannel } from "../backends/cdp/channel.js";
import { replayChannel } from "../backends/replay/index.js";

const backends = {
  "the accessibility bus": () => new AtspiBackend(replayChannel("gtk-dialog"), "all", TRAVERSAL_LIMITS),
  "the browser protocol": () => new CdpBackend(replayCdpChannel("chrome-page"), "all"),
};

describe.each(Object.entries(backends))("on %s", (_, make) => {
  it("answers concurrent reads and queries exactly as it answers them in turn", async () => {
    const serial = make();
    const concurrent = make();
    try {
      const { elements = [] } = (await serial.queryElements({})) as QueryElementsResult;
      await concurrent.queryElements({});
      const ids = [...new Set(elements.map((e) => e.id))];
      expect(ids.length).toBeGreaterThan(1);

      const inTurn: unknown[] = [];
      for (const id of ids) inTurn.push(await serial.attestElement({ id }), serial.applicationOfElement(id));
      inTurn.push(await serial.queryElements({}));

      const together = await Promise.all([
        ...ids.map((id) => concurrent.attestElement({ id })),
        concurrent.queryElements({}),
      ]);
      const interleaved: unknown[] = [];
      ids.forEach((id, i) => interleaved.push(together[i], concurrent.applicationOfElement(id)));
      interleaved.push(together.at(-1));
      expect(interleaved).toEqual(inTurn);
    } finally {
      await serial.close();
      await concurrent.close();
    }
  });
});
