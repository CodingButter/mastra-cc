import { describe, expect, it } from "vitest";
import { ID_PATTERN } from "@mastra-cc/protocol-types";
import { loadTape, ReplayBackend } from "../index.js";

// Replaying the committed tape must produce the same tree the live capture
// recorded - checked against the RAW tape data, not against replay's own
// output (comparing replay to itself would be vacuous). The distinct-name
// assertion is the one that exposed a false "identical" result at plan time,
// when a looser lookup key collapsed 17 live names into 1.

const ACCESSIBLE = "org.a11y.atspi.Accessible";

// The same variant unwrap the reader applies; duplicated here deliberately so
// a reader bug cannot hide by being applied to both sides.
function unwrapName(reply: unknown[]): string {
  const raw = reply[0];
  if (Array.isArray(raw)) {
    const inner = raw[1];
    return Array.isArray(inner) ? String(inner[0] ?? "") : String(inner ?? "");
  }
  return String(raw ?? "");
}

function recordedDistinctNames(): Set<string> {
  const names = new Set<string>();
  for (const entry of loadTape("gtk-dialog").exchanges) {
    if (entry.member === "Get" && Array.isArray(entry.body) && entry.body[0] === ACCESSIBLE && entry.body[1] === "Name") {
      const name = unwrapName(entry.reply);
      if (name !== "") names.add(name);
    }
  }
  return names;
}

describe("the replay backend answers identically to the live capture", () => {
  it("reproduces every distinct name the capture recorded - no more, no fewer", async () => {
    const recorded = recordedDistinctNames();
    expect(recorded.size).toBeGreaterThan(1); // a one-name corpus would prove nothing

    // visibility "all": this file witnesses reader fidelity against the raw
    // tape, not grant policy (deny-by-default lives in invisibility.test.ts)
    const backend = new ReplayBackend("gtk-dialog", "all");
    const { elements } = await backend.queryElements({});
    await backend.close();

    const replayed = new Set(elements.map((e) => e.name).filter((n) => n !== ""));
    expect(replayed).toEqual(recorded);
  });

  it("answers the demo query with the same button the live read found, ids and all", async () => {
    const backend = new ReplayBackend("gtk-dialog", "all");
    const { elements } = await backend.queryElements({ name: "OK" });
    await backend.close();

    // The capture (yad on the sandboxed headless bus - re-captured there so no
    // personal desktop strings ride the tape) found a button and a label named
    // OK. Identity derives from bus name + object path, both on the tape, so
    // the replayed ids are the very ids the live run printed.
    const buttons = elements.filter((e) => e.role === "button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].name).toBe("OK");
    expect(buttons[0].id).toMatch(new RegExp(ID_PATTERN));
    expect(elements.length).toBe(2);
  });

  it("attests an element it answered, without any bus existing", async () => {
    const backend = new ReplayBackend("gtk-dialog", "all");
    const { elements } = await backend.queryElements({ name: "OK", role: "button" });
    const attested = await backend.attestElement({ id: elements[0].id });
    await backend.close();
    expect(attested.element?.id).toBe(elements[0].id);
  });
});
