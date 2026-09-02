import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadCapabilitiesFile,
  MalformedCapabilitiesFileError,
  restartLevelFor,
  RESTART_LEVELS,
  WITHHOLDS_NOTHING,
} from "../capabilities.js";
import { restartAuthority, restartRefusal } from "../server.js";

// Segment 03 phase 1. There is no restart verb on the wire yet - this file is
// about what the daemon would SAY, which is a question about the configuration
// loader and the gate, and is answerable without touching a process.

function fileSaying(contents: string): { path: string; clean: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "mastra-cc-restart-"));
  const path = join(directory, "capabilities.json");
  writeFileSync(path, contents);
  return { path, clean: () => rmSync(directory, { recursive: true, force: true }) };
}

function loading(contents: string): ReturnType<typeof loadCapabilitiesFile> {
  const { path, clean } = fileSaying(contents);
  try {
    return loadCapabilitiesFile(path);
  } finally {
    clean();
  }
}

function refusalOf(contents: string): string {
  const { path, clean } = fileSaying(contents);
  try {
    loadCapabilitiesFile(path);
    throw new Error("the file was accepted");
  } catch (error) {
    expect(error).toBeInstanceOf(MalformedCapabilitiesFileError);
    return String((error as Error).message);
  } finally {
    clean();
  }
}

describe("a daemon nobody configured restarts nothing", () => {
  it("refuses when there is no configuration file at all", () => {
    // THE property this phase exists to preserve: today's behavior
    // (server.ts:248, the running copy must be closed by a person) is what an
    // unconfigured daemon still does. Asserted through the gate rather than by
    // reading the constant back, so a default that leaked through as an acting
    // level would fail here.
    const answer = restartAuthority(WITHHOLDS_NOTHING, "kate");
    expect(answer).not.toHaveProperty("level");
    expect((answer as { refusal: string }).refusal).toContain("restart.default");
    expect((answer as { refusal: string }).refusal).toContain('"refuse"');
  });

  it("refuses when the file configures other things and says nothing about restarting", () => {
    const configuration = loading('{"defaults": {"edit": false}}');
    expect(restartLevelFor(configuration, "kate")).toEqual({ level: "refuse", setting: "restart.default" });
  });

  it("refuses for an application the caller could not name", () => {
    // No application means no per-application answer; inventing one would
    // attach an operator's setting to something they never configured.
    const configuration = loading('{"restart": {"applications": {"kate": "force"}}}');
    expect(restartLevelFor(configuration, undefined).level).toBe("refuse");
  });
});

describe("the four levels an operator can choose", () => {
  it("parses every one of them, and only them", () => {
    for (const level of RESTART_LEVELS) {
      expect(loading(`{"restart": {"default": ${JSON.stringify(level)}}}`).restart.fallback).toBe(level);
    }
    expect(RESTART_LEVELS).toEqual(["refuse", "ask", "graceful", "force"]);
  });

  it("refuses an unknown level by name, at load", () => {
    // Not at the moment of a restart, months later, on a machine whose owner
    // believed they had configured something.
    const message = refusalOf('{"restart": {"default": "kill"}}');
    expect(message).toContain('"kill"');
    expect(message).toContain("refuse, ask, graceful, force");
  });

  it("refuses an unknown key inside the restart section by name", () => {
    expect(refusalOf('{"restart": {"defualt": "force"}}')).toContain('"defualt"');
  });

  it("refuses a level that is not even a string, rather than reading it as a default", () => {
    expect(refusalOf('{"restart": {"applications": {"kate": true}}}')).toContain("true");
  });

  it("still refuses an unknown top-level key, and now names restart among the known ones", () => {
    const message = refusalOf('{"restarts": {}}');
    expect(message).toContain('"restarts"');
    expect(message).toContain('"restart"');
  });
});

describe("what an operator wrote about one application beats what they wrote about all of them", () => {
  it("takes the per-application level over the fallback, and names that setting", () => {
    const configuration = loading('{"restart": {"default": "ask", "applications": {"kate": "force"}}}');
    expect(restartLevelFor(configuration, "kate")).toEqual({
      level: "force",
      setting: 'restart.applications["kate"]',
    });
    expect(restartLevelFor(configuration, "dolphin")).toEqual({ level: "ask", setting: "restart.default" });
  });

  it("normalises application names at load, so a lookup never sees raw file bytes", () => {
    // The same NFKC + case-fold rule the grants and the capability blocks
    // use. A second rule here would silently disagree with them.
    const configuration = loading('{"restart": {"applications": {"\\uff2b\\uff41\\uff54\\uff45": "graceful"}}}');
    expect([...configuration.restart.applications.keys()]).toEqual(["kate"]);
    expect(restartLevelFor(configuration, "\uff2b\uff41\uff54\uff45").level).toBe("graceful");
    expect(restartLevelFor(configuration, "Kate").setting).toBe('restart.applications["kate"]');
  });
});

describe("the two refusals are different answers, and both name the setting", () => {
  it("says nothing restarts here, for refuse", () => {
    const { refusal, refusalClass } = restartRefusal("refuse", "restart.default");
    expect(refusal).toContain("refused by configuration");
    expect(refusal).toContain("restart.default");
    expect(refusalClass).toBe("DisabledByConfiguration");
  });

  it("names the levels that would act, for ask", () => {
    // ADR-0042: a refusal that cannot be acted on is a wall. An operator told
    // "ask" learns what the alternatives are called without reading the source.
    const { refusal } = restartRefusal("ask", 'restart.applications["kate"]');
    expect(refusal).toContain('restart.applications["kate"]');
    expect(refusal).toContain("graceful");
    expect(refusal).toContain("force");
  });

  it("gives the two of them different sentences", () => {
    expect(restartRefusal("ask", "restart.default").refusal).not.toBe(
      restartRefusal("refuse", "restart.default").refusal,
    );
  });

  it("lets no non-acting level out of the gate as a level", () => {
    // The property that keeps a downstream caller from having to remember: the
    // gate returns an acting level or a refusal, never "ask".
    for (const level of RESTART_LEVELS) {
      const configuration = loading(`{"restart": {"default": ${JSON.stringify(level)}}}`);
      const answer = restartAuthority(configuration, "kate");
      if (level === "graceful" || level === "force") {
        expect(answer).toEqual({ level });
      } else {
        expect(answer).toHaveProperty("refusalClass", "DisabledByConfiguration");
      }
    }
  });
});
