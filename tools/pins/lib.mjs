import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Shared plumbing for the source-level pins. The four rules of
// docs/05-TEST-STRATEGY.md:36-38 are enforced here and in each pin:
// - every pin asserts its file set is non-empty (in the pin, so the assertion
//   is individually mutable by tools/mutations.mjs);
// - comments are stripped before matching, so a comment naming a banned thing
//   is not a violation;
// - paths resolve from the repository root, so a pin cannot die with
//   MODULE_NOT_FOUND when run from elsewhere;
// - tools/pins/ is excluded from every scan, so no pin can flag itself.

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export function rootFromArgs(argv) {
  const i = argv.indexOf("--root");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : REPO_ROOT;
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".turbo"]);
const OWN_DIR = join("tools", "pins") + sep;

export function collect(root, dirs, exts) {
  const files = [];
  for (const dir of dirs) {
    walk(join(root, dir), exts, files);
  }
  return files.filter((f) => !relative(root, f).startsWith(OWN_DIR));
}

function walk(dir, exts, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // a listed directory may not exist yet; the vacuous-pass guard catches an empty total
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), exts, out);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
}

export function stripComments(source, file) {
  if (file.endsWith(".sh") || file.endsWith(".service")) {
    return source.replace(/^[ \t]*#.*$/gm, "");
  }
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

export function fail(message) {
  console.error(message);
  process.exit(1);
}
