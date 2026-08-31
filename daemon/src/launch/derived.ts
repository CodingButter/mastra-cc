import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { normalise } from "../backends/atspi/names.js";
import { entryValue } from "../inventory.js";
import type { LaunchCatalog, LaunchRecipe } from "./recipes.js";

// THE MACHINE'S OWN CATALOG, read as launch recipes.
//
// The hand-written CATALOG (recipes.ts) is four exceptions, each added for a
// real reason and none of them an architecture. Everything else installed on
// the machine refused, not for want of authority but for want of a recipe -
// so an agent could only ever operate what a human had already started.
//
// The daemon already reads every .desktop file to answer listApplications
// (inventory.ts); this module reads ONE more key from the same files - Exec -
// and turns it into static argv. Wire input still only ever selects a catalog
// key: argv is composed at boot from files the daemon read itself, and
// spawn.ts keeps shell: false.
//
// The environment is the union of the two knobs this repository MEASURED:
// GTK3's atk-bridge module (recipes.ts:45-52, measured M0.5) and Qt6's
// QT_LINUX_ACCESSIBILITY_ALWAYS_ON (recipes.ts:91-101, measured M2.5 Q05 -
// without it Qt6 publishes an application root with ChildCount 0). Both are
// toolkit-generic and both are IGNORED by a toolkit that does not read them,
// which is the property that makes a union safe here - an unknown environment
// variable costs nothing, an unknown argv flag can make a program refuse to
// start. That is why the enabling generalises through env and never through
// argv, and it is ADR-0027 applied rather than replaced: readability is
// decided once at process start, so the enabling rides the launch.
//
// No knob is added that no measurement in this repository supports.
const ACCESSIBILITY_ENV: Readonly<Record<string, string>> = {
  GTK_MODULES: "gail:atk-bridge",
  QT_LINUX_ACCESSIBILITY_ALWAYS_ON: "1",
};

// The freedesktop Desktop Entry Specification's field codes. Every one of them
// stands for something the daemon is not supplying - a file, a URL, the icon,
// the entry's own display name or file path - so every one of them is removed
// rather than passed through as a literal. %c and %k dropping is also what
// keeps a display name and a filesystem path out of argv.
const FIELD_CODES = ["%f", "%F", "%u", "%U", "%d", "%D", "%n", "%N", "%i", "%c", "%k", "%v", "%m"];

// argv[0]s that are not the application. A shell would reintroduce a command
// line through the file even though spawn keeps shell: false, and a wrapper's
// basename ("flatpak", "env") is a tree name no window will ever report, which
// would silently break the observe-side appearsAs expansion. Refusing leaves
// today's behaviour for those entries, which the machine already survives.
const WRAPPERS = new Set(["sh", "bash", "dash", "zsh", "env", "flatpak", "snap"]);

// Split an Exec value per the specification's quoting: double quotes may hold
// spaces, and \\ \" \` \$ are the escapes recognised inside them. Anything
// unbalanced returns undefined - a half-parsed argv spawns the wrong thing,
// and no recipe at all refuses exactly as today.
function splitExec(value: string): string[] | undefined {
  const tokens: string[] = [];
  let token = "";
  let started = false;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === "\\") {
        const next = value[index + 1];
        if (next === undefined) return undefined;
        if (next === "\\" || next === '"' || next === "`" || next === "$") {
          token += next;
          index += 1;
          continue;
        }
        token += character;
        continue;
      }
      if (character === '"') {
        quoted = false;
        continue;
      }
      token += character;
      continue;
    }
    if (character === '"') {
      quoted = true;
      started = true;
      continue;
    }
    if (character === " " || character === "\t") {
      if (started) tokens.push(token);
      token = "";
      started = false;
      continue;
    }
    token += character;
    started = true;
  }
  if (quoted) return undefined;
  if (started) tokens.push(token);
  return tokens;
}

// Remove the field codes from one token, leaving %% as a literal percent. A
// token that was nothing but field codes disappears entirely.
function stripFieldCodes(token: string): string {
  let out = "";
  for (let index = 0; index < token.length; index += 1) {
    if (token[index] !== "%") {
      out += token[index];
      continue;
    }
    const pair = token.slice(index, index + 2);
    if (pair === "%%") {
      out += "%";
      index += 1;
      continue;
    }
    if (FIELD_CODES.includes(pair)) {
      index += 1;
      continue;
    }
    out += "%";
  }
  return out;
}

/**
 * One desktop entry's Exec value as argv, or undefined when this entry must
 * produce no recipe: empty, unbalanced, a wrapper or shell, or nothing left
 * once the field codes are gone.
 */
export function argvFromExec(value: string): string[] | undefined {
  const tokens = splitExec(value);
  if (tokens === undefined) return undefined;
  const argv = tokens.map(stripFieldCodes).filter((token) => token !== "");
  if (argv.length === 0) return undefined;
  if (WRAPPERS.has(basename(argv[0]))) return undefined;
  return argv;
}

function recipeFrom(text: string): LaunchRecipe | undefined {
  if (entryValue(text, "Type") !== "Application") return undefined;
  // Terminal=true means the Exec is meaningless without a terminal emulator
  // wrapping it. Spawned with no tty the process exits at once or runs
  // invisibly while the launch reports success - the "the call returned and
  // nothing happened" failure this whole change exists to avoid.
  if (entryValue(text, "Terminal") === "true") return undefined;
  // NoDisplay and Hidden are deliberately NOT consulted: they are statements
  // about menus, and inventory.ts already records them without dropping the
  // entry. Launchability takes the same position or the two would disagree
  // about the same file.
  const exec = entryValue(text, "Exec");
  if (exec === undefined) return undefined;
  const argv = argvFromExec(exec);
  if (argv === undefined) return undefined;
  return { argv, env: ACCESSIBILITY_ENV, appearsAs: normalise(basename(argv[0])) };
}

function scanDirectory(directory: string): Map<string, LaunchRecipe> {
  const found = new Map<string, LaunchRecipe>();
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    // A directory that is not there is not an error - XDG_DATA_DIRS names
    // where entries MAY live.
    return found;
  }
  for (const fileName of names.sort()) {
    if (!fileName.endsWith(".desktop")) continue;
    const path = join(directory, fileName);
    let text: string;
    try {
      if (!statSync(path).isFile()) continue;
      text = readFileSync(path, "utf8");
    } catch {
      // One unreadable file must not cost the whole derivation.
      continue;
    }
    const recipe = recipeFrom(text);
    if (recipe === undefined) continue;
    found.set(normalise(fileName.slice(0, -".desktop".length)), recipe);
  }
  return found;
}

/**
 * The machine's installed applications as a launch catalog, keyed by the same
 * normalised desktop entry id listApplications reports, in the same XDG
 * precedence order: the earlier directory wins, so a user's own copy of an
 * entry shadows the system one. A derived catalog that disagreed with the
 * reported inventory would be a lie about the same file.
 *
 * This function reads files and returns data. It spawns nothing.
 */
export function deriveLaunchCatalog(directories: string[]): LaunchCatalog {
  const found = new Map<string, LaunchRecipe>();
  for (const directory of directories) {
    for (const [id, recipe] of scanDirectory(directory)) {
      if (!found.has(id)) found.set(id, recipe);
    }
  }
  return Object.fromEntries(found);
}
