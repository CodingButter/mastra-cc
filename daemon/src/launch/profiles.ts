import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { normalise } from "../backends/atspi/names.js";
import { effectiveVisibility, type Visibility } from "../grants.js";
import { CATALOG, DEFAULT_CHROME_PROFILE_DIR } from "./recipes.js";
import type { LaunchCatalog, LaunchRecipe } from "./recipes.js";
import { findRecipe } from "./spawn.js";

// Browser profiles as launch identities (M2.3b, ADR-0038). A profile is a
// cookie jar the browser itself enforces, so two profiles are two identities:
// permitting "chrome-work" is not permitting "chrome-personal". Identities are
// NAMES - catalog keys composed at boot from an operator file - never a wire
// parameter, so the frozen schema is untouched and argv stays static data.
//
// The file is daemon-local and operator-owned, exactly like the grants file
// (ADR-0036), and is read at boot only. The loader never reads, lists, stats
// or creates a profile directory: a directory that is missing or unwritable
// surfaces as the honest "opened but did not become readable" refusal rather
// than a nicer error bought by inspecting someone's signed-in identity.

export interface BrowserProfile {
  readonly name: string;
  readonly directory: string;
}

export class MalformedProfilesFileError extends Error {}

// The profiles file: JSON, {"browserProfiles": [{"name", "directory"}, ...]}.
// Absent file -> no identities (the built-in chrome recipe is unaffected).
// Every failure carries its own distinct message: a shared message would let a
// mutation removing one check hide behind another.
export function loadProfilesFile(path: string): readonly BrowserProfile[] {
  if (!existsSync(path)) {
    // Naming no identities composes none.
    return [];
  }
  const text = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MalformedProfilesFileError(
      `the profiles file at ${path} is not valid JSON - a file naming browser identities that cannot be parsed must not silently become "no profiles"`,
    );
  }
  const entries = (parsed as { browserProfiles?: unknown })?.browserProfiles;
  if (
    !Array.isArray(entries) ||
    entries.some(
      (entry) =>
        typeof (entry as BrowserProfile)?.name !== "string" ||
        typeof (entry as BrowserProfile)?.directory !== "string",
    )
  ) {
    throw new MalformedProfilesFileError(
      `the profiles file at ${path} must be {"browserProfiles": [{"name": "...", "directory": "/absolute/path"}, ...]} - refusing to guess what was meant`,
    );
  }

  // Normalisation precedes every comparison (the M0.5 math-bold lesson), so a
  // math-bold name collides with its plain form exactly as it should.
  const profiles: BrowserProfile[] = (entries as BrowserProfile[]).map((entry) => ({
    name: normalise(entry.name),
    directory: entry.directory,
  }));

  const seenNames = new Set<string>();
  // The built-in browser recipe's own directory is already spoken for: a
  // profile pointing at it would share that jar.
  const seenDirectories = new Map<string, string>([[DEFAULT_CHROME_PROFILE_DIR, "chrome"]]);
  for (const profile of profiles) {
    if (!isAbsolute(profile.directory)) {
      throw new MalformedProfilesFileError(
        `the profiles file at ${path} gives "${profile.name}" a relative directory - a profile directory must be an absolute path, and the daemon will not resolve one against its own working directory`,
      );
    }
    if (findRecipe(profile.name, CATALOG) !== undefined) {
      throw new MalformedProfilesFileError(
        `the profiles file at ${path} names "${profile.name}", which is already a built-in launch recipe - an operator profile must not shadow one`,
      );
    }
    if (seenNames.has(profile.name)) {
      throw new MalformedProfilesFileError(
        `the profiles file at ${path} names "${profile.name}" twice - two identities cannot share one name`,
      );
    }
    const directoryOwner = seenDirectories.get(profile.directory);
    if (directoryOwner !== undefined) {
      throw new MalformedProfilesFileError(
        `the profiles file at ${path} points "${profile.name}" at the directory "${directoryOwner}" already uses - two identities sharing one profile directory would share one cookie jar, which is the boundary a profile is here to draw`,
      );
    }
    seenNames.add(profile.name);
    seenDirectories.set(profile.directory, profile.name);
  }
  return profiles;
}

/**
 * The base catalog plus one recipe per profile, each cloned from the base
 * browser recipe with its --user-data-dir argument swapped for that profile's
 * directory and appearsAs carried over. Pure and boot-time: the base catalog
 * is never mutated, and the base browser entry's argv stays byte-identical.
 */
export function composeCatalog(base: LaunchCatalog, profiles: readonly BrowserProfile[]): LaunchCatalog {
  const browser = findRecipe("chrome", base);
  if (browser === undefined) {
    throw new Error(`compose: the base catalog has no "chrome" recipe to compose profiles from`);
  }
  const composed: Record<string, LaunchRecipe> = { ...base };
  for (const profile of profiles) {
    composed[profile.name] = {
      ...browser,
      argv: browser.argv.map((argument) =>
        argument === `--user-data-dir=${DEFAULT_CHROME_PROFILE_DIR}`
          ? `--user-data-dir=${profile.directory}`
          : argument,
      ),
    };
  }
  return composed;
}

/**
 * The OBSERVE-side expansion: every name, plus the tree name its recipe
 * declares through appearsAs. A composed profile launches a browser that still
 * calls itself "chrome" in the semantic tree, so permitting chrome-work has to
 * imply observing what actually answers, or a permitted launch is unreadable
 * forever.
 *
 * It is never applied to the launch-authority permit set: expanding authority
 * would turn a permit for chrome-work into a permit to launch the built-in
 * chrome on its own profile, which is a different identity (ADR-0038).
 */
export function expandThroughAppearsAs(
  names: ReadonlySet<string>,
  catalog: LaunchCatalog,
): ReadonlySet<string> {
  const expanded = new Set<string>();
  for (const name of names) {
    expanded.add(normalise(name));
    const appearsAs = findRecipe(name, catalog)?.appearsAs;
    if (appearsAs !== undefined) expanded.add(normalise(appearsAs));
  }
  return expanded;
}

export interface BootNameSources {
  /** --permit names: launch authority for this session */
  readonly permits: ReadonlySet<string>;
  /** names read from the grants file */
  readonly grants: Visibility;
  /** --grant flag names */
  readonly flags: Visibility;
  readonly catalog: LaunchCatalog;
}

export interface BootNames {
  readonly launchPermits: ReadonlySet<string>;
  readonly visibility: Visibility;
}

/**
 * The boot-time split, in one testable place. Two sets leave here and they are
 * not the same set: what this session may LAUNCH, and what it may SEE.
 *
 * main.ts is the daemon's entry script and no test can import it, so composing
 * this inline there would leave the milestone's sharpest hazard defended by a
 * human reading a diff.
 */
export function composeBootNames({ permits, grants, flags, catalog }: BootNameSources): BootNames {
  // Launch authority is returned EXACTLY as given (ADR-0038). Expanding it
  // through appearsAs would turn --permit chrome-work into permission to
  // launch the built-in chrome on its own profile - a different identity, and
  // a silent authority leak.
  const launchPermits: ReadonlySet<string> = new Set([...permits].map(normalise));
  // Observe is the opposite: the union law stays in grants.ts (ADR-0036,
  // including "all" winning outright), and every name a session may see is
  // then expanded to what actually answers in the tree - or a permitted launch
  // is unreadable forever and a durable chrome-work grant in the permissions
  // file is inert.
  const union = effectiveVisibility({ file: grants, flags, permits });
  const visibility = union === "all" ? "all" : expandThroughAppearsAs(union, catalog);
  return { launchPermits, visibility };
}
