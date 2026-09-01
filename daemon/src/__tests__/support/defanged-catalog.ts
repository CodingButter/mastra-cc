import { CATALOG, type LaunchCatalog } from "../../launch/recipes.js";

// The real catalog, defanged: every name and every field the real catalog
// carries, with argv swapped for a harmless sleep. Authority-before-capability
// is a property about NAMES, not binaries - an unpermitted "gmail" must refuse
// byte-identically to an unknown name whatever argv the entry holds - so every
// test that proves it keeps its meaning while a deleted authority guard's
// blast radius becomes a 30-second sleep instead of a real Chrome on the
// operator's signed-in Gmail profile (issue #20).
export function defang(catalog: LaunchCatalog): LaunchCatalog {
  return Object.fromEntries(Object.entries(catalog).map(([name, recipe]) => [name, { ...recipe, argv: ["sleep", "30"] }]));
}

export const DEFANGED_CATALOG: LaunchCatalog = defang(CATALOG);
