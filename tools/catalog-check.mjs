import { readFileSync } from "node:fs";

// The catalog-divergence half of CI step 9 (docs/07-ROADMAP.md:75): the
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

if (divergences.length > 0) {
  for (const divergence of divergences) console.error(divergence);
  process.exit(1);
}
console.log(`catalog-check: ${compared.length} pin(s) compared, aligned with the destination`);
