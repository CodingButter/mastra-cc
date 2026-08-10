import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { collect, fail, rootFromArgs, stripComments } from "./lib.mjs";

// B8: no raw input tools anywhere in the tree, and no shelling out to them.
// The ban is stated in docs/02-DECISIONS/0004-semantic-first-pixels-last.md:32.

const BANNED_TOOL = /\b(xdotool|wmctrl|uinput)\b/;

const root = rootFromArgs(process.argv);
const files = collect(
  root,
  ["daemon", "packages", "apps", "tools", "scripts", "infra"],
  [".ts", ".js", ".mjs", ".cjs", ".sh", ".service"],
);

if (files.length === 0) fail("pin-b8: no files matched - the pin would pass vacuously");

const violations = [];
for (const file of files) {
  const source = stripComments(readFileSync(file, "utf8"), file);
  const match = source.match(BANNED_TOOL);
  if (match) {
    violations.push(`pin-b8: raw input tool "${match[1]}" referenced at ${relative(root, file)} (banned, ADR-0004:32)`);
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  process.exit(1);
}
console.log(`pin-b8: ok - ${files.length} file(s), no raw input tool referenced`);
