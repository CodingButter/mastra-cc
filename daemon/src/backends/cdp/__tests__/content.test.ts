import { describe, expect, it } from "vitest";
import { readObservableContent } from "../content.js";

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
