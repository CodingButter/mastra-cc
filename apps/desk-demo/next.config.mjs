// Deliberately .mjs, not .ts: Next loads its config through its own TypeScript
// bundle, and this workspace's pinned TypeScript 7 makes that loader throw
// before the build starts. A config file is not the place to fight a toolchain.
/** @type {import("next").NextConfig} */
export default {
  // The agent, its tools and the desk socket all live server-side. These are
  // node-only and must not be traced into a browser bundle.
  serverExternalPackages: ["@mastra/core", "@mastra-cc/desktop", "@mastra-cc/transport"],
};
