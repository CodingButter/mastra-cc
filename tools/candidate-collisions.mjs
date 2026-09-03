#!/usr/bin/env node
// HOW OFTEN DO TWO INSTALLED APPLICATIONS ANSWER TO THE SAME NAME?
//
// One entry answers to several names - its desktop-entry id, that id's final
// dot-segment, and the `Name=` the machine wrote in the file. Permission
// resolves through those candidates, and where two entries claim the same one
// the daemon refuses rather than picking. That refusal is the conservative
// choice, but it is only ACCEPTABLE if collisions are rare on a real desk: a
// configuration format that mostly refuses is worse than the doubling it
// replaced.
//
// So the rate is measured rather than assumed, against a live daemon's own
// inventory, and this script is committed so the number is reproducible by
// anyone who doubts it.
//
// The catalog's appears-as translation is NOT visible from outside the daemon,
// so this measures the three candidates a wire reader can see. That makes it a
// LOWER bound on collisions - stated here so the number is not read as an
// upper one.
//
//   MASTRA_CC_URL=ws://172.22.0.2:9979 node tools/candidate-collisions.mjs
import { connect } from "../packages/transport/dist/index.mjs";

const url = process.env.MASTRA_CC_URL ?? "ws://127.0.0.1:9979";
const normalise = (value) => value.normalize("NFKC").trim().toLowerCase();

const client = await connect({ url });
const listing = await client.listApplications({});
await client.close();

const entries = listing.applications ?? [];
// candidate -> the entries claiming it, and how each of them came to claim it
const claims = new Map();
const claim = (name, entry, kind) => {
  if (name.length === 0) return;
  const at = claims.get(name) ?? [];
  at.push({ entry: entry.name, kind });
  claims.set(name, at);
};

for (const entry of entries) {
  const id = entry.name;
  claim(normalise(id), entry, "id");
  claim(normalise(id.slice(id.lastIndexOf(".") + 1)), entry, "final dot-segment");
  const displayed = entry.diagnostic?.["mastra-cc/display-name"];
  if (displayed !== undefined) claim(normalise(displayed), entry, "Name=");
}

const collisions = [...claims.entries()]
  .filter(([, at]) => new Set(at.map((c) => c.entry)).size > 1)
  .sort(([a], [b]) => a.localeCompare(b));

console.log(`daemon:      ${url}`);
console.log(`entries:     ${entries.length}`);
console.log(`candidates:  ${claims.size}`);
console.log(`collisions:  ${collisions.length}`);
for (const [name, at] of collisions) {
  console.log(`\n  ${name}`);
  for (const c of at) console.log(`    ${c.entry}  (as ${c.kind})`);
}
// A collision on a name a person would plausibly WRITE in a permit list is the
// material kind, and every candidate this script derives is such a name.
console.log(collisions.length === 0 ? "\nMATERIAL COLLISIONS: none" : `\nMATERIAL COLLISIONS: ${collisions.length}`);
