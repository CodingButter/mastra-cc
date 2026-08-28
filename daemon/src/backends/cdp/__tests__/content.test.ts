import { describe, expect, it } from "vitest";
import { needsProtectedClassification, readObservableContent } from "../content.js";

const property = (name: string, value: unknown) => ({ name, value: { value } });

describe("browser accessibility observable content", () => {
  it("maps an ordinary editable value without scraping the DOM", () => {
    expect(
      readObservableContent({
        role: { value: "textField" },
        value: { value: "ordinary content" },
        properties: [property("editable", true)],
      }),
    ).toEqual({ kind: "text", value: "ordinary content" });
  });

  it("redacts a protected value before mapping the published value", () => {
    expect(
      readObservableContent({
        role: { value: "textField" },
        value: { value: "must-not-cross" },
        properties: [property("protected", true), property("editable", true)],
      }),
    ).toEqual({ kind: "redacted", reason: "protected" });
  });

  it("classifies every editable text field through its backing node", () => {
    for (const value of ["ordinary content", "••••••", ""]) {
      expect(
        needsProtectedClassification({
          role: { value: "textbox" },
          value: { value },
          properties: [property("editable", "plaintext")],
        }),
      ).toBe(true);
    }
    expect(needsProtectedClassification({ role: { value: "button" } })).toBe(false);
  });

  it("redacts a masked field confirmed protected by its backing node", () => {
    const node = {
      role: { value: "textField" },
      value: { value: "••••••" },
      properties: [property("editable", "plaintext")],
    };
    expect(readObservableContent(node, 0, 4096, true)).toEqual({ kind: "redacted", reason: "protected" });
    expect(readObservableContent(node, 0, 4096, false)).toEqual({ kind: "text", value: "••••••" });
  });

  it("maps a published numeric value and range", () => {
    expect(
      readObservableContent({
        role: { value: "slider" },
        value: { value: 42 },
        properties: [property("valuemin", 0), property("valuemax", 100)],
      }),
    ).toEqual({ kind: "number", value: 42, range: { minimum: 0, maximum: 100 } });
  });

  it("clamps out-of-range offsets and bounds every returned text response", () => {
    const node = {
      role: { value: "textbox" },
      value: { value: "abcdef" },
      properties: [property("editable", "plaintext")],
    };
    expect(readObservableContent(node, 100, 10)).toEqual({
      kind: "text-window",
      value: "",
      offset: 6,
      length: 0,
      totalLength: 6,
      startLine: 1,
      endLine: 1,
      totalLines: 1,
    });
    const long = { ...node, value: { value: "x".repeat(5000) } };
    const content = readObservableContent(long, 0, 1_000_000);
    expect(content.kind).toBe("text-window");
    if (content.kind === "text-window") expect(content.length).toBe(4096);
  });

  it("does not mistake accessible names for element content", () => {
    expect(readObservableContent({ role: { value: "button" } })).toEqual({
      kind: "unavailable",
      reason: "not-exposed",
    });
  });
});
