// Scripted, model-free probe: can the daemon alone reach the OS name in KDE
// System Settings on the Webtop desk? Usage: node settings-probe.mjs <repo-root>
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = process.argv[2];
const CONTAINER = "mcc-bench", WS_PORT = 9990, DEPLOY = "/opt/mastra-cc/bench";
const req = createRequire(join(root, "apps/desk-demo/package.json"));
const { connect } = await import(req.resolve("@mastra-cc/desktop"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) => execFileSync("docker", a, { encoding: "utf8", env: { ...process.env, DOCKER_HOST: "unix:///var/run/docker.sock" } });
const session = (cmd) => docker("exec", "-u", "1000", CONTAINER, "bash", "-lc",
  `export DISPLAY=:1 XDG_RUNTIME_DIR=/config/.XDG; export DBUS_SESSION_BUS_ADDRESS=$(tr '\\0' '\\n' </proc/$(pgrep -n plasmashell)/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p'); ${cmd}`);
const bg = (cmd, log) => session(`nohup ${cmd} >${log} 2>&1 </dev/null & echo $!`);

try { session(`pkill -9 -x systemsettings; pkill -9 -f ${DEPLOY}/; true`); } catch {}
bg("systemsettings", "/tmp/probe-app.log");
await sleep(4000);
bg(`/usr/local/bin/node ${DEPLOY}/daemon/main.mjs --backend atspi --socket /tmp/probe-d.sock --audit /tmp/probe-audit.jsonl --ws-host 0.0.0.0 --ws-port ${WS_PORT} --permit systemsettings --grant systemsettings --allow activate --allow edit --allow rawInput`, "/tmp/probe-daemon.log");
await sleep(3000);
const ip = docker("inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", CONTAINER).trim();
const c = await connect({ url: `ws://${ip}:${WS_PORT}` });
const app = "systemsettings";

const items = await c.queryElements({ application: app, role: "listitem", limit: 500 });
const names = (items.elements ?? []).map((e) => e.name);
console.log(`sidebar listitems (${names.length}):`, names.join(" | "));

async function press(name) {
  const r = await c.queryElements({ application: app, role: "listitem", name, limit: 5 });
  const el = r.elements?.[0];
  if (!el) { console.log(`no listitem "${name}"`); return false; }
  console.log(`press "${name}" actions=${el.actions.map((a) => a.name).join(",")}`);
  const out = await c.activateElement({ id: el.id, action: "Press" });
  console.log(" ->", out.refusal ? JSON.stringify(out.refusal) : "ok");
  await sleep(2500);
  return !out.refusal;
}

const search = (await c.queryElements({ application: app, role: "text", name: "Search", limit: 1 })).elements?.[0];
if (search) {
  const w = await c.typeText({ id: search.id, text: "About" });
  console.log("search ->", w.refusal ? JSON.stringify(w.refusal) : JSON.stringify(w.element?.content));
  await sleep(2500);
  const after = await c.queryElements({ application: app, role: "listitem", limit: 500 });
  console.log("listitems after search:", (after.elements ?? []).map((e) => e.name).join(" | "));
}
const about = (await c.queryElements({ application: app, role: "listitem", limit: 50 })).elements?.find((e) => /about/i.test(e.name));
if (about) await press(about.name);

const all = await c.queryElements({ application: app, limit: 3000 });
const hits = (all.elements ?? []).filter((e) => /ubuntu|operating system|kde plasma/i.test(`${e.name} ${e.content?.value ?? ""}`));
console.log(`elements: ${all.elements?.length}; matches:`);
for (const h of hits) console.log(`  ${h.role} name=${JSON.stringify(h.name)} content=${JSON.stringify(h.content?.value ?? null)}`);
console.log(hits.some((h) => /ubuntu/i.test(`${h.name} ${h.content?.value ?? ""}`)) ? "PROBE: OS NAME REACHABLE" : "PROBE: OS NAME NOT FOUND");
c.close?.();
process.exit(0);
