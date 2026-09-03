import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveLaunchCatalog } from "../derived.js";
import { scanInstalledApplications } from "../../inventory.js";

// The machine's own catalog, derived. Every case here is a FILE, because the
// thing under test is what a real desktop entry directory does to argv.

let counter = 0;
function directoryWith(entries: Record<string, string>): string {
  counter += 1;
  const directory = join(mkdtempSync(join(tmpdir(), "mastra-cc-derived-")), `d${counter}`);
  mkdirSync(directory, { recursive: true });
  for (const [name, body] of Object.entries(entries)) writeFileSync(join(directory, name), body);
  return directory;
}

function application(exec: string, extra = ""): string {
  return `[Desktop Entry]\nType=Application\nName=Fixture\nExec=${exec}\n${extra}`;
}

describe("an Exec value becomes argv", () => {
  it("drops the field code and keeps the real flag", () => {
    const dir = directoryWith({ "org.kde.kate.desktop": application("kate -b %U") });
    expect(deriveLaunchCatalog([dir])["org.kde.kate"].argv).toEqual(["kate", "-b"]);
  });

  it("keeps a quoted argument as one element", () => {
    const dir = directoryWith({ "a.desktop": application('/usr/bin/foo --bar "two words" %F') });
    expect(deriveLaunchCatalog([dir])["a"].argv).toEqual(["/usr/bin/foo", "--bar", "two words"]);
  });

  it("honours the specification's escapes inside quotes", () => {
    const dir = directoryWith({ "a.desktop": application('foo "a\\"b" "c\\\\d"') });
    expect(deriveLaunchCatalog([dir])["a"].argv).toEqual(["foo", 'a"b', "c\\d"]);
  });

  it("removes every field code the specification names", () => {
    for (const code of ["%f", "%F", "%u", "%U", "%d", "%D", "%n", "%N", "%i", "%c", "%k", "%v", "%m"]) {
      const dir = directoryWith({ "a.desktop": application(`foo ${code} --keep`) });
      expect(deriveLaunchCatalog([dir])["a"].argv, code).toEqual(["foo", "--keep"]);
    }
  });

  it("removes a field code embedded in a longer argument", () => {
    const dir = directoryWith({ "a.desktop": application("foo --file=%f") });
    expect(deriveLaunchCatalog([dir])["a"].argv).toEqual(["foo", "--file="]);
  });

  it("turns an escaped percent into a literal percent", () => {
    const dir = directoryWith({ "a.desktop": application("foo 100%%") });
    expect(deriveLaunchCatalog([dir])["a"].argv).toEqual(["foo", "100%"]);
  });
});

describe("an entry that cannot be launched honestly produces no recipe", () => {
  const neighbour = { "good.desktop": application("kate") };

  function derivedWith(body: string): Record<string, unknown> {
    return deriveLaunchCatalog([directoryWith({ ...neighbour, "bad.desktop": body })]);
  }

  it("no Exec key at all", () => {
    const catalog = derivedWith("[Desktop Entry]\nType=Application\nName=Fixture\n");
    expect(catalog["bad"]).toBeUndefined();
    expect(catalog["good"]).toBeDefined();
  });

  it("an empty Exec", () => {
    expect(derivedWith(application(""))["bad"]).toBeUndefined();
  });

  it("an unbalanced quote", () => {
    expect(derivedWith(application('foo "unterminated'))["bad"]).toBeUndefined();
  });

  it("a trailing escape inside a quote", () => {
    expect(derivedWith(application('foo "bad\\'))["bad"]).toBeUndefined();
  });

  it("an Exec that is nothing but field codes", () => {
    expect(derivedWith(application("%f %U"))["bad"]).toBeUndefined();
  });

  it("Type=Link and Type=Directory", () => {
    const dir = directoryWith({
      "link.desktop": "[Desktop Entry]\nType=Link\nExec=kate\nURL=http://example.com\n",
      "folder.desktop": "[Desktop Entry]\nType=Directory\nExec=kate\n",
      ...neighbour,
    });
    const catalog = deriveLaunchCatalog([dir]);
    expect(catalog["link"]).toBeUndefined();
    expect(catalog["folder"]).toBeUndefined();
    expect(catalog["good"]).toBeDefined();
  });

  it("Terminal=true, while its neighbours still derive", () => {
    const dir = directoryWith({
      "htop.desktop": application("htop", "Terminal=true\n"),
      "explicit.desktop": application("kate", "Terminal=false\n"),
      ...neighbour,
    });
    const catalog = deriveLaunchCatalog([dir]);
    expect(catalog["htop"]).toBeUndefined();
    expect(catalog["explicit"]).toBeDefined();
    expect(catalog["good"]).toBeDefined();
  });

  it("every shell and wrapper argv[0], bare and absolute", () => {
    for (const wrapper of ["sh", "bash", "dash", "zsh", "env", "flatpak", "snap"]) {
      expect(derivedWith(application(`${wrapper} -c "kate"`))["bad"], wrapper).toBeUndefined();
      expect(derivedWith(application(`/bin/${wrapper} -c "kate"`))["bad"], wrapper).toBeUndefined();
    }
  });

  it("a program merely named like one still derives - the check is the whole basename", () => {
    for (const program of ["shed", "enveloper"]) {
      const catalog = deriveLaunchCatalog([directoryWith({ "bad.desktop": application(program) })]);
      expect(catalog["bad"], program).toBeDefined();
    }
  });
});

describe("what a derived recipe carries", () => {
  it("a NoDisplay entry still derives - menu visibility is not launchability", () => {
    const dir = directoryWith({ "hidden.desktop": application("kate", "NoDisplay=true\n") });
    expect(deriveLaunchCatalog([dir])["hidden"]).toBeDefined();
  });

  it("appearsAs is the normalised basename, bare or absolute", () => {
    const dir = directoryWith({
      "bare.desktop": application("kate -b %U"),
      "absolute.desktop": application("/usr/bin/kate"),
    });
    const catalog = deriveLaunchCatalog([dir]);
    expect(catalog["bare"].appearsAs).toBe("kate");
    expect(catalog["absolute"].appearsAs).toBe("kate");
  });

  it("both measured accessibility knobs, on every recipe", () => {
    const dir = directoryWith({ "a.desktop": application("kate"), "b.desktop": application("dolphin") });
    for (const recipe of Object.values(deriveLaunchCatalog([dir]))) {
      expect(recipe.env).toEqual({ GTK_MODULES: "gail:atk-bridge", QT_LINUX_ACCESSIBILITY_ALWAYS_ON: "1" });
    }
  });

  it("nothing at all when the directory is absent or unreadable", () => {
    expect(deriveLaunchCatalog([join(tmpdir(), "mastra-cc-nothing-here-at-all")])).toEqual({});
    expect(deriveLaunchCatalog([])).toEqual({});
  });
});

describe("derivation and inventory describe the same files", () => {
  it("the earlier directory wins, exactly as the inventory reports it", () => {
    const home = directoryWith({ "org.kde.kate.desktop": application("mine") });
    const system = directoryWith({
      "org.kde.kate.desktop": application("theirs"),
      "org.kde.dolphin.desktop": application("dolphin"),
    });
    const catalog = deriveLaunchCatalog([home, system]);
    expect(catalog["org.kde.kate"].argv).toEqual(["mine"]);
    const inventory = scanInstalledApplications([home, system]).map((entry) => entry.name);
    expect(inventory).toEqual(Object.keys(catalog).sort());
  });

  it("derivation is data - the module never reaches the spawner", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "derived.ts"), "utf8");
    expect(source).not.toMatch(/from "\.\/spawn\.js"/);
    expect(source).not.toMatch(/child_process/);
  });
});
