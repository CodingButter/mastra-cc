import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/main.ts"],
  dts: { eager: true },
  // The installed daemon is a self-contained module tree: infra/apply.sh copies
  // dist/ and nothing else, so a bare specifier left in the output is a package
  // that cannot be resolved on a shipped tree. Protocol types point at generated
  // TypeScript source (ADR-0009); dbus-native and ws would otherwise remain
  // package imports unavailable under ~/.local/lib/mastra-cc/daemon/.
  deps: { alwaysBundle: ["@mastra-cc/protocol-types", "dbus-native", "ws"] },
});
