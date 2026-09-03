import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: { eager: true },
  // @mastra-cc/protocol-types is a published package with a compiled entry
  // point, and it is declared as a runtime dependency - so it stays external.
  // Inlining it while still declaring it would tell a consumer to install
  // something this package never imports.
  deps: { neverBundle: ["@mastra-cc/protocol-types"] },
});
