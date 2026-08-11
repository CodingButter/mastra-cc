import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  effectiveVisibility,
  isVisible,
  loadGrantsFile,
  MalformedGrantsFileError,
  type Visibility,
} from "../../grants.js";
import { composeBootNames, composeCatalog } from "../../launch/profiles.js";
import { CATALOG } from "../../launch/recipes.js";
import { CdpBackend } from "../cdp/index.js";
import { type CdpChannel, type CdpExchange, replayCdpChannel } from "../cdp/channel.js";
import { ReplayBackend } from "../replay/index.js";

// Deny-by-default visibility (ADR-0036, docs/00-PRODUCT.md): an application
// the operator has not granted is ABSENT from every answer - not "blocked",
// absent - and its subtree is never read. The one permitted read of an
// ungranted application is the name the daemon needed to decide. All offline,
// over the committed replay tapes.

describe("an ungranted application is invisible", () => {
  it("a replay backend with empty visibility answers zero elements", async () => {
    const backend = new ReplayBackend("gtk-dialog", new Set());
    const { elements } = await backend.queryElements({});
    await backend.close();
    expect(elements).toEqual([]);
  });

  it("a visibility naming the tape's application answers its subtree", async () => {
    const backend = new ReplayBackend("gtk-dialog", new Set(["yad"]));
    const { elements } = await backend.queryElements({});
    await backend.close();
    const buttons = elements.filter((e) => e.role === "button" && e.name === "OK");
    expect(buttons).toHaveLength(1);
  });

  it("an ungranted running application's absence is byte-identical to nonexistence", async () => {
    // The FULL wire-shaped responses are compared, not just the elements
    // array, so a future diagnostic field cannot leak which name was real.
    const backend = new ReplayBackend("gtk-dialog", new Set());
    const ungranted = await backend.queryElements({ role: "application", name: "yad" });
    const nonexistent = await backend.queryElements({ role: "application", name: "never-existed" });
    await backend.close();
    expect(JSON.stringify(ungranted)).toBe(JSON.stringify(nonexistent));
    expect(ungranted.elements).toEqual([]);
  });

  it("an ungranted browser costs exactly one version exchange - never list, never a call", async () => {
    // The version exchange is the one permitted read on the cdp route: the
    // application's name derives from it. A recording wrapper witnesses that
    // nothing else was ever issued.
    const issued: CdpExchange[] = [];
    const inner = replayCdpChannel("chrome-page");
    const recording: CdpChannel = {
      exchange: (e) => (issued.push(e), inner.exchange(e)),
      close: () => inner.close(),
    };
    const backend = new CdpBackend(recording, new Set());
    const { elements } = await backend.queryElements({});
    await backend.close();
    expect(elements).toEqual([]);
    expect(issued).toEqual([{ kind: "version" }]);
  });

  it("an id answered under \"all\" is refused by a fresh instance with empty visibility", async () => {
    const seeing = new ReplayBackend("gtk-dialog", "all");
    const { elements } = await seeing.queryElements({ name: "OK", role: "button" });
    await seeing.close();
    expect(elements).toHaveLength(1);

    const blind = new ReplayBackend("gtk-dialog", new Set());
    const attested = await blind.attestElement({ id: elements[0].id });
    await blind.close();
    expect(attested.element).toBeUndefined();
    expect(attested.refusal).toContain("nothing to attest");
  });
});

describe("the grants file", () => {
  const dir = mkdtempSync(join(tmpdir(), "mastra-cc-grants-"));

  it("an absent file grants nothing - deny by default", () => {
    const loaded = loadGrantsFile(join(dir, "does-not-exist.json"));
    expect(loaded.size).toBe(0);
  });

  it("a malformed file fails loudly with a named error - never silently \"no grants\"", () => {
    const notJson = join(dir, "not-json.json");
    writeFileSync(notJson, "this is not json");
    expect(() => loadGrantsFile(notJson)).toThrow(MalformedGrantsFileError);

    const wrongShape = join(dir, "wrong-shape.json");
    writeFileSync(wrongShape, JSON.stringify({ applications: "yad" }));
    expect(() => loadGrantsFile(wrongShape)).toThrow(MalformedGrantsFileError);
  });

  it("entries are NFKC-normalised at load - a math-bold name matches its plain form", () => {
    const mathBold = join(dir, "math-bold.json");
    writeFileSync(mathBold, JSON.stringify({ applications: ["\u{1D432}\u{1D41A}\u{1D41D}"] }));
    const loaded = loadGrantsFile(mathBold);
    expect(isVisible(loaded, "yad")).toBe(true);
  });

  it("the effective set is the union of file, flags, and permits", () => {
    const union = effectiveVisibility({
      file: new Set(["a"]),
      flags: new Set(["b"]),
      permits: new Set(["c"]),
    });
    expect(union).not.toBe("all");
    for (const name of ["a", "b", "c"]) expect(isVisible(union, name)).toBe(true);
    expect(isVisible(union, "d")).toBe(false);
  });

  it("any component being \"all\" makes the result \"all\"", () => {
    const union = effectiveVisibility({ file: new Set(), flags: "all", permits: new Set() });
    expect(union).toBe("all");
    expect(isVisible(union, "anything")).toBe(true);
  });
});

// Boot-time expansion (M2.3b, ADR-0038): the browser reports its product name
// whichever profile it opened, so a session that may launch chrome-work has to
// be able to SEE "chrome" or the launch it just performed would answer with an
// invisible desktop. The expansion is observe-side only.
describe("a permitted profile identity is visible under the name the browser reports", () => {
  const composed = composeCatalog(CATALOG, [{ name: "chrome-work", directory: "/var/tmp/m23b-work" }]);

  function browser(visibility: Visibility) {
    const issued: CdpExchange[] = [];
    const inner = replayCdpChannel("chrome-page");
    const recording: CdpChannel = {
      exchange: (e) => (issued.push(e), inner.exchange(e)),
      close: () => inner.close(),
    };
    return { backend: new CdpBackend(recording, visibility), issued };
  }

  it("permitting chrome-work makes the launched browser readable", async () => {
    const { visibility } = composeBootNames({
      permits: new Set(["chrome-work"]),
      grants: new Set(),
      flags: new Set(),
      catalog: composed,
    });
    const { backend } = browser(visibility);
    const { elements } = await backend.queryElements({});
    await backend.close();
    expect(elements.length).toBeGreaterThan(0);
  });

  it("permitting nothing leaves it invisible, still at exactly one version exchange", async () => {
    const { visibility } = composeBootNames({
      permits: new Set(),
      grants: new Set(),
      flags: new Set(),
      catalog: composed,
    });
    const { backend, issued } = browser(visibility);
    const { elements } = await backend.queryElements({});
    await backend.close();
    expect(elements).toEqual([]);
    expect(issued).toEqual([{ kind: "version" }]);
  });
});
