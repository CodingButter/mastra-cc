import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The licence gate, against a scratch tree with a hand-built node_modules.
//
// WHY IT EXISTS. Until 2026-08-21 this gate read each manifest's own
// dependency list and stopped. Issue #36 proved the consequence in a sandbox:
// a manifest declaring one permissive package whose OWN dependency is not on
// the allowlist exits zero. The three packages that were actually reaching
// this tree unexamined had to be found by a person reading a lockfile, which
// is the same failure mode the citation check was written for.
//
// The cases below are that sandbox, made permanent - plus the two ways a walk
// can report a number while having walked nothing.

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const gate = join(repoRoot, "tools", "licences.mjs");

let root;

/** A package in the scratch tree's node_modules, with a licence and deps. */
function install(name, licence, deps = {}) {
  const dir = join(root, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", license: licence, dependencies: deps }));
}

/** The root manifest the gate reads first. */
function manifest(dependencies, devDependencies = {}) {
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "scratch", dependencies, devDependencies }));
}

function run() {
  return spawnSync(process.execPath, [join(root, "tools", "licences.mjs")], { encoding: "utf8" });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "licences-"));
  mkdirSync(join(root, "tools"), { recursive: true });
  mkdirSync(join(root, "packages"), { recursive: true });
  mkdirSync(join(root, "apps"), { recursive: true });
  cpSync(gate, join(root, "tools", "licences.mjs"));
  // The gate requires its own manifest to exist; keep it dependency-free so
  // every case is about the root manifest it is actually testing.
  writeFileSync(join(root, "tools", "package.json"), JSON.stringify({ name: "scratch-tools" }));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the licence gate", () => {
  it("passes a runtime tree whose every package is permissive", () => {
    manifest({ alpha: "^1.0.0" });
    install("alpha", "MIT", { beta: "^1.0.0" });
    install("beta", "Apache-2.0");
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ok -");
  });

  it("catches a licence that only a dependency of a dependency declares", () => {
    // ISSUE #36, EXACTLY. The declared package is permissive; the one it drags
    // in is not. Reading manifests alone exits zero here, which it did for
    // months.
    manifest({ alpha: "^1.0.0" });
    install("alpha", "MIT", { beta: "^1.0.0" });
    install("beta", "GPL-3.0");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('beta is "GPL-3.0"');
  });

  it("names the chain that ships the offending package, not just its name", () => {
    // A licence problem four levels down is unactionable without knowing who
    // dragged it in - the fix is upstream of the package, not at it.
    manifest({ alpha: "^1.0.0" });
    install("alpha", "MIT", { beta: "^1.0.0" });
    install("beta", "MIT", { gamma: "^1.0.0" });
    install("gamma", "SEE LICENSE IN LICENSE.txt");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("shipped via package.json > alpha > beta");
  });

  it("refuses when a package in the shipped tree is not installed at all", () => {
    manifest({ alpha: "^1.0.0" });
    install("alpha", "MIT", { absent: "^1.0.0" });
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("absent is shipped via");
    expect(r.stderr).toContain("its licence cannot be verified");
  });

  it("refuses when it reached nothing through a dependent, however many it counted", () => {
    // THE CASE A COUNT-BASED GUARD MISSES. Six declared packages, all
    // permissive, none of them depending on anything: a gate that reports a
    // package count says "ok - 6" and means nothing by it. The first version
    // of this guard compared the walk against the manifest count and survived
    // having its recursion deleted.
    manifest({ a: "^1", b: "^1", c: "^1", d: "^1", e: "^1", f: "^1" });
    for (const n of ["a", "b", "c", "d", "e", "f"]) install(n, "MIT");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("none of them through a dependent - it did not walk");
  });

  it("refuses when no manifest declares anything", () => {
    manifest({});
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("pass vacuously");
  });

  it("admits a dual licence when one of its halves is permitted", () => {
    // json-schema reaches the real tree as "(AFL-2.1 OR BSD-3-Clause)". An OR
    // is a choice, and this repository takes the half it is allowed to.
    manifest({ alpha: "^1.0.0" });
    install("alpha", "MIT", { dual: "^1.0.0" });
    install("dual", "(AFL-2.1 OR BSD-3-Clause)");
    expect(run().status).toBe(0);
  });

  it("refuses a conjunction when either half is not permitted", () => {
    // An AND is not a choice: both sets of terms apply.
    manifest({ alpha: "^1.0.0" });
    install("alpha", "MIT", { both: "^1.0.0" });
    install("both", "(MIT AND GPL-3.0)");
    expect(run().status).toBe(1);
  });

  it("admits Blue Oak, which is the decision this walk forced", () => {
    // Named here so the allowlist entry has a test and not only a comment:
    // the walk that could finally see these packages is what put the question
    // on the table at all.
    manifest({ alpha: "^1.0.0" });
    install("alpha", "MIT", { "@isaacs/ttlcache": "^1.0.0" });
    install("@isaacs/ttlcache", "BlueOak-1.0.0");
    expect(run().status).toBe(0);
  });

  it("does not walk a development dependency's own tree, and says so in its report", () => {
    // The stated boundary. A build tool is not distributed, so its closure is
    // a question about this repository's build rather than about what a user
    // receives. The gate reads it as declared - and a bad licence one level
    // inside it is deliberately not a failure here.
    manifest({ alpha: "^1.0.0" }, { tool: "^1.0.0" });
    install("alpha", "MIT", { beta: "^1.0.0" });
    install("beta", "MIT");
    install("tool", "MIT", { toolchain: "^1.0.0" });
    install("toolchain", "MPL-2.0");
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("development as declared");
  });

  it("checks a development dependency pinned through the workspace catalog", () => {
    // A `catalog:` spec is a version held in pnpm-workspace.yaml; the package
    // behind it is as third-party as any other. Skipping the spec put
    // typescript and vitest - two of this tree's main dev tools - outside a
    // gate whose success line reported them as inside it.
    install("catalogued", "GPL-3.0");
    manifest({}, { catalogued: "catalog:" });
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("catalogued");
    expect(r.stderr).toContain("GPL-3.0");
  });

  it("walks an optional dependency, because pnpm installs those by default", () => {
    // An optional dependency that IS installed ships, so it is licence-checked
    // like any other. Seven packages in the real tree declare them.
    install("ships", "MIT");
    writeFileSync(
      join(root, "node_modules", "ships", "package.json"),
      JSON.stringify({ name: "ships", version: "1.0.0", license: "MIT", optionalDependencies: { optional: "^1" } }),
    );
    install("optional", "GPL-3.0");
    manifest({ ships: "^1" });
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("optional");
  });

  it("does not call an absent optional dependency a finding, the way it would an absent hard one", () => {
    // Being absent is exactly what `optionalDependencies` allows. A hard
    // dependency that is missing is still a package whose licence nobody can
    // verify, and still reports.
    install("ships", "MIT");
    writeFileSync(
      join(root, "node_modules", "ships", "package.json"),
      JSON.stringify({ name: "ships", version: "1.0.0", license: "MIT", optionalDependencies: { nowhere: "^1" }, dependencies: { present: "^1" } }),
    );
    install("present", "MIT");
    manifest({ ships: "^1" });
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("nowhere");
  });

  it("walks a peer dependency that is present in the tree", () => {
    // A peer is code the user receives however it got there. In the real tree
    // zod arrives as a peer of @mastra/core and was licence-checked only
    // because one unrelated package happened to declare it as a dependency.
    install("ships", "MIT");
    writeFileSync(
      join(root, "node_modules", "ships", "package.json"),
      JSON.stringify({ name: "ships", version: "1.0.0", license: "MIT", peerDependencies: { peer: "^1" } }),
    );
    install("peer", "GPL-3.0");
    manifest({ ships: "^1" });
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("peer");
  });

  it("still refuses a development dependency whose own licence is not permitted", () => {
    manifest({ alpha: "^1.0.0" }, { tool: "^1.0.0" });
    install("alpha", "MIT", { beta: "^1.0.0" });
    install("beta", "MIT");
    install("tool", "MPL-2.0");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("declared in package.json");
  });

  it("survives a dependency cycle rather than recursing until the stack ends", () => {
    manifest({ alpha: "^1.0.0" });
    install("alpha", "MIT", { beta: "^1.0.0" });
    install("beta", "MIT", { alpha: "^1.0.0" });
    expect(run().status).toBe(0);
  });
});
