// The core's completion gate: a cold agent (a fresh Agent per run, no memory,
// the shipped INSTRUCTIONS and @mastra-cc/desktop's tools only) is given one
// task on a real desktop, through a real daemon. The harness then checks the
// outcome by a route that does not go through the daemon, and records turns,
// tokens and every refusal the daemon returned, by class.
// usage: GOOGLE_API_KEY=... node bench.mjs <repo-root> [--runs 5] [--only a,b] [--out results.jsonl]
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.argv[2];
const opt = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : process.argv[i + 1]; };
const RUNS = Number(opt("--runs", "5"));
const ONLY = opt("--only", "")?.split(",").filter(Boolean);
const OUT = opt("--out", "results.jsonl");
const MODEL = process.env.MODEL ?? "google/gemini-3.8-flash";
const here = new URL(".", import.meta.url).pathname;
const req = createRequire(join(root, "apps/desk-demo/package.json"));
const { Agent } = await import(req.resolve("@mastra/core/agent"));
const { MastraCC, INSTRUCTIONS } = await import(req.resolve("@mastra-cc/desktop/mastra"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = (f) => { try { return f(); } catch { return undefined; } };

// Every {class, code, message} object anywhere in a tool result is a refusal.
function refusalsIn(value, out = []) {
  if (value === null || typeof value !== "object") return out;
  if (["agent", "world", "daemon"].includes(value.class) && typeof value.code === "string") out.push({ class: value.class, code: value.code, message: value.message });
  for (const v of Object.values(value)) refusalsIn(v, out);
  return out;
}

async function startDaemon(backend, args) {
  const dir = mkdtempSync(join(tmpdir(), "bench-daemon-"));
  const socket = join(dir, "d.sock");
  const daemon = spawn(process.execPath, [join(root, "daemon/dist/main.mjs"), "--backend", backend, "--socket", socket, "--audit", join(dir, "audit.jsonl"), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; daemon.stdout.on("data", (d) => (log += d)); daemon.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 80 && !log.includes("listening on"); i++) await sleep(250);
  if (!log.includes("listening on")) throw new Error(`daemon did not start: ${log}`);
  return { socket, dir, log: () => log, stop: () => { daemon.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); } };
}

function webServer() {
  const seen = { submit: undefined, state: undefined };
  const server = createServer((q, s) => {
    let body = ""; q.on("data", (d) => (body += d)); q.on("end", () => {
      if (q.method === "POST" && q.url === "/submit") { seen.submit = Object.fromEntries(new URLSearchParams(body)); s.writeHead(200, { "content-type": "text/html" }); return s.end("<!doctype html><title>Thanks</title><h1>Thanks, you are signed up.</h1>"); }
      if (q.method === "POST" && q.url === "/state") { seen.state = JSON.parse(body); s.writeHead(204); return s.end(); }
      const file = { "/form": "form.html", "/todo": "todo.html", "/dist/todo.js": "dist/todo.js" }[q.url];
      if (!file) { s.writeHead(404); return s.end(); }
      s.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html" });
      s.end(readFileSync(join(here, "fixtures", file)));
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ seen, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

// Native apps are started by the harness and killed after each run, so every
// run begins from a fresh window.
function launch(cmd, args) { const p = spawn(cmd, args, { stdio: "ignore", detached: true }); return () => quiet(() => process.kill(-p.pid, "SIGKILL")); }
function atspiText(app) { return execFileSync("python3", [join(here, "read-text.py"), app], { encoding: "utf8" }); }

const TASKS = {
  mousepad: {
    kind: "native",
    async setup() { return launch("mousepad", []); },
    daemon: ["--permit", "mousepad", "--allow", "edit"],
    prompt: "Mousepad is open with an empty document. Write exactly this sentence into the document: The core is finished.",
    check: () => { const t = atspiText("mousepad"); if (process.env.BENCH_DEBUG) console.log("READ:", JSON.stringify(t)); return { ok: t.includes("The core is finished."), observed: t.trim().slice(0, 200) }; },
  },
  settings: {
    kind: "native",
    async setup() { return launch("gnome-control-center", []); },
    daemon: ["--permit", "gnome-control-center", "--allow", "activate", "--allow", "edit"],
    prompt: "GNOME Settings is open. Find out which operating system this computer runs, as Settings reports it, and tell me its name.",
    check: (_env, answer) => { const os = /PRETTY_NAME="?([^"\n]+)/.exec(readFileSync("/etc/os-release", "utf8"))[1].split(" ")[0]; return { ok: answer.includes(os), observed: `expected ${os}` }; },
  },
  files: {
    kind: "native",
    async setup(env) {
      env.folder = mkdtempSync(join(tmpdir(), "bench-folder-"));
      for (const f of ["invoice-march.pdf", "holiday-photo.png", "shopping.txt"]) writeFileSync(join(env.folder, f), "x");
      const stop = launch("nautilus", ["--new-window", env.folder]);
      return () => { stop(); rmSync(env.folder, { recursive: true, force: true }); };
    },
    daemon: [],
    grants: { applications: [{ name: "org.gnome.Nautilus", executable: "/usr/bin/nautilus" }] },
    prompt: "The Files app has a folder open. List the names of every file in that folder.",
    check: (_env, answer) => { const want = ["invoice-march.pdf", "holiday-photo.png", "shopping.txt"]; const missing = want.filter((w) => !answer.includes(w)); return { ok: missing.length === 0, observed: missing.length ? `missing ${missing.join(", ")}` : "all three named" }; },
  },
  form: {
    kind: "web", path: "/form",
    daemon: ["--permit", "chrome", "--grant", "chrome", "--allow", "edit", "--allow", "activate", "--allow", "submit"],
    prompt: "Chrome has a volunteer sign-up form open. Sign up Ada Lovelace, email ada@example.org, for the Afternoon shift, with a T-shirt. Submit the form.",
    check: (env) => { const s = env.web.seen.submit; const ok = s?.name === "Ada Lovelace" && s?.email === "ada@example.org" && s?.shift === "Afternoon" && s?.tshirt === "yes"; return { ok, observed: JSON.stringify(s ?? null) }; },
  },
  react: {
    kind: "web", path: "/todo",
    daemon: ["--permit", "chrome", "--grant", "chrome", "--allow", "edit", "--allow", "activate", "--allow", "submit"],
    prompt: "Chrome has a shopping list app open. Add two items to the list: milk, then eggs.",
    check: (env) => { const s = env.web.seen.state; return { ok: JSON.stringify(s) === JSON.stringify(["milk", "eggs"]), observed: JSON.stringify(s ?? null) }; },
  },
};

async function runOnce(name, task, n) {
  const env = {}; const cleanup = [];
  if (task.kind === "web") quiet(() => execFileSync("pkill", ["-9", "-f", "remote-debugging-port=9744"]));
  const record = { task: name, run: n, model: MODEL, ok: false, steps: 0, tokens: 0, toolCalls: [], toolResults: [], refusals: [], answer: "", observed: "", error: undefined, ms: 0 };
  const t0 = performance.now();
  try {
    if (task.kind === "web") {
      env.web = await webServer(); cleanup.push(env.web.close);
      const profile = mkdtempSync(join(tmpdir(), "bench-chrome-"));
      const chrome = spawn("google-chrome", ["--headless=new", "--remote-debugging-port=9744", `--user-data-dir=${profile}`, "--no-first-run", env.web.url + task.path], { stdio: "ignore", detached: true });
      cleanup.push(() => { quiet(() => process.kill(-chrome.pid, "SIGKILL")); quiet(() => execFileSync("pkill", ["-9", "-f", `user-data-dir=${profile}`])); rmSync(profile, { recursive: true, force: true }); });
      await sleep(3000);
    } else {
      cleanup.push(await task.setup(env));
      await sleep(4000);
    }
    let extra = [];
    if (task.grants) { const g = join(mkdtempSync(join(tmpdir(), "bench-grants-")), "grants.json"); writeFileSync(g, JSON.stringify(task.grants)); extra = ["--grants", g]; }
    // The same effect authority apps/desk-demo/desk-up.sh gives the demo client.
    const demoAllows = ["edit", "activate", "submit", "rawInput"].flatMap((a) => ["--allow", a]);
    const daemon = await startDaemon(task.kind === "web" ? "cdp" : "atspi", [...task.daemon.filter((a, i, all) => a !== "--allow" && all[i - 1] !== "--allow"), ...demoAllows, ...extra]); cleanup.push(daemon.stop);
    const desk = new MastraCC({ socketPath: daemon.socket }); cleanup.push(() => desk.close?.());
    const agent = new Agent({ id: "bench", name: "bench", instructions: INSTRUCTIONS, model: MODEL, tools: await desk.getTools() });
    const out = await Promise.race([
      agent.generate(task.prompt, {
        maxSteps: 30,
        onStepFinish: (s) => {
          for (const c of s.toolCalls ?? []) record.toolCalls.push(c.payload?.toolName ?? c.toolName);
          for (const r of s.toolResults ?? []) {
            const res = r.payload?.result ?? r.result;
            record.toolResults.push({ tool: r.payload?.toolName ?? r.toolName, result: JSON.stringify(res ?? null).slice(0, 600) });
            record.refusals.push(...refusalsIn(res));
          }
        },
      }),
      sleep(300_000).then(() => { throw new Error("run exceeded 5 minutes"); }),
    ]);
    record.steps = out.steps?.length ?? 0;
    record.tokens = out.usage?.totalTokens ?? 0;
    record.answer = (out.text ?? "").trim().replace(/\s+/g, " ").slice(0, 400);
    await sleep(500);
    if (process.env.BENCH_DEBUG) console.log("DAEMON:", daemon.log().split("\n").filter((l) => /failed|refus/i.test(l)).join("\n"));
    const verdict = task.check(env, record.answer);
    record.ok = verdict.ok; record.observed = verdict.observed;
  } catch (e) {
    record.error = String(e?.message ?? e).slice(0, 400);
  }
  record.ms = Math.round(performance.now() - t0);
  for (const f of cleanup.reverse()) await quiet(f);
  await sleep(1000);
  return record;
}

mkdirSync(here, { recursive: true });
for (const [name, task] of Object.entries(TASKS)) {
  if (ONLY?.length && !ONLY.includes(name)) continue;
  for (let n = 1; n <= RUNS; n++) {
    const r = await runOnce(name, task, n);
    appendFileSync(OUT, JSON.stringify(r) + "\n");
    const by = (c) => r.refusals.filter((x) => x.class === c).length;
    console.log(`${name}#${n} ${r.ok ? "PASS" : "FAIL"} steps=${r.steps} tokens=${r.tokens} refusals agent=${by("agent")} world=${by("world")} daemon=${by("daemon")} ${r.error ? "error=" + r.error : ""} observed=${r.observed}`);
  }
}
process.exit(0);
