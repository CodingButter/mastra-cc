import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { assertRoots, collect, fail, rootFromArgs, stripComments } from "./lib.mjs";

// B5: no second socket implementation outside packages/transport (ADR-0003 - the
// transport package is the one daemon client). The daemon itself serves the
// socket, so daemon/ is not scanned; every other tree that could dial it is.

const NET_IMPORT = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)["'](?:node:)?net["']/;
const TRANSPORT_DIR = join("packages", "transport") + sep;

const SCAN_ROOTS = ["packages", "tools", "scripts"];

const root = rootFromArgs(process.argv);
assertRoots(root, SCAN_ROOTS, "pin-b5");
const files = collect(root, SCAN_ROOTS, [".ts", ".js", ".mjs", ".cjs"]).filter(
  (f) => !relative(root, f).startsWith(TRANSPORT_DIR),
);

if (files.length === 0) fail("pin-b5: no files matched - the pin would pass vacuously");

const violations = [];
for (const file of files) {
  const source = stripComments(readFileSync(file, "utf8"), file);
  if (NET_IMPORT.test(source)) {
    violations.push(`pin-b5: socket implementation outside packages/transport at ${relative(root, file)}`);
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  process.exit(1);
}
console.log(`pin-b5: ok - ${files.length} file(s), no socket client outside packages/transport`);
