import { existsSync, readFileSync } from "node:fs";
import { applicationName } from "./backends/atspi/names.js";

// The observe-visibility model (M2.3). An application the operator has not
// granted is ABSENT from every answer - not "blocked", absent
// (docs/00-PRODUCT.md: a visible-but-blocked app tells the agent something
// about the user's machine that the user did not agree to share). Grants live
// in a daemon-local permissions file the operator owns (ADR-0036); the file's
// absence grants nothing. "all" is the explicit everything mode (trust is a
// mode, ADR-0028) - a value an operator or a test states, never a default.

export type Visibility = ReadonlySet<string> | "all";

export class MalformedGrantsFileError extends Error {}

// The grants file: JSON, {"applications": ["name", ...]}. Entries are
// NFKC-normalised, case-folded AT LOAD, so the set itself is normalised and membership
// checks never see raw file bytes (a math-bold entry matches its plain form -
// the M0.5 lesson). A file that cannot be parsed must NOT silently become
// "no grants": the operator meant something, so the daemon fails startup
// loudly with a named error instead of guessing.
export function loadGrantsFile(path: string): ReadonlySet<string> {
  if (!existsSync(path)) {
    // Deny by default: the file's absence grants nothing.
    return new Set();
  }
  const text = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MalformedGrantsFileError(
      `the grants file at ${path} is not valid JSON - a permissions file that cannot be parsed must not silently become "no grants"`,
    );
  }
  const applications = (parsed as { applications?: unknown })?.applications;
  if (!Array.isArray(applications) || applications.some((entry) => typeof entry !== "string")) {
    throw new MalformedGrantsFileError(
      `the grants file at ${path} must be {"applications": ["name", ...]} - refusing to guess what was meant`,
    );
  }
  return new Set(applications.map(applicationName));
}

// The effective observe set = grants file ∪ --grant flags ∪ --permit names.
// A launch permit implies an observe grant for the launched name: the launch
// poll reads the launched application, so a permit without visibility would
// make a permitted launch unreadable forever. Composed ONCE at daemon boot
// (main.ts) and nowhere else. Any component being "all" makes the result "all".
export function effectiveVisibility(parts: {
  file: Visibility;
  flags: Visibility;
  permits: Visibility;
}): Visibility {
  const components = [parts.file, parts.flags, parts.permits];
  if (components.includes("all")) return "all";
  const union = new Set<string>();
  for (const component of components) {
    for (const name of component as ReadonlySet<string>) union.add(applicationName(name));
  }
  return union;
}

export function isVisible(visibility: Visibility, name: string): boolean {
  return visibility === "all" || visibility.has(applicationName(name));
}
