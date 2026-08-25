import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

describe("dashboard", () => {
  it("renders without the superseded biometric enrolment surface", () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain("Mastra dashboard");
    expect(markup).not.toMatch(/enrol|five clean takes|speaker template/i);
    expect(markup).not.toContain("getUserMedia");
  });
});
