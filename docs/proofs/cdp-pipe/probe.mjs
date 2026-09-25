// Launches the built daemon's own "chrome" recipe (headless, throwaway
// profile), then asks - as an unrelated local process would - whether the
// debugging endpoint on 127.0.0.1:9744 answers.
// usage: node probe.mjs <repo-root>
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.argv[2];
let recipe;
for (const f of readdirSync(join(root, "daemon/dist")).filter((f) => f.startsWith("server-") && f.endsWith(".mjs"))) {
  const mod = await import(join(root, "daemon/dist", f));
  for (const v of Object.values(mod)) if (v?.chrome?.argv) recipe = v.chrome;
}
const profile = mkdtempSync(join(tmpdir(), "cdp-pipe-proof-"));
const argv = recipe.argv.slice(1).map((a) => (a.startsWith("--user-data-dir=") ? `--user-data-dir=${profile}` : a)).filter((a) => !a.startsWith("http"));
argv.unshift("--headless=new");
console.log(`recipe flags: ${recipe.argv.filter((a) => a.includes("remote-debugging")).join(" ")}`);
const child = spawn(recipe.argv[0], [...argv, "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
await new Promise((r) => setTimeout(r, 3000));
try {
  const reply = await fetch("http://127.0.0.1:9744/json/version", { signal: AbortSignal.timeout(3000) });
  const body = await reply.json();
  console.log(`another process reached the browser: ${body.Browser} at ${body.webSocketDebuggerUrl}`);
  console.log("RESULT: RED - the browser can be driven around the daemon");
} catch (e) {
  console.log(`another process was refused: ${e.cause?.code ?? e.message}`);
  console.log("RESULT: GREEN - no debugging port; only the daemon's pipe reaches the browser");
}
child.kill("SIGTERM");
await new Promise((r) => child.once("exit", r));
rmSync(profile, { recursive: true, force: true });
