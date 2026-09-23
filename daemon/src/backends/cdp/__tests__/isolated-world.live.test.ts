import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type BackendChange, EffectUnsupportedError, WatchUnsupportedError } from "../../../backend.js";
import { liveCdpChannel } from "../channel.js";
import { contentOf, setValueOf } from "../effects.js";

// The daemon's own world, against a real Chrome. The page half of every check
// here is run in the page's main world (a Runtime.evaluate with no context),
// which is exactly the reach of a script the page itself ships.

const PAGE = `<!doctype html><title>Iso</title><input id="f" value="start"><iframe srcdoc="<input id=g value=inner>"></iframe>`;

async function withChrome(run: (endpoint: string) => Promise<void>): Promise<void> {
  const profile = mkdtempSync(join(tmpdir(), "mastra-cc-cdp-iso-"));
  const chrome = spawn(
    "google-chrome",
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
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
    await run(`http://127.0.0.1:${port}`);
  } finally {
    const exited = new Promise<void>((resolve) => chrome.once("exit", () => resolve()));
    chrome.kill("SIGTERM");
    await exited;
    rmSync(profile, { recursive: true, force: true });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(process.env.MASTRA_CC_LIVE !== "1")("the daemon's own world in a real browser", () => {
  it(
    "watches a real change from its own world, invisible to the page, and refuses another frame's element",
    async () => {
      await withChrome(async (endpoint) => {
        const channel = liveCdpChannel(endpoint);
        const list = (await channel.exchange({ kind: "list" })) as Array<{ id: string; type: string }>;
        const targetId = list.find((t) => t.type === "page")!.id;
        const call = (method: string, params: Record<string, unknown> = {}) =>
          channel.exchange({ kind: "call", targetId, method, params }) as Promise<{ result?: Record<string, unknown> }>;
        // Page script: the main world, no context named.
        const page = async (expression: string) =>
          ((await call("Runtime.evaluate", { expression, returnByValue: true })).result?.result as { value?: unknown })?.value;

        await call("Page.navigate", { url: `data:text/html,${encodeURIComponent(PAGE)}` });
        for (let i = 0; i < 50 && (await page("document.readyState + (frames[0]?.document.readyState ?? '')")) !== "completecomplete"; i++) {
          await sleep(50);
        }

        const doc = (await call("DOM.getDocument", { depth: -1, pierce: true })).result?.root as unknown;
        const byId = (node: unknown, id: string): number | undefined => {
          const n = node as { attributes?: string[]; backendNodeId: number; children?: unknown[]; contentDocument?: unknown };
          const attrs = n.attributes ?? [];
          for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === "id" && attrs[i + 1] === id) return n.backendNodeId;
          for (const child of [...(n.children ?? []), ...(n.contentDocument ? [n.contentDocument] : [])]) {
            const found = byId(child, id);
            if (found !== undefined) return found;
          }
          return undefined;
        };
        const main = byId(doc, "f")!;
        const inner = byId(doc, "g")!;
        expect(main).toBeDefined();
        expect(inner).toBeDefined();

        // 1. The binding is installed in the daemon's world and a real change
        //    arrives - asserted before anything about invisibility.
        const changes: BackendChange[] = [];
        const watch = await channel.watch("watched", (change) => changes.push(change), {
          targetId,
          backendDOMNodeId: main,
          role: "textbox",
        });
        await page("document.getElementById('f').setAttribute('data-x', '1')");
        for (let i = 0; i < 40 && changes.length === 0; i++) await sleep(25);
        expect(changes.some((c) => c.kind === "changed" || c.kind === "appeared")).toBe(true);

        // 2. The page cannot see it.
        expect(await page("typeof window.__mastraCcStream")).toBe("undefined");
        expect(await page("typeof window.__mastraCcChange")).toBe("undefined");

        // 3. Another frame's element is refused, and left exactly as it was.
        await expect(setValueOf(channel, { targetId, backendDOMNodeId: inner }, "overwritten")).rejects.toBeInstanceOf(
          EffectUnsupportedError,
        );
        expect(await page("frames[0].document.getElementById('g').value")).toBe("inner");
        await expect(
          channel.watch("inner", () => undefined, { targetId, backendDOMNodeId: inner, role: "textbox" }),
        ).rejects.toBeInstanceOf(WatchUnsupportedError);

        // 4. The main frame's own element is reached from the daemon's world.
        expect(await contentOf(channel, { targetId, backendDOMNodeId: main })).toBe("start");
        await watch.close();

        // 5. A navigation replaces the document; the next effect gets a new world.
        await call("Page.navigate", { url: `data:text/html,${encodeURIComponent(PAGE.replace("start", "again"))}` });
        for (let i = 0; i < 50 && (await page("document.getElementById('f')?.value")) !== "again"; i++) await sleep(50);
        const doc2 = (await call("DOM.getDocument", { depth: -1, pierce: true })).result?.root as unknown;
        expect(await contentOf(channel, { targetId, backendDOMNodeId: byId(doc2, "f")! })).toBe("again");
        await channel.close();
      });
    },
    60_000,
  );
});
