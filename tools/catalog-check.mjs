import { readFileSync } from "node:fs";

// The catalog-divergence half of CI step 9 (docs/07-ROADMAP.md:78): the
// workspace's pinned toolchain must match the destination monorepo's catalog,
// so the gap never becomes a migration (docs/04-INTEGRATION-PLAN.md §3).
// Exit 0 aligned; exit 1 on divergence or a vacuous watched set; exit 2 when
// the destination could not be read - a network failure is not a pass and not
// a divergence.

const WATCHED = ["typescript", "vitest", "zod", "oxfmt"];
const DESTINATION = "https://raw.githubusercontent.com/mastra-ai/mastra/main/pnpm-workspace.yaml";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function parseCatalog(text) {
  const entries = {};
  let inCatalog = false;
  for (const line of text.split("\n")) {
    if (/^catalog:\s*$/.test(line)) {
      inCatalog = true;
      continue;
    }
    if (!inCatalog) continue;
    const entry = line.match(/^\s+['"]?([^'":\s]+)['"]?:\s*(\S+)\s*$/);
    if (entry) {
      entries[entry[1]] = entry[2].replace(/^['"]|['"]$/g, "");
    } else if (!/^\s/.test(line) && line.trim() !== "") {
      inCatalog = false;
    }
  }
  return entries;
}

// The destination also carries NAMED catalogs - as of this writing a `ts6` escape
// hatch for packages whose toolchain cannot move yet. Parse them into
// { [name]: { [pin]: version } } so a drift there cannot pass unseen.
function parseNamedCatalogs(text) {
  const catalogs = {};
  let current = null;
  let inSection = false;
  for (const line of text.split("\n")) {
    if (/^catalogs:\s*$/.test(line)) {
      inSection = true;
      current = null;
      continue;
    }
    if (!inSection) continue;
    if (!/^\s/.test(line) && line.trim() !== "") {
      inSection = false;
      current = null;
      continue;
    }
    const name = line.match(/^\s{1,2}['"]?([^'":\s]+)['"]?:\s*$/);
    if (name) {
      current = name[1];
      catalogs[current] = catalogs[current] ?? {};
      continue;
    }
    const entry = line.match(/^\s{3,}['"]?([^'":\s]+)['"]?:\s*(\S+)\s*$/);
    if (entry && current) {
      catalogs[current][entry[1]] = entry[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return catalogs;
}

const localPath = arg("--local", new URL("../pnpm-workspace.yaml", import.meta.url));
const destination = arg("--destination", DESTINATION);

const local = parseCatalog(readFileSync(localPath, "utf8"));

let destinationText;
if (/^https?:\/\//.test(destination)) {
  try {
    const res = await fetch(destination);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    destinationText = await res.text();
  } catch (err) {
    console.error(`catalog-check: could not read the destination (${err.message}) - a network failure is not a pass and not a divergence`);
    process.exit(2);
  }
} else {
  try {
    destinationText = readFileSync(destination, "utf8");
  } catch (err) {
    console.error(`catalog-check: could not read the destination (${err.message}) - an unreadable destination is not a pass and not a divergence`);
    process.exit(2);
  }
}
const dest = parseCatalog(destinationText);

// The vacuity guard is DELIBERATELY default-only: the default catalog is the one
// we follow, so an empty watched set there is a check that stopped looking. An
// empty NAMED-catalog comparison is a normal aligned state, not a vacuous pass -
// today we define no named catalogs at all and the traversal below is correctly inert.
const compared = WATCHED.filter((key) => key in local);
if (compared.length === 0) {
  console.error("catalog-check: no watched key found in the local catalog - the check would pass vacuously");
  process.exit(1);
}

const divergences = [];
for (const key of compared) {
  if (!(key in dest)) {
    divergences.push(`catalog-check: ${key} is ${local[key]} here, absent in the destination`);
  } else if (dest[key] !== local[key]) {
    divergences.push(`catalog-check: ${key} is ${local[key]} here, ${dest[key]} in the destination`);
  }
}

// Named catalogs, iterating OURS. The asymmetry is the whole rule:
//   - both sides define it        -> compare the watched pins; a mismatch is a divergence
//   - we define it, they do not   -> divergence, worded like the default path's
//                                    "absent in the destination". We are the follower and we
//                                    are accountable for every named catalog WE chose to make;
//                                    if they finish their migration and drop it, this goes red
//                                    until we delete ours. That red is the forcing function.
//   - they define it, we do not   -> not compared, not a divergence. That is their escape
//                                    hatch for packages we do not have; comparing it would pin
//                                    us to two TypeScript versions at once and never go green.
const localNamed = parseNamedCatalogs(readFileSync(localPath, "utf8"));
const destNamed = parseNamedCatalogs(destinationText);
for (const [name, pins] of Object.entries(localNamed)) {
  if (!(name in destNamed)) {
    divergences.push(`catalog-check: catalog ${name} is defined here, absent in the destination`);
    continue;
  }
  for (const key of WATCHED.filter((k) => k in pins)) {
    const there = destNamed[name][key];
    if (there === undefined) {
      divergences.push(`catalog-check: ${key} in catalog ${name} is ${pins[key]} here, absent in the destination`);
    } else if (there !== pins[key]) {
      divergences.push(`catalog-check: ${key} in catalog ${name} is ${pins[key]} here, ${there} in the destination`);
    }
  }
}

if (divergences.length > 0) {
  for (const divergence of divergences) console.error(divergence);
  process.exit(1);
}
console.log(`catalog-check: ${compared.length} pin(s) compared, aligned with the destination`);
