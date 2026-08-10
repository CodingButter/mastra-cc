import { describe, expect, it } from "vitest";
import { ID_PATTERN } from "@mastra-cc/protocol-types";
import { deriveId } from "../identity.js";

// Identity is derived from bus name + object path, never claimed by the
// element. The prototype found three browser frames all returning the same
// native id - so the native id plays no part here.

describe("derived element identity", () => {
  it("matches the schema's frozen id pattern", () => {
    const id = deriveId("button", ":1.302", "/org/gnome/Zenity/a11y/598bee48");
    expect(id).toMatch(new RegExp(ID_PATTERN));
  });

  it("is stable: the same object read twice gets the same id", () => {
    const a = deriveId("button", ":1.302", "/org/gnome/Zenity/a11y/598bee48");
    const b = deriveId("button", ":1.302", "/org/gnome/Zenity/a11y/598bee48");
    expect(a).toBe(b);
  });

  it("differs for two objects that share a native id, because their paths differ", () => {
    // three frames, one claimed native id: identity must come from the path
    const a = deriveId("generic", ":1.34", "/org/a11y/atspi/accessible/frame1");
    const b = deriveId("generic", ":1.34", "/org/a11y/atspi/accessible/frame2");
    expect(a).not.toBe(b);
  });

  it("prefixes by kind: app- for applications, win- for windows and dialogs, el- otherwise", () => {
    expect(deriveId("application", ":1.1", "/p")).toMatch(/^app-/);
    expect(deriveId("window", ":1.1", "/p")).toMatch(/^win-/);
    expect(deriveId("dialog", ":1.1", "/p")).toMatch(/^win-/);
    expect(deriveId("button", ":1.1", "/p")).toMatch(/^el-/);
  });
});
