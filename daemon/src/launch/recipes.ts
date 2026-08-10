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

export interface LaunchRecipe {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export type LaunchCatalog = Readonly<Record<string, LaunchRecipe>>;

// GTK3 enabling: the atk-bridge module registers the process on the
// accessibility bus (measured in M0.5; ADR-0027). yad is the proven headless
// subject - a GTK4 dialog inside a bare Xvfb session was observed never
// registering on a private accessibility bus (M1 Phase 5).
export const CATALOG: LaunchCatalog = {
  yad: {
    argv: ["yad", "--title", "launched by the daemon", "--text", "launched by the daemon", "--button", "OK"],
    env: { GTK_MODULES: "gail:atk-bridge" },
  },
};
