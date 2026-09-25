import { REFUSAL_CODES, REFUSAL_OWNERS } from "@mastra-cc/protocol-types";
import { describe, expect, it } from "vitest";
import { REFUSAL_OWNER, withoutInternals } from "../audit.js";
import { restartRefusal } from "../server.js";

// ADR-0113: every refusal on the wire carries whose it is. These pin the
// boundary where an internal string refusal becomes the wire object.
describe("every refusal says whose it is", () => {
  it("gives every schema code exactly one owner the schema knows", () => {
    expect(Object.keys(REFUSAL_OWNER).sort()).toEqual([...REFUSAL_CODES].sort());
    for (const owner of Object.values(REFUSAL_OWNER)) expect(REFUSAL_OWNERS).toContain(owner);
  });

  it("puts class, code and message on the wire and strips the internal class", () => {
    const wire = withoutInternals({ refusal: "no such element", refusalClass: "UnknownElement" });
    expect(wire).toEqual({ refusal: { class: "agent", code: "UnknownElement", message: "no such element" } });
  });

  it("names the world when the desktop changed under the call", () => {
    const wire = withoutInternals({ refusal: "it went away", refusalClass: "ElementGone" });
    expect(wire.refusal).toMatchObject({ class: "world", code: "ElementGone" });
  });

  it("charges an unclassified refusal - the backstop - to the daemon, never to the caller", () => {
    for (const refusalClass of [undefined, "NotACode"]) {
      const wire = withoutInternals({ refusal: "something failed", refusalClass });
      expect(wire).toEqual({ refusal: { class: "daemon", code: "Unclassified", message: "something failed" } });
    }
  });

  it("charges an ownership refusal to the agent that asked", () => {
    const refused = restartRefusal("off" as never, "restart");
    expect(withoutInternals(refused).refusal).toMatchObject({ class: REFUSAL_OWNER[refused.refusalClass] });
    expect(withoutInternals({ refusal: "not ours", refusalClass: "RestartNotOurs" }).refusal).toMatchObject({ class: "agent" });
  });
});
