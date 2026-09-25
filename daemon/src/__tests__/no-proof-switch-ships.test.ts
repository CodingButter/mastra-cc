import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Audit M5: a proof switch read from the environment is a production behaviour
// nobody reviews. Proof-only behaviour enters through a constructor seam.
const src = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "__tests__") return [];
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

describe("production code", () => {
  it("reads no proof-only switch from the environment", () => {
    const files = sources(src);
    // A glob that matches nothing passes vacuously (01-ARCHITECTURE §5).
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((path) => /process\.env\.[A-Z_]*FOR_PROOF/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
});
