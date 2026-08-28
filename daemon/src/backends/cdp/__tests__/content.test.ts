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

  it("classifies only masked accessibility values through the backing node", () => {
    expect(
      needsProtectedClassification({
        role: { value: "textbox" },
        value: { value: "ordinary content" },
        properties: [property("editable", "plaintext")],
      }),
    ).toBe(false);
    expect(
      needsProtectedClassification({
        role: { value: "textbox" },
        value: { value: "••••••" },
        properties: [property("editable", "plaintext")],
      }),
    ).toBe(true);
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

  it("does not mistake accessible names for element content", () => {
    expect(readObservableContent({ role: { value: "button" } })).toEqual({
      kind: "unavailable",
      reason: "not-exposed",
    });
  });
});
