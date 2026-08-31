import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalise } from "./backends/atspi/names.js";

// WHAT THIS MACHINE HAS, read from outside every application (ADR-0042).
//
// The doctrine this file implements is the reversal M2.6 exists for: an
// application this session may not touch is PRESENT in the answer with its
// capabilities off, rather than absent. Withholding its existence does not
// produce ignorance, it produces a false belief - an assistant told a program
// is not installed recommends installing what is already installed, and an
// assistant told a capability does not exist reports a limit that is really a
// settings toggle.
//
// The mechanism is Linux-shaped and the result is not (ADR-0017): a desktop
// entry directory is a platform fact, and nothing that leaves this module
// names one. What crosses is a name and, at most, a debug-only diagnostic.
//
// NOTHING FROM INSIDE AN APPLICATION IS READ HERE. This module opens no
// application, reads no window and asks no accessibility bus. It reads the
// machine's own catalogue of what is installed - the same files a desktop menu
// reads - and even that is reported as a name, never as a path or a command
// line. Existence and permission are readable; content is not.

export interface InventoryEntry {
  /** the callable name, NFKC-normalised: the desktop entry's id, which is what a launch recipe keys on */
  readonly name: string;
  /** debug-only, never load-bearing (the wire contract's own words about diagnostics) */
  readonly diagnostic?: Record<string, string>;
}

// The directories a freedesktop-conformant machine keeps its entries in, in
// precedence order, honouring XDG_DATA_HOME and XDG_DATA_DIRS with the
// specification's defaults. Earlier wins: a user's own copy of an entry
// SHADOWS the system one of the same id, which is the whole reason precedence
// is specified rather than left to directory order.
export function desktopEntryDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.XDG_DATA_HOME ?? (env.HOME === undefined ? undefined : join(env.HOME, ".local", "share"));
  const system = (env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":").filter((entry) => entry !== "");
  return [...(home === undefined ? [] : [home]), ...system].map((directory) => join(directory, "applications"));
}

// Exported so launch/derived.ts reads a desktop entry the same way this module
// does. A second parser that disagreed about which group a value came from
// would make listApplications and openApplication describe different files.
export function entryValue(text: string, key: string): string | undefined {
  // The [Desktop Entry] group only: a value under an action group or a
  // localised key is a different fact, and reading one as the entry's own
  // would report something the file does not say.
  let inGroup = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inGroup = line === "[Desktop Entry]";
      continue;
    }
    if (!inGroup) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    if (line.slice(0, separator).trim() !== key) continue;
    return line.slice(separator + 1).trim();
  }
  return undefined;
}

// One directory's entries, keyed by desktop entry id (the file name without
// its suffix). Type=Application is what makes an entry an application; a
// directory entry or a link is not one, and is not reported as one.
//
// NoDisplay and Hidden are RECORDED, never used to drop an entry. They mean
// "do not show this in a menu", which is a statement about menus - an
// application a menu hides is still installed, and reporting it as absent is
// the exact false belief this module exists to prevent.
function scanDirectory(directory: string): Map<string, InventoryEntry> {
  const found = new Map<string, InventoryEntry>();
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    // A directory that is not there is not an error: XDG_DATA_DIRS names
    // where entries MAY live, and most machines have entries in some of them.
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
      // One unreadable file must not cost the whole inventory, so the scan
      // continues past it. It is not reported as an application either: the
      // only thing known about it is its file name, and a name in a directory
      // is not evidence that an application is installed - reporting it would
      // invent exactly the kind of fact ADR-0045 clause 4 forbids. The skip is
      // pinned by a test (a malformed entry is absent and its neighbours
      // survive) rather than by a diagnostic, because there is no entry to
      // hang a diagnostic on.
      continue;
    }
    const id = normalise(fileName.slice(0, -".desktop".length));
    if (entryValue(text, "Type") !== "Application") continue;
    const diagnostic: Record<string, string> = { "mastra-cc/desktop-entry-id": id };
    const displayed = entryValue(text, "Name");
    if (displayed !== undefined) diagnostic["mastra-cc/display-name"] = displayed;
    if (entryValue(text, "NoDisplay") === "true") diagnostic["mastra-cc/menu-visibility"] = "no-display";
    if (entryValue(text, "Hidden") === "true") diagnostic["mastra-cc/menu-visibility"] = "hidden";
    found.set(id, { name: id, diagnostic });
  }
  return found;
}

// The machine's inventory: every application entry across the directories, in
// precedence order, deduplicated by id with the earlier directory winning.
//
// Two entries with the same DISPLAY name are two applications and both
// surface: the id is what distinguishes them, and collapsing them would hide
// one of the two behind the other. Two entries with the same ID are one
// application seen twice, and the first directory's copy is the one that wins,
// because that is what the machine itself would launch.
export function scanInstalledApplications(directories: string[]): InventoryEntry[] {
  const found = new Map<string, InventoryEntry>();
  for (const directory of directories) {
    for (const [id, entry] of scanDirectory(directory)) {
      if (!found.has(id)) found.set(id, entry);
    }
  }
  return [...found.values()].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}
