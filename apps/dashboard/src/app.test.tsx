import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

describe("wake enrolment dashboard", () => {
  it("renders the thin Mastra shell and closed five-take surface", () => {
    const markup = renderToStaticMarkup(<App />);
    expect(markup).toContain("MASTRA");
    expect(markup).toContain("ALPHA");
    expect(markup).toContain("Wake enrolment");
    expect(markup).toContain("Five clean takes");
    expect(markup.match(/Take [1-5]/g)).toHaveLength(5);
    expect(markup).not.toContain("getUserMedia");
  });
});
