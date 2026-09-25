/** An unterminated request line longer than this ends the connection instead of growing without bound. */
export const MAX_REQUEST_LINE_CHARS = 8 * 1024 * 1024;
// Type-only here; the value is reached through a dynamic import inside
// startWebSocketServer, so a daemon nobody asked for a port never pays to load
// the library. Laziness is not what makes it resolvable, though: the installed
// tree copies dist/ without node_modules, so `ws` is force-bundled by
// daemon/tsdown.config.ts the way dbus-native is.

// The daemon's socket server: newline-delimited JSON, digest handshake first,
// then requests dispatched through the effect-class gate. Accessibility access
// is serialised regardless of what Phase 6 measures - serialising is what
// makes an audit record attributable (docs/07-ROADMAP.md:92), and that reason
// is independent of whether concurrency is safe.

export * from "./server/grants.js";
export * from "./server/launch-focus.js";
export * from "./server/subscriptions.js";
export * from "./server/dispatch.js";
export * from "./server/queues.js";
export * from "./server/pipes.js";
