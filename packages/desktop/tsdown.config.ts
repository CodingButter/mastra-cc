import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/mastra.ts"],
  dts: { eager: true },
  // @mastra-cc/transport is a real published dependency, so it stays external:
  // inlining it would put a second copy of the one client inside this package,
  // which is the thing pin B5 exists to prevent. @mastra/core is a PEER and is
  // reached only from the mastra subpath, so it stays external too - bundling a
  // framework into this package would make it a hard dependency in all but name.
  // @mastra-cc/protocol-types is external for the same reason: it is a real
  // published package with a compiled entry point, and the adapter reads its
  // generated descriptors at runtime.
  deps: { neverBundle: ["@mastra-cc/transport", "@mastra-cc/protocol-types", "@mastra/core"] },
});
