import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: { eager: true },
  // @mastra-cc/protocol-types is generated build output whose main points at
  // TypeScript source (ADR-0009); it must be inlined, not left as a runtime
  // import Node cannot resolve.
  noExternal: ["@mastra-cc/protocol-types"],
});
