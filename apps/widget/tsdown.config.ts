import { copyFileSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts", "src/face.ts"],
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
