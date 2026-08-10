import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail, rootFromArgs } from "./lib.mjs";

// B10: no platform vocabulary on the wire (ADR-0018). The deny-list lives in
// deny-list.json next to this pin and GROWS IN THE SAME COMMIT as any backend
// that introduces platform vocabulary to the codebase (clause 5) - Phase 4's
// accessibility backend added its bus terms there. Every term is matched
// against every field name, enum value, method name, description, role
// and state in protocol/schema.json. Clause 1 of the ADR names enum values
// explicitly. The ONE exemption is clause 6: any subtree under a field named
// "diagnostic" - the exemption is encoded by FIELD NAME, not by pattern, so a
// future field cannot accidentally satisfy it. The schema is parsed as JSON,
// which has no comments, so comment-stripping (pin rule 2) holds by
// construction. Every violation is reported, not just the first (pin rule 4).
//
// Usage: node tools/pins/b10.mjs [--root <dir>] [--schema <file>]

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const schemaPath = arg("--schema") ?? join(rootFromArgs(process.argv), "protocol", "schema.json");

let schemaText = "";
try {
  schemaText = readFileSync(schemaPath, "utf8");
} catch {
  // missing file falls through to the vacuous-pass guard
}
if (!schemaText.trim()) fail("pin-b10: schema is missing or empty - the pin would pass vacuously");

let DENY = [];
try {
  DENY = JSON.parse(readFileSync(join(rootFromArgs(process.argv), "tools", "pins", "deny-list.json"), "utf8"));
} catch {
  // missing file falls through to the vacuous-pass guard
}
if (!Array.isArray(DENY) || DENY.length === 0) {
  fail("pin-b10: deny-list.json is missing or empty - the pin would pass vacuously");
}
const matchers = DENY.map((term) => ({
  term,
  re: new RegExp(`(^|[^a-z0-9])${term.replace("-", "\\-")}([^a-z0-9]|$)`, "i"),
}));

const violations = [];
let checked = 0;

function check(text, where) {
  checked += 1;
  for (const { term, re } of matchers) {
    if (re.test(text)) violations.push(`"${term}" at ${where}: ${JSON.stringify(text)}`);
  }
}

function scan(node, path) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => scan(item, `${path}[${i}]`));
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "diagnostic") continue; // clause 6: the only exemption, by field name
      check(key, `${path}.${key} (name)`);
      scan(value, `${path}.${key}`);
    }
  } else if (typeof node === "string") {
    check(node, path);
  }
}

scan(JSON.parse(schemaText), "schema");

if (violations.length > 0) {
  for (const v of violations) console.error(`pin-b10: ${v}`);
  fail(`pin-b10: ${violations.length} platform term(s) on the wire`);
}
console.log(
  `pin-b10: ${checked} string(s) checked, no platform vocabulary on the wire (diagnostic subtree exempt by field name)`,
);
