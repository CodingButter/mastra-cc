// A PICTURE IS OBSERVATION, and the route has to treat it as observation - not
// as a sixth effect and not as an ungated back door. Two things are pinned.
//
// The first is that it goes out over the wire at all: the method is in the
// contract, the daemon answers it, and the bytes come back where the schema
// says they will.
//
// The second is that it is bounded by the SAME per-application visibility that
// decides whether the caller may read the element at all. A daemon that let a
// caller photograph an element it is not permitted to see would have handed out
// the whole desk under an observe-class name, which is the failure this test
// exists to catch: a look at an application outside the caller's reach is
// refused before the backend is asked.

import { describe, expect, it } from "vitest";
import { handleRequest } from "../server.js";
import { UnperformableElementError, type Backend } from "../backend.js";
import { observeOnlyEffects } from "./support/observe-only.js";

const PICTURE = {
  format: "png" as const, width: 4, height: 2, data: "aGVsbG8=",
  source: "visible-desktop" as const, clipped: false, crop: { x: 0, y: 0, width: 1, height: 1 }, capturedAt: 0,
};

function backendThatCanSee(record: string[]): Backend {
  return {
    ...observeOnlyEffects,
    name: "seeing",
    queryElements: async () => ({ elements: [] }),
    attestElement: async () => ({ refusal: "not asked here" }),
    readElementContent: async () => ({ refusal: "not asked here" }),
    subscribeElement: async () => ({ subscriptionId: "sub-1" }),
    unsubscribeElement: async () => undefined,
    applicationOfElement: () => "kate",
    captureElement: async (params: { id: string }) => {
      record.push(params.id);
      return { image: PICTURE };
    },
    close: async () => undefined,
  } as unknown as Backend;
}

describe("looking at an element is observation, gated like every other look", () => {
  it("answers a capture with the picture the backend took", async () => {
    const asked: string[] = [];
    const response = await handleRequest(
      { type: "request", id: 1, method: "captureElement", params: { id: "el-000000000000" } },
      backendThatCanSee(asked),
    );
    expect(response.refusal).toBeUndefined();
    expect((response.result as { image?: typeof PICTURE }).image).toEqual(PICTURE);
    expect(asked).toEqual(["el-000000000000"]);
  });

  it("passes a backend's refusal through rather than answering with a blank picture", async () => {
    const blind: Backend = {
      ...backendThatCanSee([]),
      captureElement: async () => {
        throw new UnperformableElementError("this element publishes no rectangle on this desk");
      },
    } as unknown as Backend;
    const response = await handleRequest(
      { type: "request", id: 2, method: "captureElement", params: { id: "el-000000000000" } },
      blind,
    );
    const answer = (response.result ?? {}) as { image?: unknown; refusal?: string };
    expect(answer.image).toBeUndefined();
    expect(answer.refusal ?? response.refusal).toContain("no rectangle");
  });
});
