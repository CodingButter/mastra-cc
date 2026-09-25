import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EffectUnsupportedError } from "../../../backend.js";
import { liveCdpChannel } from "../channel.js";
import { CdpBackend } from "../index.js";

// D4 against a real Chrome, through the backend: a form's submit button
// commits (the page's own submit handler runs), and a plain button - the
// benchmark's React "Add item" - is refused with its click handler untouched.
const PAGE =
  `<!doctype html><title>start</title>` +
  `<form onsubmit="event.preventDefault(); document.title = 'submitted'"><input name=q value=x><button type=submit>Sign up</button></form>` +
  `<button type=button onclick="document.title = 'clicked'">Add item</button>`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(process.env.MASTRA_CC_LIVE !== "1")("a commit on the browser route, in a real browser", () => {
  it("submits a form through its submit button, and refuses a button that belongs to no form", async () => {
    const profile = mkdtempSync(join(tmpdir(), "mastra-cc-commit-"));
    const chrome = spawn(
      "google-chrome",
      ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, `data:text/html,${encodeURIComponent(PAGE)}`],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    try {
      const port = await new Promise<number>((resolve, reject) => {
        let buffered = "";
        const timer = setTimeout(() => reject(new Error(`no DevTools line: ${buffered}`)), 15_000);
        chrome.stderr.on("data", (chunk: Buffer) => {
          buffered += chunk.toString();
          const match = buffered.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
          if (match) {
            clearTimeout(timer);
            resolve(Number(match[1]));
          }
        });
      });
      await sleep(1000);
      const backend = new CdpBackend(liveCdpChannel(`http://127.0.0.1:${port}`), "all");
      const title = async () => (await backend.queryElements({ role: "window" })).elements?.[0]?.name;
      const button = async (name: string) =>
        (await backend.queryElements({ role: "button", name })).elements?.[0]?.id as string;

      const plain = await button("Add item");
      await expect(backend.submitElement({ id: plain, attestation: "Add item" })).rejects.toBeInstanceOf(EffectUnsupportedError);
      expect(await title()).toBe("start");

      await backend.submitElement({ id: await button("Sign up"), attestation: "Sign up" });
      for (let i = 0; i < 20 && (await title()) !== "submitted"; i++) await sleep(50);
      expect(await title()).toBe("submitted");
      await backend.close();
    } finally {
      const exited = new Promise<void>((resolve) => chrome.once("exit", () => resolve()));
      chrome.kill("SIGTERM");
      await exited;
      rmSync(profile, { recursive: true, force: true });
    }
  }, 60_000);
});
