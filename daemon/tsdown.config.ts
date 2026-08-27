import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/main.ts"],
  dts: { eager: true },
  // The installed daemon is a self-contained module tree. Protocol types point
  // at generated TypeScript source (ADR-0009), and dbus-native otherwise remains
  // a package import unavailable under ~/.local/lib/mastra-cc/daemon/.
  deps: { alwaysBundle: ["@mastra-cc/protocol-types", "dbus-native"] },
});
