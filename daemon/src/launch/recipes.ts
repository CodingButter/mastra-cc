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

import { homedir } from "node:os";
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
  // Set only on recipes that open the browser's debugging endpoint. It is a
  // declared property of the recipe rather than something sniffed out of argv,
  // because the test catalogs defang argv to a harmless sleep and the guard
  // this feeds must keep its meaning there.
  readonly sharesBrowserEndpoint?: true;
}

export type LaunchCatalog = Readonly<Record<string, LaunchRecipe>>;

// The one-browser-identity-at-a-time guard (ADR-0038) exists because two
// browser identities would want the SAME debugging endpoint - it is a
// statement about that endpoint, not about tree names in general. A recipe
// contends for it exactly when it says so - the property is declared on the
// recipe, not inferred from argv, because a defanged catalog replaces argv
// while keeping every other field and an argv sniff would silently stop
// recognising the browser there. This became load-bearing when the catalog stopped
// being four hand-written entries: the machine's own entries routinely put
// several desktop entries over one binary (libreoffice-writer, -calc, -impress
// all run `libreoffice`), so they share an appearsAs while sharing nothing
// about the browser, and a tree-name-only guard would refuse the second one.
export function contendsForBrowserEndpoint(recipe: LaunchRecipe): boolean {
  return recipe.sharesBrowserEndpoint === true;
}

// The built-in browser's profile directory. Exported so profile composition
// (launch/profiles.ts) substitutes one identified argv element instead of
// string-matching, and so a profile naming this directory can be refused - it
// would share the built-in identity's cookie jar.
export const DEFAULT_CHROME_PROFILE_DIR = "/tmp/mastra-cc/chrome-profile";

// The gmail identity's profile directory: persistent, under the operator's
// home, because the operator signs into it BY HAND once (M2.5, Q03) and a
// signed-in identity must survive reboots - /tmp would sign it out. The daemon
// never sees the sign-in and never creates, lists or reads this directory
// itself; it only hands the path to the browser. Exported for the same reason
// as DEFAULT_CHROME_PROFILE_DIR: a profiles-file entry naming this directory
// would share the signed-in jar and must be refused.
export const GMAIL_PROFILE_DIR = `${homedir()}/.local/share/mastra-cc/gmail-profile`;

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
    sharesBrowserEndpoint: true,
  },
  // The same browser under the operator's signed-in Gmail identity (M2.5).
  // Identical shape to the chrome entry - only the profile directory and the
  // start URL differ. It answers to "chrome" in the semantic tree like every
  // browser identity, and the one-browser-identity-at-a-time guard applies:
  // both entries want the same debugging endpoint.
  gmail: {
    argv: [
      "google-chrome",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${GMAIL_PROFILE_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://mail.google.com",
    ],
    env: {},
    appearsAs: "chrome",
    sharesBrowserEndpoint: true,
  },
  // Qt6 enabling (M2.5, Q05 - measured on minibeast, Qt 6.4): without a knob
  // the process registers an application root on the accessibility bus but
  // publishes NO subtree (ChildCount stays 0); QT_ACCESSIBILITY=1 - the
  // Qt5-era knob - changes nothing; QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 makes
  // the full widget tree appear. So this recipe bakes the one knob that
  // measured true, the same launch-time posture as yad's GTK_MODULES
  // (ADR-0027: readability is decided once at process start).
  qt6ct: {
    argv: ["qt6ct"],
    env: { QT_LINUX_ACCESSIBILITY_ALWAYS_ON: "1" },
  },
};
