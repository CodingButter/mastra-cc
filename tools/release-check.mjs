import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// A tarball is the only artefact a consumer ever sees, so it is the only thing
// worth checking. For each publishable package: pack it, unpack the tarball
// somewhere outside this workspace, and read what actually landed.
//
// Three claims, each one a way a publish silently ships something broken:
//   (a) no `workspace:` specifier survived - pnpm rewrites those at pack time,
//       and if that ever stops happening the package is uninstallable off-repo;
//   (b) every declared entry point (main, types, exports) exists in the tarball
//       - a `files` list that forgets `dist` produces a package that resolves
//       to nothing;
//   (c) every dependency is a resolvable range, and none of them is private -
//       a published package cannot depend on one that will never exist.
//
// Exit 0 all clear; exit 1 on any violation or a vacuous package set.

// The repository by default; `--root <dir>` lets the check be pointed at a
// fixture tree, which is how its own tests plant a red without editing the
// packages this repository actually ships.
const rootArg = process.argv.indexOf("--root");
const ROOT = rootArg === -1 ? resolve(import.meta.dirname, "..") : resolve(process.argv[rootArg + 1]);

// The publishable set, stated here rather than discovered, so ADDING a package
// to the release surface is a deliberate edit and not a side effect of a glob.
// The daemon and the root stay off this list on purpose: the daemon ships as a
// systemd install (infra/apply.sh), not as a library.
const PUBLISHABLE = ["packages/protocol-types", "packages/transport", "packages/desktop"];

function manifest(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

function entryPoints(pkg) {
  const points = [];
  for (const key of ["main", "types", "module", "bin"]) {
    if (typeof pkg[key] === "string") points.push(pkg[key]);
  }
  const walk = (node) => {
    if (typeof node === "string") points.push(node);
    else if (node && typeof node === "object") for (const value of Object.values(node)) walk(value);
  };
  walk(pkg.exports);
  return points.filter((p) => p.startsWith("./") || p.startsWith("dist") || p.startsWith("src"));
}

const problems = [];
const checked = [];

for (const relative of PUBLISHABLE) {
  const dir = join(ROOT, relative);
  if (!existsSync(join(dir, "package.json"))) {
    problems.push(`${relative}: no package.json - the publishable set names a package that is not here`);
    continue;
  }
  const source = manifest(dir);
  if (source.private) {
    problems.push(`${relative}: marked private, but it is on the publishable list`);
    continue;
  }
  if (!source.version || source.version === "0.0.0") {
    problems.push(`${relative}: version ${JSON.stringify(source.version)} is not a real version`);
    continue;
  }

  const scratch = mkdtempSync(join(tmpdir(), "mastra-cc-release-"));
  try {
    execFileSync("pnpm", ["pack", "--pack-destination", scratch], { cwd: dir, stdio: "pipe" });
    const tarball = readdirSync(scratch).find((f) => f.endsWith(".tgz"));
    if (!tarball) {
      problems.push(`${relative}: pnpm pack produced no tarball`);
      continue;
    }
    execFileSync("tar", ["-xzf", join(scratch, tarball), "-C", scratch]);
    const unpacked = join(scratch, "package");
    const shipped = manifest(unpacked);

    // (a) - read the whole shipped manifest, not just the dependency blocks, so
    // a workspace protocol hiding in an unexpected field is still caught.
    const workspaceRefs = [...JSON.stringify(shipped).matchAll(/"(workspace:[^"]*)"/g)].map((m) => m[1]);
    for (const ref of workspaceRefs) {
      problems.push(`${relative}: tarball still carries a workspace specifier ${JSON.stringify(ref)}`);
    }

    // (b)
    const declared = entryPoints(shipped);
    if (declared.length === 0) problems.push(`${relative}: tarball declares no entry point at all`);
    for (const point of declared) {
      if (!existsSync(join(unpacked, point))) {
        problems.push(`${relative}: entry point ${point} is declared but absent from the tarball`);
      }
    }

    // (c)
    for (const [name, range] of Object.entries(shipped.dependencies ?? {})) {
      if (typeof range !== "string" || range.trim() === "") {
        problems.push(`${relative}: dependency ${name} has no usable range`);
        continue;
      }
      const local = PUBLISHABLE.map((p) => join(ROOT, p)).find((p) => manifest(p).name === name);
      if (local && manifest(local).private) {
        problems.push(`${relative}: depends on ${name}, which is private and will never resolve`);
      }
    }

    // (d) - a shipped file may not import a package whose entry point is
    // TypeScript SOURCE. Inside this workspace such an import works, because
    // every runner here strips types; on a consumer's machine node refuses to
    // strip types under node_modules and the import dies. The failure is
    // invisible until someone installs the tarball, which is exactly the class
    // of bug a release check exists for.
    const sourceEntryPackages = new Set(
      PUBLISHABLE.map((p) => join(ROOT, p))
        .map((p) => manifest(p))
        .filter((m) => typeof m.main === "string" && m.main.endsWith(".ts"))
        .map((m) => m.name),
    );
    const shippedFiles = [];
    const collect = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) collect(full);
        else if (/\.(mjs|cjs|js)$/.test(entry.name)) shippedFiles.push(full);
      }
    };
    collect(unpacked);
    for (const file of shippedFiles) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/from\s*"([^"]+)"|require\("([^"]+)"\)|import\("([^"]+)"\)/g)) {
        const specifier = match[1] ?? match[2] ?? match[3];
        for (const name of sourceEntryPackages) {
          if (specifier === name || specifier.startsWith(`${name}/`)) {
            problems.push(
              `${relative}: ${file.slice(unpacked.length + 1)} imports ${specifier}, whose entry point is TypeScript source - it will not load from node_modules`,
            );
          }
        }
      }
    }

    // Version independence (ADR-0057): the daemon is engineering, the package is
    // judgment, and they release on different clocks. A published package that
    // depended on the daemon would drag one clock onto the other - and the daemon
    // is private besides, so the dependency could never resolve.
    const daemonVersion = manifest(join(ROOT, "daemon")).version;
    for (const [name, range] of Object.entries({ ...shipped.dependencies, ...shipped.peerDependencies })) {
      if (name === "@mastra-cc/daemon") {
        problems.push(`${relative}: depends on the daemon - the two artefacts version separately (ADR-0057)`);
      }
      if (range === daemonVersion && name.startsWith("@mastra-cc/")) {
        problems.push(`${relative}: pins ${name} to the daemon's own version ${range} - that coupling is the thing ADR-0057 forbids`);
      }
    }

    checked.push(`${shipped.name}@${shipped.version}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// The list above is deliberate, which means it can also be FORGOTTEN. A package
// that dropped `private` and never reached this file would be published by a
// release run with none of the checks above ever having looked at it, so the
// omission is a failure here rather than a surprise on the registry.
for (const name of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
  if (!name.isDirectory()) continue;
  const dir = join(ROOT, "packages", name.name);
  if (!existsSync(join(dir, "package.json"))) continue;
  if (manifest(dir).private) continue;
  if (PUBLISHABLE.includes(`packages/${name.name}`)) continue;
  problems.push(`packages/${name.name}: publishable but absent from the release check's list`);
}

// A release check that checked nothing is the failure it is meant to prevent.
if (checked.length === 0 && problems.length === 0) {
  problems.push("no publishable package was checked - the release surface came out empty");
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`release-check: ${problem}`);
  process.exit(1);
}

console.log(`release-check: ok - ${checked.length} tarball(s) inspected (${checked.join(", ")})`);
