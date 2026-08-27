import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/main.ts", "src/orchestrator/launch.ts"],
  dts: true,
});
