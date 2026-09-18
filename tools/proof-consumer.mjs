#!/usr/bin/env node
// Build a consumer install of this workspace's published packages, the way a
// real installation would have them, for the native proofs to run against.
//
// This exists because the obvious command does not work. `npm pack` leaves
// `workspace:*` in the tarball's dependencies, and `npm install` then refuses
// the whole tree with "Unsupported URL Type". Every native proof hit this and
// each one worked around it by hand - unpacking tarballs into node_modules and
// rewriting their package.json in place. Hand-assembled artifacts are exactly
// what a proof must not rest on: the point of installing rather than importing
// from source is that the thing under test is the thing a user would get.
//
// So: pack with pnpm, which resolves `workspace:*` to the real version, then
// point every @mastra-cc specifier at the tarball beside it so nothing is
// looked up in a registry it was never published to.
//
//   node tools/proof-consumer.mjs <destination> [--mastra <node_modules to borrow>]
//
// It prints the node_modules path the proof runners want.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["protocol-types", "transport", "desktop"];

const args = process.argv.slice(2);
const destination = resolve(args[0] ?? join(root, ".proof-consumer"));
const borrowIndex = args.indexOf("--mastra");
const borrow = borrowIndex === -1 ? undefined : resolve(args[borrowIndex + 1]);

rmSync(destination, { recursive: true, force: true });
mkdirSync(join(destination, "consumer"), { recursive: true });

// pnpm pack, not npm pack: it is the one that rewrites the workspace protocol.
const tarballs = new Map();
for (const name of PACKAGES) {
  execFileSync("pnpm", ["pack", "--pack-destination", destination], { cwd: join(root, "packages", name), stdio: ["ignore", "ignore", "inherit"] });
  const file = readdirSync(destination).find((entry) => entry.startsWith(`mastra-cc-${name}-`) && entry.endsWith(".tgz"));
  if (file === undefined) throw new Error(`pnpm pack produced no tarball for ${name}`);
  tarballs.set(`@mastra-cc/${name}`, `file:../${file}`);
}

// Overrides as well as dependencies: a tarball's own @mastra-cc dependency
// names a version number that was never published anywhere, and without the
// override npm would go looking for it in a registry.
const manifest = {
  name: "mastra-cc-proof-consumer",
  private: true,
  type: "module",
  description: "packages of this workspace, installed the way a consumer would have them",
  dependencies: Object.fromEntries(tarballs),
  overrides: Object.fromEntries(tarballs),
};
writeFileSync(join(destination, "consumer", "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel", "error"], {
  cwd: join(destination, "consumer"),
  stdio: ["ignore", "inherit", "inherit"],
});

// The desktop package's framework dependencies (@mastra/*) are the consumer's
// to provide, exactly as they would be in a real installation. A proof borrows
// them from an existing install rather than pulling the network into a run that
// claims to make no network calls.
const modules = join(destination, "consumer", "node_modules");
if (borrow !== undefined) {
  for (const entry of readdirSync(borrow)) {
    const target = join(modules, entry);
    if (existsSync(target)) continue;
    symlinkSync(join(borrow, entry), target);
  }
}

const installed = JSON.parse(readFileSync(join(modules, "@mastra-cc", "protocol-types", "package.json"), "utf8"));
process.stdout.write(`${modules}\n`);
process.stderr.write(`proof-consumer: @mastra-cc/protocol-types ${installed.version} installed at ${modules}\n`);
