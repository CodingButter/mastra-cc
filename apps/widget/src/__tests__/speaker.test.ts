import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the widget renderer audio graph", () => {
  it("captures and plays audio through Chromium rather than host PCM processes", () => {
    const audio = readFileSync(new URL("../renderer-audio.ts", import.meta.url), "utf8");
    const worklet = readFileSync(new URL("../audio-worklet.js", import.meta.url), "utf8");
    const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");

    expect(audio).toContain('addModule("./audio-worklet.js")');
    expect(worklet).toContain('registerProcessor("mastra-pcm16-capture"');
    expect(audio).toContain(`new ${["Audio", "WorkletNode"].join("")}(capture, "mastra-pcm16-capture")`);
    expect(audio).toContain(`${["createMedia", "StreamSource"].join("")}(stream)`);
    expect(audio).toContain("echoCancellation: true");
    expect(audio).toContain("capture.sampleRate !== 16_000");
    expect(audio).toContain("playback.sampleRate !== 24_000");
    expect(audio).toContain('playback.state !== "running"');
    expect(audio).toContain("await playback.resume()");
    expect(audio).toContain("onProviderAudioStopped(stopProviderAudio)");
    expect(audio).toContain("unsubscribeProviderAudio()");
    expect(main).toContain('send("face:provider-audio-stopped")');
    for (const forbidden of [["createMicrophone", "Stream"], ["createSpeaker", "Playback"], ["pw", "-play"], ["are", "cord"]]) {
      expect(main).not.toContain(forbidden.join(""));
    }
  });
});
