import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  acceptWake,
  applyFrame,
  dismissFace,
  INITIAL_FACE_STATE,
  isSpokenDismissal,
  type FaceState,
} from "../hiding-model.js";

const working: FaceState = {
  ...INITIAL_FACE_STATE,
  visible: true,
  working: true,
  caption: "still working",
  armed: true,
};

describe("the face hides when told", () => {
  it("forces the face visible when progress arrives while hidden", () => {
    expect(applyFrame({ ...INITIAL_FACE_STATE, visible: false }, { event: "progress", detail: "looking" })).toEqual({
      ...INITIAL_FACE_STATE,
      visible: true,
      working: true,
      caption: "looking",
    });
  });

  it("hides during active work without cancelling the work", () => {
    const dismissed = dismissFace(working);
    expect(dismissed.visible).toBe(false);
    expect(dismissed.working).toBe(true);
  });

  it("stays visible through arbitrarily long progress because time is not an input", () => {
    let now = 0;
    let state = INITIAL_FACE_STATE;
    for (let hour = 0; hour < 48; hour += 1) {
      now += 60 * 60 * 1000;
      state = applyFrame(state, { event: "progress", detail: `working at ${now}` });
      expect(state.visible).toBe(true);
    }
  });

  it("contains no timer that can reach a hide call", () => {
    const sources = readSources(join(import.meta.dirname, ".."));
    expect(sources.length).toBeGreaterThan(0);
    const offenders = sources.filter(([, source]) =>
      /set(?:Timeout|Interval)\s*\([\s\S]{0,500}\b(?:hide|dismissFace)\s*\(/.test(stripComments(source)),
    );
    expect(offenders.map(([file]) => file)).toEqual([]);
  });

  it("clears the caption when dismissed", () => {
    expect(dismissFace(working).caption).toBeUndefined();
  });

  it("leaves the wake arm unchanged", () => {
    expect(dismissFace({ ...working, armed: false }).armed).toBe(false);
    expect(dismissFace({ ...working, armed: true }).armed).toBe(true);
  });

  it("opens the existing session gate on wake and closes it on the hub session-end path", () => {
    const open = acceptWake({ ...INITIAL_FACE_STATE, visible: false });
    expect(open).toMatchObject({ visible: true, voiceOpen: true, microphoneGateOpen: true, armed: true });
    expect(dismissFace(open).microphoneGateOpen).toBe(true);
    expect(applyFrame(open, { event: "voice_closed" }).microphoneGateOpen).toBe(false);
  });

  it("recognises only the three spoken dismissal gestures", () => {
    expect(["no", "Never mind", " SHUT UP "].every(isSpokenDismissal)).toBe(true);
    expect(isSpokenDismissal("stop the work")).toBe(false);
  });

  it("routes the tray and spoken gesture through the same exported dismissal function", () => {
    const main = readFileSync(join(import.meta.dirname, "..", "main.ts"), "utf8");
    expect(main.match(/dismissFace\(/g)?.length).toBe(1);
    expect(main).toMatch(/tray\.on\("click", dismiss\)/);
    expect(main).toMatch(/isSpokenDismissal\(utterance\).*dismiss\(\)/s);
  });
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function readSources(root: string): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__") files.push(...readSources(path));
    } else if (name.endsWith(".ts")) {
      files.push([path, readFileSync(path, "utf8")]);
    }
  }
  return files;
}
