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

  it("keeps walking a runtime package that is also somebody's development dependency", () => {
    // The dev loop and the runtime walk used to share one visited-map, so a
    // package recorded as dev first made the runtime walk early-return AT it -
    // and everything below it went unlicenced, silently, depending only on the
    // order manifests happen to be read in. Measured on the real tree:
    // `@types/node` is a root dev dependency and a hard runtime dependency of
    // `protobufjs`, and `undici-types` beneath it was never reached.
    //
    // The order is the whole defect, so the fixture has to carry it: the dev
    // record must land while reading an EARLIER manifest than the runtime walk
    // that later reaches the same package. Root declares it as dev; daemon
    // reaches it as runtime. Written the other way round - both in one
    // manifest - the runtime walk runs first and a shared map looks harmless.
    manifest({}, { shared: "^1.0.0" });
    mkdirSync(join(root, "daemon"), { recursive: true });
    writeFileSync(
      join(root, "daemon", "package.json"),
      JSON.stringify({ name: "daemon", dependencies: { alpha: "^1.0.0" } }),
    );
    install("alpha", "MIT", { shared: "^1.0.0" });
    install("shared", "MIT", { beneath: "^1.0.0" });
    install("beneath", "GPL-3.0");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('beneath is "GPL-3.0"');
    expect(r.stderr).toContain("shipped via daemon/package.json > alpha > shared");
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

  // A PACKAGE'S DECLARED LICENCE IS NOT ALWAYS ITS PAYLOAD'S.
  //
  // `electron` declares MIT, and that is true of the JavaScript in the npm
  // package. Its postinstall then downloads a 221MB binary that the user
  // receives, and that binary is Chromium: its own credits file lists 773
  // components, among them ffmpeg under LGPL-2.1-or-later and glibc, gtk and
  // liblouis under LGPL. None of it is in any manifest this gate walks, so the
  // count it reports is a count of the wrapper.
  //
  // Reclassifying 773 licence blobs by keyword is not a gate, it is a guess
  // that goes stale on the next Electron bump - the first scan written here
  // called Node.js and ICU GPL because their notices quote other licences. So
  // the payload is PINNED instead, the way this repository pins a schema: the
  // credits file is recorded by digest with the review that was done against
  // it, and a payload whose credits change is a payload nobody has reviewed.
  describe("a downloaded payload", () => {
    function payload(pkg, contents) {
      const dist = join(root, "node_modules", pkg, "dist");
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, "LICENSES.chromium.html"), contents);
    }

    function pins(entries) {
      writeFileSync(join(root, "tools", "payload-licences.json"), JSON.stringify(entries, null, 2));
    }

    it("passes when the payload's credits match the digest that was reviewed", () => {
      // `beta` is here so the walk reaches something through a dependent: the
      // gate refuses a run that walked nothing, and that guard would otherwise
      // answer this case instead of the payload check it is about.
      manifest({ alpha: "^1.0.0" });
      install("alpha", "MIT", { beta: "^1.0.0" });
      install("beta", "MIT");
      payload("alpha", "<html>the reviewed credits</html>");
      pins({
        alpha: {
          file: "dist/LICENSES.chromium.html",
          digest: "e3ff5b2b8b74acbb2d0f0a1b1ad4d5f0d5b0b2d1e6f6a8a0b4b8a2e1c9d3f7a2",
          reviewed: "2026-08-22",
          reason: "test fixture",
        },
      });
      const first = run();
      // The digest above is deliberately wrong: the gate must say what it
      // actually found rather than accept anything.
      expect(first.status).toBe(1);
      const actual = /found ([0-9a-f]{64})/.exec(first.stderr)?.[1];
      expect(actual).toBeTruthy();
      pins({
        alpha: { file: "dist/LICENSES.chromium.html", digest: actual, reviewed: "2026-08-22", reason: "test fixture" },
      });
      const second = run();
      expect(second.status).toBe(0);
      expect(second.stdout).toContain("1 payload(s)");
    });

    it("refuses when the payload's credits changed under a pinned digest", () => {
      manifest({ alpha: "^1.0.0" });
      install("alpha", "MIT");
      payload("alpha", "<html>the reviewed credits</html>");
      pins({
        alpha: { file: "dist/LICENSES.chromium.html", digest: "0".repeat(64), reviewed: "2026-08-22", reason: "test fixture" },
      });
      const r = run();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("alpha");
      expect(r.stderr).toContain("has not been reviewed");
    });

    it("refuses when a pinned payload is not installed at all", () => {
      // The failure is not that the file is missing - it is that a review this
      // gate reports as done was done against nothing.
      manifest({ alpha: "^1.0.0" });
      install("alpha", "MIT");
      pins({
        alpha: { file: "dist/LICENSES.chromium.html", digest: "0".repeat(64), reviewed: "2026-08-22", reason: "test fixture" },
      });
      const r = run();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("cannot be verified");
    });

    it("pins a repository-owned model payload to its bytes and licence evidence", () => {
      manifest({ alpha: "^1.0.0" });
      install("alpha", "MIT", { beta: "^1.0.0" });
      install("beta", "MIT");
      mkdirSync(join(root, "daemon", "models"), { recursive: true });
      writeFileSync(join(root, "daemon", "models", "payload.onnx"), "model bytes");
      pins({
        packages: {},
        files: {
          "daemon/models/payload.onnx": {
            digest: "0".repeat(64),
            license: "Apache-2.0",
            source: "https://example.invalid/pinned-source",
            reviewed: "2026-08-23",
            reason: "test fixture",
          },
        },
      });
      const first = run();
      expect(first.status).toBe(1);
      expect(first.stderr).toContain("repository payload daemon/models/payload.onnx has not been reviewed");
      const actual = /found ([0-9a-f]{64})/.exec(first.stderr)?.[1];
      expect(actual).toBeTruthy();

      pins({
        packages: {},
        files: {
          "daemon/models/payload.onnx": {
            digest: actual,
            license: "Apache-2.0",
            source: "https://example.invalid/pinned-source",
            reviewed: "2026-08-23",
            reason: "test fixture",
          },
        },
      });
      const second = run();
      expect(second.status).toBe(0);
      expect(second.stdout).toContain("1 repository payload(s)");
    });

    it("refuses a repository model declaration when the payload is absent", () => {
      manifest({ alpha: "^1.0.0" });
      install("alpha", "MIT", { beta: "^1.0.0" });
      install("beta", "MIT");
      pins({
        packages: {},
        files: {
          "daemon/models/missing.onnx": {
            digest: "0".repeat(64),
            license: "Apache-2.0",
            source: "https://example.invalid/pinned-source",
            reviewed: "2026-08-23",
            reason: "manifest-only declarations do not license absent bytes",
          },
        },
      });
      const r = run();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("repository payload daemon/models/missing.onnx cannot be verified");
    });

    it("refuses a forbidden openWakeWord model payload despite Apache-licensed wrapper code", () => {
      manifest({ alpha: "^1.0.0" });
      install("alpha", "Apache-2.0", { beta: "^1.0.0" });
      install("beta", "MIT");
      mkdirSync(join(root, "daemon", "models"), { recursive: true });
      writeFileSync(join(root, "daemon", "models", "noncommercial-payload.onnx"), "forbidden model bytes");
      pins({
        packages: {},
        files: {
          "daemon/models/noncommercial-payload.onnx": {
            digest: "0".repeat(64),
            license: "CC-BY-NC-SA-4.0",
            source: "https://github.com/dscripka/openWakeWord/tree/368c03716d1e92591906a84949bc477f3a834455",
            reviewed: "2026-08-23",
            reason: "the wrapper is Apache-2.0 but the distributed pretrained model is non-commercial",
          },
        },
      });
      const r = run();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("repository payload daemon/models/noncommercial-payload.onnx lacks permitted licence");
    });

    it("refuses a runtime package that ships a payload nobody pinned", () => {
      // THE HOLE ITSELF. A package can arrive, download a binary and pass on
      // its wrapper's MIT, exactly as electron did. An unpinned payload is not
      // a silent pass.
      manifest({ alpha: "^1.0.0" });
      install("alpha", "MIT");
      payload("alpha", "<html>credits nobody read</html>");
      pins({});
      const r = run();
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("alpha");
      expect(r.stderr).toContain("ships a licence manifest of its own");
    });

    it("says nothing about a payload under a package it never walked", () => {
      // Scope follows the walk. A payload inside a development dependency's
      // own closure is the same question this gate already answers with "a
      // build tool is not distributed"; answering it differently here would be
      // a policy change smuggled in as a bug fix.
      // A runtime pair as well, or the walk reaches nothing and the vacuity
      // guard answers instead of the check this case is about.
      manifest({ alpha: "^1.0.0" }, { tool: "^1.0.0" });
      install("alpha", "MIT", { beta: "^1.0.0" });
      install("beta", "MIT");
      install("tool", "MIT");
      payload("tool", "<html>a build tool's own credits</html>");
      pins({});
      const r = run();
      expect(r.status).toBe(0);
      expect(r.stderr).not.toContain("tool");
    });
  });
});
