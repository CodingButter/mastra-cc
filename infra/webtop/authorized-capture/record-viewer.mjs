import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";

const [port, directory, mode] = process.argv.slice(2);
assert(/^[0-9]+$/.test(port) && Number(port) > 1024 && Number(port) < 65536);
assert(directory?.startsWith("/") && ["branch", "base"].includes(mode));
assert(process.env.MASTRA_CC_PLAYWRIGHT_ROOT, "set MASTRA_CC_PLAYWRIGHT_ROOT to an existing Playwright installation");
const require = createRequire(`${process.env.MASTRA_CC_PLAYWRIGHT_ROOT}/package.json`);
const { chromium } = require("playwright");
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, recordVideo: { dir: directory, size: { width: 1024, height: 768 } } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(10000);
  const dimensions = await page.evaluate(() => [...document.querySelectorAll("canvas, video")].map(e => ({ tag: e.tagName, width: e.width, height: e.height, videoWidth: e.videoWidth, videoHeight: e.videoHeight })));
  assert(dimensions.some(e => e.width > 0 && e.height > 0), "viewer must expose a rendered surface");
  await page.screenshot({ path: `${directory}/${mode}-viewer.png` });
  await writeFile(`${directory}/${mode}-viewer.json`, JSON.stringify({ viewport: page.viewportSize(), dimensions, title: await page.title() }, null, 2));
  await page.waitForTimeout(5000);
  const video = page.video();
  await context.close();
  await video.saveAs(`${directory}/${mode === "branch" ? "viewer" : "base-viewer"}.webm`);
  await video.delete();
} finally {
  await browser.close();
}
