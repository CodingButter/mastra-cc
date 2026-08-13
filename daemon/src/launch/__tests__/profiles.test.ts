import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  composeBootNames,
  composeCatalog,
  expandThroughAppearsAs,
  loadProfilesFile,
  MalformedProfilesFileError,
} from "../profiles.js";
import { CATALOG, DEFAULT_CHROME_PROFILE_DIR, GMAIL_PROFILE_DIR } from "../recipes.js";
import type { LaunchCatalog } from "../recipes.js";
import { findRecipe } from "../spawn.js";

// The profiles file and the composed catalog (M2.3b, ADR-0038). Offline: no
// browser, no daemon, no bus - the loader is pure file reading and the
// composition is pure data.

const tempDirs: string[] = [];

function profilesFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "m23b-profiles-"));
  tempDirs.push(dir);
  const path = join(dir, "profiles.json");
  writeFileSync(path, contents);
  return path;
}

function absentPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "m23b-absent-"));
  tempDirs.push(dir);
  return join(dir, "no-such-profiles.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadProfilesFile", () => {
  it("composes nothing when the file is absent, leaving the built-in catalog alone", () => {
    const profiles = loadProfilesFile(absentPath());
    expect(profiles).toEqual([]);
    expect(composeCatalog(CATALOG, profiles)).toEqual(CATALOG);
  });

  it("refuses a file that is not JSON, naming invalid JSON and quoting no parser text", () => {
    const path = profilesFile("{ this is not json");
    expect(() => loadProfilesFile(path)).toThrow(MalformedProfilesFileError);
    // The class alone is not enough: every case throws it. The message is what
    // separates "not valid JSON" from "wrong shape".
    expect(() => loadProfilesFile(path)).toThrow(/is not valid JSON/);
    let message = "";
    try {
      loadProfilesFile(path);
    } catch (error) {
      message = (error as Error).message;
    }
    // no raw parser text - the operator gets our sentence, not V8's
    expect(message).not.toMatch(/JSON\.parse|Unexpected token|position \d+/);
  });

  it("refuses the wrong shape rather than guessing what was meant", () => {
    for (const contents of [
      '{"profiles": []}',
      '{"browserProfiles": [{"name": "chrome-work"}]}',
      '{"browserProfiles": [{"directory": "/var/tmp/work"}]}',
      '{"browserProfiles": [{"name": "chrome-work", "directory": 7}]}',
    ]) {
      expect(() => loadProfilesFile(profilesFile(contents))).toThrow(/refusing to guess what was meant/);
    }
  });

  it("refuses a relative directory instead of resolving it against the daemon's cwd", () => {
    const path = profilesFile('{"browserProfiles": [{"name": "chrome-work", "directory": "work-profile"}]}');
    expect(() => loadProfilesFile(path)).toThrow(/must be an absolute path/);
  });

  it("refuses a profile name that shadows a built-in recipe", () => {
    const path = profilesFile('{"browserProfiles": [{"name": "chrome", "directory": "/var/tmp/m23b-work"}]}');
    expect(() => loadProfilesFile(path)).toThrow(/already a built-in launch recipe/);
  });

  it("refuses two profiles sharing one name", () => {
    const path = profilesFile(
      '{"browserProfiles": [{"name": "chrome-work", "directory": "/var/tmp/m23b-a"}, {"name": "chrome-work", "directory": "/var/tmp/m23b-b"}]}',
    );
    expect(() => loadProfilesFile(path)).toThrow(/twice - two identities cannot share one name/);
  });

  it("refuses two identities pointing at one profile directory", () => {
    const path = profilesFile(
      '{"browserProfiles": [{"name": "chrome-work", "directory": "/var/tmp/m23b-shared"}, {"name": "chrome-personal", "directory": "/var/tmp/m23b-shared"}]}',
    );
    expect(() => loadProfilesFile(path)).toThrow(/would share one cookie jar/);
  });

  it("refuses a profile pointing at the built-in recipe's own directory", () => {
    const path = profilesFile(
      `{"browserProfiles": [{"name": "chrome-work", "directory": "${DEFAULT_CHROME_PROFILE_DIR}"}]}`,
    );
    expect(() => loadProfilesFile(path)).toThrow(/would share one cookie jar/);
  });

  it("normalises names before comparing them, so a math-bold entry is the same identity", () => {
    // The M0.5 lesson: normalisation precedes every comparison.
    const path = profilesFile(
      '{"browserProfiles": [{"name": "chrome-work", "directory": "/var/tmp/m23b-a"}, {"name": "\u{1D41C}\u{1D421}\u{1D42B}\u{1D428}\u{1D426}\u{1D41E}-\u{1D430}\u{1D428}\u{1D42B}\u{1D424}", "directory": "/var/tmp/m23b-b"}]}',
    );
    expect(() => loadProfilesFile(path)).toThrow(/twice - two identities cannot share one name/);

    const single = profilesFile(
      '{"browserProfiles": [{"name": "\u{1D41C}\u{1D421}\u{1D42B}\u{1D428}\u{1D426}\u{1D41E}-\u{1D430}\u{1D428}\u{1D42B}\u{1D424}", "directory": "/var/tmp/m23b-b"}]}',
    );
    const composed = composeCatalog(CATALOG, loadProfilesFile(single));
    // found by its plain form through the same lookup the spawner uses
    expect(findRecipe("chrome-work", composed)).toBeDefined();
  });
});

describe("composeCatalog", () => {
  const profiles = [
    { name: "chrome-work", directory: "/var/tmp/m23b-work" },
    { name: "chrome-personal", directory: "/var/tmp/m23b-personal" },
  ];

  it("gives each profile its own recipe pointing at its own directory", () => {
    const composed = composeCatalog(CATALOG, profiles);
    const work = composed["chrome-work"];
    expect(work).toBeDefined();
    expect(work.argv).toContain("--user-data-dir=/var/tmp/m23b-work");
    expect(work.argv.filter((argument) => argument.startsWith("--user-data-dir="))).toHaveLength(1);
    expect(work.appearsAs).toBe("chrome");
    expect(composed["chrome-personal"].argv).toContain("--user-data-dir=/var/tmp/m23b-personal");
  });

  it("never mutates the base catalog and leaves the built-in argv byte-identical", () => {
    const before = structuredClone(CATALOG) as LaunchCatalog;
    const composed = composeCatalog(CATALOG, profiles);
    expect(CATALOG).toEqual(before);
    // M2.2's demo and capture flows depend on this argv exactly as it is
    expect(composed.chrome.argv).toEqual(CATALOG.chrome.argv);
    expect(composed.yad).toEqual(CATALOG.yad);
  });
});

describe("expandThroughAppearsAs", () => {
  const composed = composeCatalog(CATALOG, [{ name: "chrome-work", directory: "/var/tmp/m23b-work" }]);

  it("adds the tree name a recipe answers to", () => {
    expect([...expandThroughAppearsAs(new Set(["chrome-work"]), composed)].sort()).toEqual([
      "chrome",
      "chrome-work",
    ]);
  });

  it("leaves a name with no recipe, and a recipe with no appearsAs, as itself", () => {
    expect([...expandThroughAppearsAs(new Set(["not-in-the-catalog"]), composed)]).toEqual([
      "not-in-the-catalog",
    ]);
    expect([...expandThroughAppearsAs(new Set(["yad"]), composed)]).toEqual(["yad"]);
  });

  it("does not mutate the set it was given", () => {
    const names = new Set(["chrome-work"]);
    expandThroughAppearsAs(names, composed);
    expect([...names]).toEqual(["chrome-work"]);
  });
});

// The gmail identity (M2.5): a built-in recipe for the browser under the
// operator's hand-signed-in profile. Offline: pure catalog data, no browser.
describe("the gmail identity", () => {
  it("is resolvable by name, including its NFKC forms, through the spawner's own lookup", () => {
    expect(findRecipe("gmail", CATALOG)).toBeDefined();
    // math-bold "gmail" - normalisation precedes every comparison (M0.5)
    expect(findRecipe("\u{1D420}\u{1D426}\u{1D41A}\u{1D422}\u{1D425}", CATALOG)).toBe(
      findRecipe("gmail", CATALOG),
    );
  });

  it("launches the browser on the persistent gmail profile directory, never the built-in jar", () => {
    const gmail = findRecipe("gmail", CATALOG);
    const dirs = gmail?.argv.filter((argument) => argument.startsWith("--user-data-dir="));
    expect(dirs).toEqual([`--user-data-dir=${GMAIL_PROFILE_DIR}`]);
    expect(GMAIL_PROFILE_DIR).not.toBe(DEFAULT_CHROME_PROFILE_DIR);
    // persistence is the point: a signed-in identity must survive reboots
    expect(GMAIL_PROFILE_DIR.startsWith("/tmp")).toBe(false);
    expect(gmail?.argv).toContain("https://mail.google.com");
  });

  it("answers to the browser's tree name, so the one-identity guard covers it and observe expands", () => {
    expect(findRecipe("gmail", CATALOG)?.appearsAs).toBe("chrome");
    expect([...expandThroughAppearsAs(new Set(["gmail"]), CATALOG)].sort()).toEqual([
      "chrome",
      "gmail",
    ]);
  });

  it("refuses a profiles-file entry pointing at the gmail jar - that jar is the operator's signed-in identity", () => {
    const path = profilesFile(
      `{"browserProfiles": [{"name": "chrome-work", "directory": "${GMAIL_PROFILE_DIR}"}]}`,
    );
    expect(() => loadProfilesFile(path)).toThrow(/would share one cookie jar/);
  });
});

// The boot split (ADR-0038, decision 6). These are the milestone's sharpest
// hazard's only automated defence: main.ts cannot be imported by a test, so
// "which set is handed to the launch context" is only answerable here. A
// server-level test asserting an unpermitted name refuses would be VACUOUS -
// it passes on an unchanged server, which refuses whatever is not in the set
// it was handed. The question is which set that is.
describe("composeBootNames", () => {
  const composed = composeCatalog(CATALOG, [
    { name: "chrome-work", directory: "/var/tmp/m23b-work" },
    { name: "chrome-personal", directory: "/var/tmp/m23b-personal" },
  ]);
  const none = new Set<string>();

  it("never expands launch authority through appearsAs - permitting one identity is not permitting the built-in", () => {
    const { launchPermits } = composeBootNames({
      permits: new Set(["chrome-work"]),
      grants: none,
      flags: none,
      catalog: composed,
    });
    expect([...launchPermits]).toEqual(["chrome-work"]);
    expect(launchPermits.has("chrome")).toBe(false);
    expect(launchPermits.has("chrome-personal")).toBe(false);
  });

  it("expands the observe set, so a permitted identity is readable once it launches", () => {
    const { visibility } = composeBootNames({
      permits: new Set(["chrome-work"]),
      grants: none,
      flags: none,
      catalog: composed,
    });
    expect(visibility).not.toBe("all");
    expect([...(visibility as ReadonlySet<string>)].sort()).toEqual(["chrome", "chrome-work"]);
  });

  it("expands grants-file entries and --grant flags too - a durable grant must not be inert", () => {
    const fromFile = composeBootNames({
      permits: none,
      grants: new Set(["chrome-work"]),
      flags: none,
      catalog: composed,
    });
    const fromFlag = composeBootNames({
      permits: none,
      grants: none,
      flags: new Set(["chrome-personal"]),
      catalog: composed,
    });
    expect([...(fromFile.visibility as ReadonlySet<string>)].sort()).toEqual(["chrome", "chrome-work"]);
    expect([...(fromFlag.visibility as ReadonlySet<string>)].sort()).toEqual([
      "chrome",
      "chrome-personal",
    ]);
    // neither is authority: a grant lets a session SEE, never LAUNCH
    expect([...fromFile.launchPermits]).toEqual([]);
    expect([...fromFlag.launchPermits]).toEqual([]);
  });

  it("keeps the grants file's own laws - 'all' still wins outright", () => {
    const { visibility } = composeBootNames({
      permits: new Set(["chrome-work"]),
      grants: "all",
      flags: none,
      catalog: composed,
    });
    expect(visibility).toBe("all");
  });
});
