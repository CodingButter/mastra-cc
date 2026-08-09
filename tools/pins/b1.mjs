import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { collect, fail, rootFromArgs, stripComments } from "./lib.mjs";

// B1: only daemon/ may import a D-Bus or accessibility binding
// (docs/01-ARCHITECTURE.md §5). Scans every source tree that is not the daemon.

const BANNED = ["dbus-native", "@homebridge/dbus-native", "dbus-next", "node-atspi"];

const root = rootFromArgs(process.argv);
const files = collect(root, ["packages", "apps", "tools", "scripts"], [".ts", ".js", ".mjs", ".cjs"]);

if (files.length === 0) fail("pin-b1: no files matched - the pin would pass vacuously");

const violations = [];
for (const file of files) {
  const source = stripComments(readFileSync(file, "utf8"), file);
  for (const name of BANNED) {
    if (source.includes(`"${name}"`) || source.includes(`'${name}'`)) {
      violations.push(`pin-b1: D-Bus binding "${name}" referenced outside daemon/ at ${relative(root, file)}`);
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  process.exit(1);
}
console.log(`pin-b1: ok - ${files.length} file(s), no D-Bus binding outside daemon/`);
