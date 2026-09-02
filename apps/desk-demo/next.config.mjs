// Deliberately .mjs, not .ts: Next loads its config through its own TypeScript
// bundle, and this workspace's pinned TypeScript 7 makes that loader throw
// before the build starts. A config file is not the place to fight a toolchain.
/** @type {import("next").NextConfig} */
export default {
  // The agent, its tools and the desk socket all live server-side. These are
  // node-only and must not be traced into a browser bundle.
  serverExternalPackages: ["@mastra/core", "@mastra-cc/desktop", "@mastra-cc/transport"],

  // The desk is reached over the loopback address and the chat over localhost, so
  // in development the page is opened under whichever of the two the operator
  // typed. Without both named here Next refuses its own dev resources and the
  // client never hydrates - the page renders and nothing in it responds.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};
