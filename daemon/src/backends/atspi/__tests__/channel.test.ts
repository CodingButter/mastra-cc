import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exchangeKey, fixturesDir } from "../channel.js";

// The capture path is resolved by walking up to the package root, because a
// fixed number of ".." segments once wrote the tape OUTSIDE the repository
// when the module loaded from its bundled depth instead of its source depth.
// This test pins the resolved path to the daemon package on the load path the
// test runner actually uses; the bundled load path is exercised by the
// capture verification gate itself.

describe("the capture channel's fixtures path", () => {
  it("resolves to the daemon package's fixtures directory, not a depth-guessed one", () => {
    const dir = fixturesDir();
    expect(basename(dir)).toBe("fixtures");
    const packageRoot = dirname(dir);
    const here = dirname(fileURLToPath(import.meta.url));
    // walking up from this test must reach the same package root
    expect(here.startsWith(packageRoot)).toBe(true);
    expect(basename(packageRoot)).toBe("daemon");
    expect(join(packageRoot, "fixtures")).toBe(dir);
  });
});

describe("the exchange key", () => {
  it("distinguishes exchanges by destination, path, member and body", () => {
    const base = { destination: ":1.1", path: "/p", iface: "i", member: "m", body: [1] };
    const same = exchangeKey({ ...base });
    expect(exchangeKey(base)).toBe(same);
    expect(exchangeKey({ ...base, body: [2] })).not.toBe(same);
    expect(exchangeKey({ ...base, member: "n" })).not.toBe(same);
  });

  it("treats an absent body as the empty body - the shape replay looks up by", () => {
    const withEmpty = exchangeKey({ destination: ":1.1", path: "/p", iface: "i", member: "m", body: [] });
    const without = exchangeKey({ destination: ":1.1", path: "/p", iface: "i", member: "m" });
    expect(without).toBe(withEmpty);
  });
});
