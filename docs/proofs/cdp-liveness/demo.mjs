#!/usr/bin/env node
// Live proof that the browser backend neither hangs the desk nor overclaims a write.
//
// Real headless Chrome on the daemon's fixed debugging port, a real daemon
// built from the tree under test, and raw Unix-socket clients speaking the
// wire protocol. Each scenario gets its own Chrome and daemon, so one page
// that holds the desk cannot bleed into the next scenario's measurement.
//
//   node demo.mjs --daemon <tree>/daemon/dist/main.mjs --out <file> [--fixtures <dir>] [--only a,b]
//
// Prints one `SCENARIO <name>: GREEN|RED <measurements>` line per scenario,
// `SETUP-FAILURE <reason>` when Chrome/daemon/fixtures never came up (never
// confused with RED), and `PROOF: GREEN` only when every scenario is GREEN.

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const daemonPath = resolve(arg("--daemon") ?? "");
const outPath = arg("--out");
const fixtures = resolve(arg("--fixtures", join(here, "fixtures")));
const only = arg("--only")?.split(",");

const PORT = 9744;
const CAP_MS = 30_000;
const DIGEST = await (async () => {
  const types = join(dirname(daemonPath), "..", "node_modules", "@mastra-cc", "protocol-types", "dist", "index.js");
  return (await import(types)).SCHEMA_DIGEST;
})();

const lines = [];
const say = (line) => {
  lines.push(line);
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

class SetupFailure extends Error {}

// ---- fixture server -------------------------------------------------------

const TYPES = { ".html": "text/html", ".js": "text/javascript" };
const server = createServer((req, res) => {
  const path = join(fixtures, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!path.startsWith(fixtures) || !existsSync(path)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

// ---- Chrome ---------------------------------------------------------------

async function json(path) {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, { signal: AbortSignal.timeout(2000) });
  return response.json();
}

async function startChrome(page) {
  const profile = mkdtempSync(join(tmpdir(), "cdp-liveness-chrome-"));
  const proc = spawn(
    "google-chrome",
    ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", `${origin}/${page}`],
    { stdio: "ignore", detached: true },
  );
  const stop = () => {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {}
    rmSync(profile, { recursive: true, force: true });
  };
  for (let i = 0; i < 40; i++) {
    try {
      const version = await json("/json/version");
      const browser = String(version.Browser ?? "").split("/")[0].toLowerCase();
      return { stop, browser };
    } catch {
      await sleep(250);
    }
  }
  stop();
  throw new SetupFailure("chrome never answered /json/version on 9744");
}

async function pageTarget(title) {
  for (let i = 0; i < 40; i++) {
    try {
      const target = (await json("/json/list")).find((t) => t.type === "page" && t.title === title);
      if (target) return target;
    } catch {}
    await sleep(250);
  }
  throw new SetupFailure(`page "${title}" never loaded`);
}

// The page's own world: an outside CDP client evaluating in the default
// context runs with exactly the privilege of a page script.
async function pageScript(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = () => j(new SetupFailure("could not open the page's debugging socket"));
  });
  const reply = await new Promise((r) => {
    ws.onmessage = (m) => {
      const data = JSON.parse(m.data);
      if (data.id === 1) r(data);
    };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  ws.close();
  return reply.result?.result?.value;
}

// ---- daemon ---------------------------------------------------------------

async function startDaemon(browser) {
  const dir = mkdtempSync(join(tmpdir(), "cdp-liveness-daemon-"));
  const socket = join(dir, "d.sock");
  const proc = spawn(
    process.execPath,
    [daemonPath, "--backend", "cdp", "--socket", socket, "--permit", browser, "--grant", browser, "--allow", "edit", "--audit", join(dir, "audit.jsonl")],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  const stop = () => {
    proc.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  };
  for (let i = 0; i < 40; i++) {
    if (log.includes("listening on")) return { stop, socket };
    if (proc.exitCode !== null) break;
    await sleep(250);
  }
  stop();
  throw new SetupFailure(`daemon never listened: ${log.trim().slice(0, 200)}`);
}

async function client(socket) {
  const s = createConnection(socket);
  let buffer = "";
  let id = 0;
  const waiting = new Map();
  const events = [];
  let helloed;
  const hello = new Promise((r) => (helloed = r));
  s.on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      if (message.type === "hello") helloed(message);
      else if (message.type === "event") events.push(message.event);
      else if (waiting.has(message.id)) waiting.get(message.id)(message);
    }
  });
  s.on("error", () => {});
  s.write(JSON.stringify({ type: "hello", digest: DIGEST }) + "\n");
  await Promise.race([hello, sleep(5000).then(() => Promise.reject(new SetupFailure("no hello from the daemon")))]);
  return {
    events,
    close: () => s.destroy(),
    // resolves to {ms, message} or {ms, pending: true} at the cap
    request(method, params = {}, cap = CAP_MS) {
      const requestId = ++id;
      const sent = now();
      const answered = new Promise((r) => waiting.set(requestId, r));
      s.write(JSON.stringify({ type: "request", id: requestId, method, params }) + "\n");
      return Promise.race([
        answered.then((message) => ({ ms: Math.round(now() - sent), message })),
        sleep(cap).then(() => ({ ms: cap, pending: true })),
      ]);
    },
  };
}

const text = (answer) => (answer.pending ? "PENDING" : JSON.stringify(answer.message.result ?? answer.message).slice(0, 160));
const refusal = (answer) => (answer.pending ? undefined : answer.message.result?.refusal);

// ---- scenarios ------------------------------------------------------------

const scenarios = {
  async deadline(browser) {
    const daemon = await startDaemon(browser);
    try {
      await pageTarget("Spin");
      await sleep(1000);
      const a = await client(daemon.socket);
      const answer = await a.request("queryElements", { application: browser, window: "Spin" });
      const green = !answer.pending && answer.ms <= 12_000 && /did not answer/.test(refusal(answer) ?? "");
      return [green, `queryElements answered_in=${answer.pending ? ">=30000(cap)" : answer.ms}ms answer=${text(answer)}`];
    } finally {
      daemon.stop();
    }
  },

  async "dialog-after"(browser) {
    const daemon = await startDaemon(browser);
    try {
      await pageTarget("Alert");
      await sleep(500);
      const [a, b, c] = [await client(daemon.socket), await client(daemon.socket), await client(daemon.socket)];
      const first = a.request("queryElements", { application: browser, window: "Alert" });
      await sleep(1000);
      const [second, third] = await Promise.all([b.request("queryElements", { application: browser, window: "Alert" }), c.request("listApplications")]);
      const firstAnswer = await Promise.race([first, sleep(1).then(() => ({ pending: true }))]);
      const green = !second.pending && second.ms <= 2000 && /dialog/.test(refusal(second) ?? "") && !third.pending && third.ms <= 2000;
      return [
        green,
        `A.queryElements=${firstAnswer.pending ? "PENDING" : "answered"} B.queryElements=${second.pending ? ">=30000(cap)" : second.ms}ms C.listApplications=${third.pending ? ">=30000(cap)" : third.ms}ms B.answer=${text(second)}`,
      ];
    } finally {
      daemon.stop();
    }
  },

  async "dialog-before"(browser) {
    await pageTarget("Alert");
    await sleep(1500); // the alert is up before the daemon exists
    const daemon = await startDaemon(browser);
    try {
      const a = await client(daemon.socket);
      const answer = await a.request("queryElements", { application: browser, window: "Alert" });
      const green = !answer.pending && answer.ms <= 2000 && /dialog/.test(refusal(answer) ?? "");
      return [green, `first queryElements=${answer.pending ? ">=30000(cap)" : answer.ms}ms answer=${text(answer)}`];
    } finally {
      daemon.stop();
    }
  },

  async isolation(browser) {
    const daemon = await startDaemon(browser);
    try {
      const target = await pageTarget("Probe");
      const a = await client(daemon.socket);
      const found = await a.request("queryElements", { application: browser, window: "Probe", role: "textbox" });
      const field = found.message?.result?.elements?.[0];
      if (!field) throw new SetupFailure(`no textbox on the probe page: ${text(found)}`);
      const watch = await a.request("subscribeElement", { id: field.id, priority: "low" });
      if (!watch.message?.result?.subscription && !watch.message?.result?.subscriptionId) {
        throw new SetupFailure(`subscribeElement did not establish a watch: ${text(watch)}`);
      }
      await sleep(500);
      // Page script: what can it see of the daemon's instrumentation?
      const visible = await pageScript(target, "typeof window.__mastraCcStream");
      const bindingVisible = await pageScript(target, "typeof window.__mastraCcChange");
      // A real change the daemon should report.
      await pageScript(target, "document.getElementById('field').setAttribute('data-real', '1'), true");
      await sleep(1500);
      const real = a.events.length;
      // Page script: forge a change. Learn the watch id from the binding's own
      // traffic, point the stash at the decoy, and call the binding.
      const forged = await pageScript(
        target,
        `(async () => {
          const stream = window.__mastraCcStream, binding = window.__mastraCcChange;
          if (typeof binding !== "function" || !stream) return "no-binding";
          let watchId;
          window.__mastraCcChange = (payload) => { watchId = JSON.parse(payload).watchId; return binding(payload); };
          document.getElementById('field').setAttribute('data-learn', '1');
          await new Promise((r) => setTimeout(r, 300));
          window.__mastraCcChange = binding;
          stream.take = () => document.getElementById('decoy');
          binding(JSON.stringify({ watchId, batch: [{ index: 0, kind: "changed" }] }));
          return watchId ? "forged" : "no-watch-id";
        })()`,
      );
      await sleep(1500);
      const decoyNamed = a.events.filter((e) => e.kind === "changed").length;
      const afterForgery = a.events.length - real;
      // On a daemon whose binding is visible, the learning edit itself is one
      // real event; anything beyond that is the forgery landing.
      const forgedDelivered = forged === "forged" ? Math.max(0, afterForgery - 1) : afterForgery;
      const green = visible === "undefined" && bindingVisible === "undefined" && real >= 1 && forgedDelivered === 0;
      return [
        green,
        `page_sees_stream=${visible} page_sees_binding=${bindingVisible} real_events=${real} forgery=${forged} forged_events_delivered=${forgedDelivered} changed_total=${decoyNamed}`,
      ];
    } finally {
      daemon.stop();
    }
  },
};

const pages = { deadline: "spin.html", "dialog-after": "alert.html", "dialog-before": "alert.html", isolation: "probe.html" };
const REACT = ["react-accept", "react-filter", "react-async-revert", "react-number"];

// ---- run ------------------------------------------------------------------

const sha = (() => {
  try {
    return execFileSync("git", ["-C", dirname(daemonPath), "rev-parse", "HEAD"]).toString().trim();
  } catch {
    return "unknown";
  }
})();
say(`# cdp-liveness proof - daemon ${daemonPath} at ${sha} - ${new Date().toISOString()}`);

let allGreen = true;
for (const name of [...Object.keys(scenarios), ...REACT]) {
  if (only && !only.includes(name)) continue;
  if (!scenarios[name]) {
    say(`SCENARIO ${name}: SKIPPED (fixture not yet built)`);
    allGreen = false;
    continue;
  }
  let chrome;
  try {
    chrome = await startChrome(pages[name]);
    const [green, detail] = await Promise.race([
      scenarios[name](chrome.browser),
      sleep(CAP_MS * 2).then(() => [false, "scenario exceeded its hard cap"]),
    ]);
    say(`SCENARIO ${name}: ${green ? "GREEN" : "RED"} ${detail}`);
    if (!green) allGreen = false;
  } catch (error) {
    allGreen = false;
    if (error instanceof SetupFailure) say(`SETUP-FAILURE ${name}: ${error.message}`);
    else say(`SETUP-FAILURE ${name}: ${error?.stack ?? error}`);
  } finally {
    chrome?.stop();
    await sleep(500);
  }
}
if (allGreen) say("PROOF: GREEN");
server.close();
if (outPath) writeFileSync(outPath, lines.join("\n") + "\n");
process.exit(0);
