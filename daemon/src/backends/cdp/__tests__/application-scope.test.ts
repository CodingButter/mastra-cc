import { describe, expect, it } from "vitest";
import type { Backend } from "../../../backend.js";
import { replayCdpChannel } from "../channel.js";
import { CdpBackend } from "../index.js";

// ADR-0073: a query can name the one application it means, over the browser
// route. A CDP target IS one application - the browser, named by its product
// token ("Chrome/151..." -> "chrome") - so a scope that names that browser is
// answered in full, and a scope that names anything else is the empty "absent"
// answer the visibility gate produces. Driven over the recorded chrome-page
// world, the same instrument the performing refusal suite uses.
const performingOverARecording = (): Backend => new CdpBackend(replayCdpChannel("chrome-page"), "all");

describe("naming the one application the browser is", () => {
  it("answers in full when the scope names the browser", async () => {
    const backend = performingOverARecording();

    const unscoped = await backend.queryElements({});
    const scoped = await backend.queryElements({ application: "chrome" });

    expect(scoped.elements.length).toBe(unscoped.elements.length);
    expect(scoped.elements.length).toBeGreaterThan(0);

    await backend.close();
  });

  it("matches the browser name case-insensitively, the way a grant does", async () => {
    const backend = performingOverARecording();

    const scoped = await backend.queryElements({ application: "Chrome" });

    expect(scoped.elements.length).toBeGreaterThan(0);

    await backend.close();
  });

  it("answers empty when the scope names an application this browser is not", async () => {
    const backend = performingOverARecording();

    await expect(backend.queryElements({ application: "firefox" })).resolves.toEqual({ elements: [] });

    await backend.close();
  });
});
