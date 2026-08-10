import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// B12 as a CI job over every manifest, not a source pin
// (docs/01-ARCHITECTURE.md:139-150). It checks manifests rather than source
// because deleting code does not delete the dependency
// (docs/05-TEST-STRATEGY.md:34). The two holes the strategy names, recorded:
// - a system library that is required but not shipped by npm needs a written
//   exemption in this block, with its reason. None exists yet.
// - an abandoned-but-permissive package passes this check; adoption of one
//   records a maintenance note in the adopting package's manifest commit.

const ALLOWED = new Set(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD"]);

const root = fileURLToPath(new URL("..", import.meta.url));

const manifests = ["package.json", "daemon/package.json", "tools/package.json"];
for (const group of ["packages", "apps"]) {
  if (!existsSync(join(root, group))) continue;
  for (const name of readdirSync(join(root, group))) {
    manifests.push(join(group, name, "package.json"));
  }
}
const found = manifests.filter((m) => existsSync(join(root, m)));
if (found.length === 0) {
  console.error("licences: no manifest found - the check would pass vacuously");
  process.exit(1);
}

function licenceAllowed(licence) {
  if (typeof licence !== "string" || licence.length === 0) return false;
  const bare = licence.replace(/[()]/g, "");
  if (bare.includes(" OR ")) return bare.split(" OR ").some((l) => ALLOWED.has(l.trim()));
  if (bare.includes(" AND ")) return bare.split(" AND ").every((l) => ALLOWED.has(l.trim()));
  return ALLOWED.has(bare.trim());
}

let checked = 0;
const problems = [];
for (const manifest of found) {
  const pkg = JSON.parse(readFileSync(join(root, manifest), "utf8"));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const [name, spec] of Object.entries(deps)) {
    if (spec.startsWith("workspace:")) continue;
    const candidates = [
      join(root, dirname(manifest), "node_modules", name, "package.json"),
      join(root, "node_modules", name, "package.json"),
    ];
    const installed = candidates.find((c) => existsSync(c));
    if (!installed) {
      problems.push(`licences: ${name} (declared in ${manifest}) is not installed - its licence cannot be verified`);
      continue;
    }
    const licence = JSON.parse(readFileSync(installed, "utf8")).license;
    const value = typeof licence === "object" && licence !== null ? licence.type : licence;
    if (!licenceAllowed(value)) {
      problems.push(`licences: ${name} is "${value}" - not on the permissive allowlist (declared in ${manifest})`);
    }
    checked += 1;
  }
}

if (checked === 0) {
  console.error("licences: no dependency declared in any manifest - the check would pass vacuously");
  process.exit(1);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`licences: ok - ${found.length} manifest(s), ${checked} declared dependency(ies) on the permissive allowlist`);
