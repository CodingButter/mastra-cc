import { copyFileSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "tsdown";

export default defineConfig({
  // `placement-store` is an entry rather than a chunk because the desk harness
  // imports it: the placement file a restart measurement restores from has to
  // be written by the shipped writer, or the measurement scores the reading
  // half twice and never executes the writing half at all.
  entry: ["src/main.ts", "src/face.ts", "src/preload.ts", "src/placement-store.ts"],
  deps: { neverBundle: ["electron"] },
  hooks: {
    "build:done": () => {
      // The face's markup ships beside the bundle. Copied by the build rather
      // than committed twice: a second hand-editable copy is the three-copy
      // problem ADR-0003 names.
      copyFileSync(join("src", "face.html"), join("dist", "face.html"));
    },
  },
});
