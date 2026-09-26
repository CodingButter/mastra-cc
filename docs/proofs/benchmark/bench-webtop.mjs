// The completion benchmark, on the Webtop desk rather than the host session.
// Everything the agent touches - the daemon, the applications, Chromium, the web
// fixtures and the independent checks - runs inside the pinned KDE Webtop
// container. Only the model client runs on the host, and it reaches the daemon
// over the daemon's WebSocket at the container's address.
// usage: GOOGLE_API_KEY=... node bench-webtop.mjs <repo-root> [--runs 5] [--only a,b] [--out results.jsonl]
// Requires: the container from `MASTRA_CC_WEBTOP_PROJECT=mcc-bench infra/webtop` up, node inside it,
// and `pnpm turbo run build` done on <repo-root>.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = process.argv[2];
const opt = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : process.argv[i + 1]; };
const RUNS = Number(opt("--runs", "5"));
const ONLY = opt("--only", "")?.split(",").filter(Boolean);
const OUT = opt("--out", "results.jsonl");
const MODEL = process.env.MODEL ?? "google/gemini-3.8-flash";
const CONTAINER = process.env.MASTRA_CC_WEBTOP_CONTAINER ?? "mcc-bench";
const WS_PORT = 9990;
const DEPLOY = "/opt/mastra-cc/bench";
const here = new URL(".", import.meta.url).pathname;
const req = createRequire(join(root, "apps/desk-demo/package.json"));
const { Agent } = await import(req.resolve("@mastra/core/agent"));
const { MastraCC, INSTRUCTIONS } = await import(req.resolve("@mastra-cc/desktop/mastra"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = (f) => { try { return f(); } catch { return undefined; } };

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", env: { ...process.env, DOCKER_HOST: process.env.DOCKER_HOST ?? "unix:///var/run/docker.sock" } });
// A command in the desktop user's session: its display and its session bus.
const session = (cmd) => docker("exec", "-u", "1000", CONTAINER, "bash", "-lc",
  `export DISPLAY=:1 XDG_RUNTIME_DIR=/config/.XDG; export DBUS_SESSION_BUS_ADDRESS=$(tr '\\0' '\\n' </proc/$(pgrep -n plasmashell)/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p'); ${cmd}`);
const background = (cmd, log) => session(`nohup ${cmd} >${log} 2>&1 </dev/null & echo $!`).trim();

function refusalsIn(value, out = []) {
  if (value === null || typeof value !== "object") return out;
  if (["agent", "world", "daemon"].includes(value.class) && typeof value.code === "string") out.push({ class: value.class, code: value.code, message: value.message });
  for (const v of Object.values(value)) refusalsIn(v, out);
  return out;
}

function deploy() {
  docker("exec", CONTAINER, "rm", "-rf", DEPLOY);
  docker("exec", CONTAINER, "mkdir", "-p", `${DEPLOY}/daemon`);
  docker("cp", join(root, "daemon/dist") + "/.", `${CONTAINER}:${DEPLOY}/daemon/`);
  for (const f of ["fixtures", "read-text.py", "fixture-server.mjs"]) docker("cp", join(here, f), `${CONTAINER}:${DEPLOY}/`);
  docker("exec", CONTAINER, "chown", "-R", "1000:1000", DEPLOY);
}

function clearDesk() {
  quiet(() => session(`for a in kate dolphin systemsettings chromium; do pkill -9 -x $a; done; pkill -9 -f ${DEPLOY}/; rm -rf /config/.local/share/kate/anonymous.katesession /config/bench-folder /tmp/bench-*; true`));
}

async function startDaemon(backend, args) {
  const cmd = `/usr/local/bin/node ${DEPLOY}/daemon/main.mjs --backend ${backend} --socket /tmp/bench-d.sock --audit /tmp/bench-audit.jsonl --ws-host 0.0.0.0 --ws-port ${WS_PORT} ${args.join(" ")}`;
  background(cmd, "/tmp/bench-daemon.log");
  for (let i = 0; i < 80; i++) { if (quiet(() => session("grep -q websocket /tmp/bench-daemon.log && echo y"))?.trim() === "y") break; await sleep(250); }
  const log = () => quiet(() => session("cat /tmp/bench-daemon.log")) ?? "";
  if (!log().includes("websocket")) throw new Error(`daemon did not start: ${log()}`);
  const ip = docker("inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", CONTAINER).trim();
  return { url: `ws://${ip}:${WS_PORT}`, log };
}

const atspiText = (app) => session(`python3 ${DEPLOY}/read-text.py ${app}`);
const seen = () => JSON.parse(quiet(() => session("cat /tmp/bench-seen.json")) || "{}");
const allow = ["edit", "activate", "submit", "rawInput"].flatMap((a) => ["--allow", a]);

const TASKS = {
  kate: {
    kind: "native",
    setup: () => background("kate -n", "/tmp/bench-app.log"),
    daemon: ["--permit", "kate", "--grant", "kate"],
    prompt: "Kate is open with an empty document. Write exactly this sentence into the document: The core is finished.",
    check: () => { const t = atspiText("kate"); return { ok: t.includes("The core is finished."), observed: t.trim().slice(0, 200) }; },
  },
  settings: {
    kind: "native",
    setup: () => background("systemsettings", "/tmp/bench-app.log"),
    daemon: ["--permit", "systemsettings", "--grant", "systemsettings"],
    prompt: "KDE System Settings is open. Find out which operating system this computer runs, as System Settings reports it, and tell me its name.",
    // The About page is kinfocenter's; the pinned image ships without it, so
    // the task was unanswerable until setup installs it. Settings reports the
    // distribution as "Kubuntu", so match the word case-insensitively.
    prepare: () => docker("exec", CONTAINER, "bash", "-lc", "dpkg -s kinfocenter >/dev/null 2>&1 || (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq kinfocenter) >/dev/null 2>&1"),
    check: (answer) => { const os = /PRETTY_NAME="?([^"\n]+)/.exec(session("cat /etc/os-release"))[1].split(" ")[0]; return { ok: answer.toLowerCase().includes(os.toLowerCase()), observed: `expected ${os}` }; },
  },
  files: {
    kind: "native",
    setup: () => { session("mkdir -p /config/bench-folder && cd /config/bench-folder && touch invoice-march.pdf holiday-photo.png shopping.txt"); return background("dolphin --new-window /config/bench-folder", "/tmp/bench-app.log"); },
    daemon: ["--permit", "dolphin", "--grant", "dolphin"],
    prompt: "The Dolphin file manager has a folder open. List the names of every file in that folder.",
    check: (answer) => { const want = ["invoice-march.pdf", "holiday-photo.png", "shopping.txt"]; const missing = want.filter((w) => !answer.includes(w)); return { ok: missing.length === 0, observed: missing.length ? `missing ${missing.join(", ")}` : "all three named" }; },
  },
  form: {
    kind: "web", path: "/form",
    prompt: "Chrome has a volunteer sign-up form open. Sign up Ada Lovelace, email ada@example.org, for the Afternoon shift, with a T-shirt. Submit the form.",
    check: () => { const s = seen().submit; const ok = s?.name === "Ada Lovelace" && s?.email === "ada@example.org" && s?.shift === "Afternoon" && s?.tshirt === "yes"; return { ok, observed: JSON.stringify(s ?? null) }; },
  },
  react: {
    kind: "web", path: "/todo",
    prompt: "Chrome has a shopping list app open. Add two items to the list: milk, then eggs.",
    check: () => { const s = seen().state; return { ok: JSON.stringify(s) === JSON.stringify(["milk", "eggs"]), observed: JSON.stringify(s ?? null) }; },
  },
  bad: {
    kind: "web", path: "/bad",
    prompt: "Chrome has a newsletter page open. Enter the name Grace, press \"Send it\", and turn on Subscribe.",
    check: () => { const s = seen().state; const ok = s?.name === "Grace" && s?.sent === true && s?.subscribed === true; return { ok, observed: JSON.stringify(s ?? null) }; },
  },
};

async function runOnce(name, task, n) {
  const record = { task: name, run: n, model: MODEL, desk: `webtop:${CONTAINER}`, ok: false, steps: 0, tokens: 0, toolCalls: [], toolResults: [], refusals: [], answer: "", observed: "", error: undefined, ms: 0 };
  const t0 = performance.now();
  let desk;
  clearDesk();
  try {
    let daemon;
    if (task.kind === "web") {
      background(`/usr/local/bin/node ${DEPLOY}/fixture-server.mjs ${DEPLOY}/fixtures /tmp/bench-seen.json 8088`, "/tmp/bench-fixtures.log");
      await sleep(500);
      // A visible Chromium, driven over the accessibility bus (the desktop
      // route). No debugging port: the agent's only way in is the daemon, and
      // the check reads the fixture server's POST log, not the page.
      const chrome = background(`chromium --no-sandbox --no-first-run --force-renderer-accessibility --user-data-dir=/tmp/bench-a11y-chrome http://127.0.0.1:8088${task.path}`, "/tmp/bench-chrome.log");
      await sleep(5000);
      const exe = session(`readlink -f /proc/$(pgrep -o -f 'chromium/chromium.*bench-a11y-chrome')/exe`).trim();
      session(`echo '${JSON.stringify({ applications: [{ name: "Chromium", executable: exe }] })}' > /tmp/bench-grants.json`);
      record.route = { backend: "atspi", chromium: exe, launcher: chrome };
      daemon = await startDaemon("atspi", ["--grants", "/tmp/bench-grants.json", ...allow]);
    } else {
      task.prepare?.();
      task.setup();
      await sleep(5000);
      daemon = await startDaemon("atspi", ["--acquire-accessibility", ...task.daemon, ...allow]);
    }
    desk = new MastraCC({ url: daemon.url });
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
    const verdict = task.check(record.answer);
    record.ok = verdict.ok; record.observed = verdict.observed;
  } catch (e) {
    record.error = String(e?.message ?? e).slice(0, 400);
  }
  record.ms = Math.round(performance.now() - t0);
  await quiet(() => desk?.close?.());
  clearDesk();
  await sleep(1000);
  return record;
}

deploy();
for (const [name, task] of Object.entries(TASKS)) {
  if (ONLY?.length && !ONLY.includes(name)) continue;
  for (let n = 1; n <= RUNS; n++) {
    let r;
    for (let attempt = 1; ; attempt++) {
      r = await runOnce(name, task, n);
      const infra = /quota|RESOURCE_EXHAUSTED|high demand|depleted|\b402\b|\b429\b|\b503\b|overloaded|billing/i.test(`${r.error ?? ""} ${r.answer ?? ""}`);
      if (!infra || attempt === 4) { r.attempts = attempt; if (infra) r.infra = "provider"; break; }
      appendFileSync(join(here, "bench-webtop-provider-refused.jsonl"), JSON.stringify({ ...r, attempt }) + "\n");
      console.log(`${name}#${n} provider refused (attempt ${attempt}); retrying in 90s`);
      await sleep(90_000);
    }
    appendFileSync(OUT, JSON.stringify(r) + "\n");
    const by = (c) => r.refusals.filter((x) => x.class === c).length;
    console.log(`${name}#${n} ${r.ok ? "PASS" : "FAIL"} steps=${r.steps} tokens=${r.tokens} refusals agent=${by("agent")} world=${by("world")} daemon=${by("daemon")} ${r.error ? "error=" + r.error : ""} observed=${r.observed}`);
  }
}
process.exit(0);
