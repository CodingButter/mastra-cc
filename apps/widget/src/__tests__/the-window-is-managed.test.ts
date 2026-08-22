import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FACE_HEIGHT, FACE_WIDTH, faceWindowOptions } from "../window-model.js";

const SRC = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(path));
    } else if (entry.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Strip comments before grepping. A rule stated in a comment must not satisfy
 * the check that enforces the rule — the pin rules apply to any source-level
 * assertion, not only to files under tools/pins.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("the face is a window the window manager manages", () => {
  it("never asks for an unfocusable window", () => {
    // ADR-0016 decision 1. `focusable: false` makes Electron create an
    // override-redirect window; the window manager then never sees it, and
    // _NET_WM_STATE_ABOVE is discarded with nothing reporting an error.
    const options = faceWindowOptions({ x: 0, y: 0 });
    expect(options).not.toHaveProperty("focusable");

    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(withoutComments(readFileSync(file, "utf8"))).not.toMatch(
        /focusable\s*:/,
      );
    }
  });

  it("never shows itself in a way that takes focus", () => {
    // ADR-0016 decision 2: show-without-activate is the only path onto the
    // screen. `show()` and `focus()` both activate, and either one is a
    // one-word edit away from silently breaking the guarantee.
    expect(faceWindowOptions({ x: 0, y: 0 }).show).toBe(false);

    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = withoutComments(readFileSync(file, "utf8"));
      expect(code).not.toMatch(/\.show\s*\(/);
      expect(code).not.toMatch(/\.focus\s*\(/);
    }
  });

  it("is face-sized, never derived from a display", () => {
    // ADR-0016 decision 3, and the prototype's other wrong model: a
    // display-sized transparent window that cannot be dragged because there is
    // nothing to drag.
    const options = faceWindowOptions({ x: 1200, y: 300 });
    expect(options.width).toBe(FACE_WIDTH);
    expect(options.height).toBe(FACE_HEIGHT);
    expect(options.width).toBeLessThan(400);
    expect(options.height).toBeLessThan(400);
  });

  it("asks for a managed, always-on-top, frameless window", () => {
    const options = faceWindowOptions({ x: 10, y: 20 });
    expect(options.alwaysOnTop).toBe(true);
    expect(options.frame).toBe(false);
    expect(options.x).toBe(10);
    expect(options.y).toBe(20);
  });
});
