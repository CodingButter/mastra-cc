import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
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
//
// WHAT IS SHIPPED IS NOT WHAT IS DECLARED (issue #36). Until 2026-08-21 this
// check read each manifest's own dependency list and stopped there, so a
// package's own dependencies were never examined: M3's three new packages
// dragged in licences nobody looked at, and the gate stayed green. That is a
// pass by omission. The same sentence the strategy uses for source applies one
// level down - not declaring a dependency does not mean not shipping it - so
// the runtime half now walks the installed closure and licences what actually
// ships.
//
// THE BOUNDARY, STATED RATHER THAN IMPLIED. The runtime walk follows
// `dependencies`, `optionalDependencies` and `peerDependencies`, because all
// three ship: pnpm installs optional dependencies by default, and a peer that
// is present in the tree is code a user receives however it got there. An
// optional or peer dependency that is NOT installed is not a finding - being
// absent is what those fields allow - while a missing `dependencies` entry
// still is. Bundled dependencies are not read: nothing in this tree declares
// `bundledDependencies`, and a walk for a field no manifest uses would be a
// branch nobody can test.
//
// Development dependencies are checked as declared and their transitive
// closure is NOT walked: a build tool is not distributed, and the licences
// reached that way (the CSS toolchain vite pulls in is MPL-2.0) are a question
// about this repository's build, not about what a user of it receives.
// Widening to that closure is a policy decision and belongs in its own commit,
// not smuggled in with this one. That is the one hole here, and it is the only
// one: this file used to state it as though it were, while `optionalDependencies`
// and `peerDependencies` went unread in silence.

const ALLOWED = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  // Admitted 2026-08-21, on the evidence rather than on the vibe: the Blue Oak
  // Model License is OSI-approved (board minutes of 19 January 2024), its only
  // condition is notice, and it carries an express patent grant. It reaches
  // this tree three times - @isaacs/ttlcache and lru-cache under @mastra/core,
  // and sax under the daemon's XML parsing - and the first walk that could see
  // them is the one that found them. The alternative was to replace three
  // packages we do not depend on directly to avoid a licence more permissive
  // in its patent terms than two already on this list.
  "BlueOak-1.0.0",
]);

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

function declaredLicence(manifestPath) {
  const licence = JSON.parse(readFileSync(manifestPath, "utf8")).license;
  return typeof licence === "object" && licence !== null ? licence.type : licence;
}

// Resolution walks up from the dependent, the way the runtime does, and then
// follows the link. Under pnpm a package's own dependencies live beside its
// real directory in the store and not beside the symlink, so a walk that does
// not call realpath finds four packages and believes the closure is four.
function resolveInstalled(name, from) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, "node_modules", name, "package.json");
    if (existsSync(candidate)) return realpathSync(candidate);
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

let checked = 0;
const problems = [];
// Two maps, not one. A package recorded by the dev loop used to sit in the same
// map the runtime walk early-returns on, so anything that is a dev dependency
// somewhere AND a runtime transitive under a manifest processed later would
// truncate the runtime closure at that node - silently, and dependent on the
// order manifests happen to be walked in. No live collision today; separate
// maps cost nothing and remove the ordering dependency entirely.
const walked = new Map(); // real manifest path -> how it got here, for the report
const walkedDev = new Map();

function walkRuntime(name, from, chain, optional = false) {
  const installed = resolveInstalled(name, from);
  if (!installed) {
    // An optional or peer dependency is allowed to be absent; a hard one is not.
    if (!optional) {
      problems.push(`licences: ${name} is shipped via ${chain.join(" > ")} but is not installed - its licence cannot be verified`);
    }
    return;
  }
  if (walked.has(installed)) return;
  walked.set(installed, chain);

  const value = declaredLicence(installed);
  if (!licenceAllowed(value)) {
    problems.push(`licences: ${name} is "${value}" - not on the permissive allowlist (shipped via ${chain.join(" > ")})`);
  }
  checked += 1;

  const pkg = JSON.parse(readFileSync(installed, "utf8"));
  for (const [field, optional] of [["dependencies", false], ["optionalDependencies", true], ["peerDependencies", true]]) {
    for (const [child, spec] of Object.entries(pkg[field] ?? {})) {
      if (typeof spec === "string" && (spec.startsWith("workspace:") || spec.startsWith("link:"))) continue;
      walkRuntime(child, dirname(installed), [...chain, name], optional);
    }
  }
}

for (const manifest of found) {
  const pkg = JSON.parse(readFileSync(join(root, manifest), "utf8"));
  const here = join(root, dirname(manifest));

  // Runtime: everything that ships, however far down.
  for (const [field, optional] of [["dependencies", false], ["optionalDependencies", true], ["peerDependencies", true]]) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (spec.startsWith("workspace:")) continue;
      walkRuntime(name, here, [manifest], optional);
    }
  }

  // Development: as declared, for the reason stated at the top of this file.
  for (const [name, spec] of Object.entries(pkg.devDependencies ?? {})) {
    // A `catalog:` pin is a version held in pnpm-workspace.yaml, not a reason
    // to skip: the package behind it is as third-party as any other, and
    // skipping it put typescript and vitest outside a gate that reported them
    // as inside it. Resolution is by NAME, so the spec's shape does not matter.
    if (spec.startsWith("workspace:")) continue;
    const installed = resolveInstalled(name, here);
    if (!installed) {
      problems.push(`licences: ${name} (declared in ${manifest}) is not installed - its licence cannot be verified`);
      continue;
    }
    if (walkedDev.has(installed)) continue;
    walkedDev.set(installed, [manifest]);
    const value = declaredLicence(installed);
    if (!licenceAllowed(value)) {
      problems.push(`licences: ${name} is "${value}" - not on the permissive allowlist (declared in ${manifest})`);
    }
    checked += 1;
  }
}

// Real findings are reported before any guard about the shape of the run.
// A vacuity guard exists to stop a false GREEN; letting one speak over a
// licence this gate actually objected to would hide the answer behind a
// complaint about how it was reached. Both still exit 1, so nothing is lost
// but the order in which an operator learns it.
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
if (checked === 0) {
  console.error("licences: no dependency declared in any manifest - the check would pass vacuously");
  process.exit(1);
}
// A walk that reached no further than the names it was given is a walk that
// did not happen. The measurement is not a package count - any threshold I
// pick is a guess that rots - but whether anything was reached THROUGH a
// dependent: a chain longer than one is a package no manifest here declares,
// and those are precisely the packages issue #36 was filed about. Zero of
// them means this is a declared-list read wearing a walk's report. Deleting
// the recursion is how that was measured, and the first version of this guard
// survived it.
const transitive = [...walked.values()].filter((chain) => chain.length > 1).length;
if (transitive === 0) {
  console.error(
    `licences: the walk reached ${walked.size} package(s) and none of them through a dependent - it did not walk`,
  );
  process.exit(1);
}
console.log(
  `licences: ok - ${found.length} manifest(s), ${checked} package(s) on the permissive allowlist (runtime walked to its closure, development as declared)`,
);
