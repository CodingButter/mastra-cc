// The capability catalog, as data (mirroring backends/atspi/roles.ts): an
// application name maps to the argv that launches it and the environment that
// applies its accessibility enabling at launch time - ADR-0027: readability is
// decided once at process start, so the enabling rides the launch itself.
//
// This catalog answers "can we launch it" ONLY. Authority - "may we" - lives
// elsewhere (the session permit set; ADR-0019: capability is not authority),
// and nothing in this file is consulted until authority has already passed.
//
// argv is static data keyed by name: wire input selects a catalog key and
// never contributes argv content. Platform strings (GTK_MODULES) are legal
// here in daemon source and illegal on the wire (B10).

import { DEBUG_PORT, PAGE_PORT } from "../backends/cdp/channel.js";

export interface LaunchRecipe {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  // The name this application answers to in the semantic tree when it differs
  // from the catalog key: a browser launched under a profile identity still
  // calls itself "chrome" (the cdp backend derives the name from the browser's
  // own version reply, backends/cdp/index.ts). Static data like argv - wire
  // input selects a catalog key and never contributes this.
  readonly appearsAs?: string;
}

export type LaunchCatalog = Readonly<Record<string, LaunchRecipe>>;

// The built-in browser's profile directory. Exported so profile composition
// (launch/profiles.ts) substitutes one identified argv element instead of
// string-matching, and so a profile naming this directory can be refused - it
// would share the built-in identity's cookie jar.
export const DEFAULT_CHROME_PROFILE_DIR = "/tmp/mastra-cc/chrome-profile";

// GTK3 enabling: the atk-bridge module registers the process on the
// accessibility bus (measured in M0.5; ADR-0027). yad is the proven headless
// subject - a GTK4 dialog inside a bare Xvfb session was observed never
// registering on a private accessibility bus (M1 Phase 5).
export const CATALOG: LaunchCatalog = {
  yad: {
    argv: ["yad", "--title", "launched by the daemon", "--text", "launched by the daemon", "--button", "OK"],
    env: { GTK_MODULES: "gail:atk-bridge" },
  },
  // The browser's enabling is its debugging port, not an accessibility env:
  // this recipe is read by the cdp backend through the browser's own protocol,
  // never the platform bus. Chrome >=136 ignores --remote-debugging-port
  // unless --user-data-dir is non-default (measured in M0.5,
  // docs/proofs/what-the-browser-protocol-gives-us.md). The argv is still
  // static data built once at module load - the ports are imported constants
  // (one source of truth with the backend), and wire input still only ever
  // selects the catalog key.
  chrome: {
    argv: [
      "google-chrome",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${DEFAULT_CHROME_PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      `http://127.0.0.1:${PAGE_PORT}/page.html`,
    ],
    env: {},
    appearsAs: "chrome",
  },
};
