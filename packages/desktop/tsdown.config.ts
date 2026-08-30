import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: { eager: true },
  // @mastra-cc/transport is a real published dependency, so it stays external:
  // inlining it would put a second copy of the one client inside this package,
  // which is the thing pin B5 exists to prevent.
  deps: { neverBundle: ["@mastra-cc/transport", "@mastra-cc/protocol-types"] },
});
