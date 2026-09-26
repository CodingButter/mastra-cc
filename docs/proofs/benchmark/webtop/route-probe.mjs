// Model-free proof that the daemon's accessibility (AT-SPI) route can drive the
// benchmark's web pages in a visible Chromium inside the Webtop container.
// Every effect is confirmed by state the daemon does not control: the fixture
// server's POST log (read with `docker exec cat`) and the page's own DOM read
// over a separate debugging port the daemon never uses.
// usage: node route-probe.mjs <repo-root>   (container mcc-bench must be up and
// the daemon/fixtures deployed at /opt/mastra-cc/bench, as bench-webtop.mjs does)
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const CONTAINER = "mcc-bench", WS_PORT = 9991, DEPLOY = "/opt/mastra-cc/bench", FX = 8765, VERIFY_PORT = 9745;
const { connect } = await import(createRequire(join(root, "apps/desk-demo/package.json")).resolve("@mastra-cc/desktop"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) => execFileSync("docker", a, { encoding: "utf8", env: { ...process.env, DOCKER_HOST: "unix:///var/run/docker.sock" } });
const session = (cmd) => docker("exec", "-u", "1000", CONTAINER, "bash", "-lc",
  `export DISPLAY=:1 XDG_RUNTIME_DIR=/config/.XDG; export DBUS_SESSION_BUS_ADDRESS=$(tr '\\0' '\\n' </proc/$(pgrep -n plasmashell)/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p'); ${cmd}`);
const bg = (cmd, log) => session(`nohup ${cmd} >${log} 2>&1 </dev/null & echo $!`).trim();
// Never `pkill -f`: the pattern is in this very shell's command line.
const reap = (pat) => session(`pgrep -f ${pat} | grep -vx $$ | xargs -r kill -9; true`);
const kill = (pid) => { try { session(`kill -9 ${pid}`); } catch {} };

// Out-of-daemon reads.
const seen = () => JSON.parse(session("cat /tmp/rp-seen.json"));
const dom = (expr) => JSON.parse(session(`sleep 0.3; /usr/local/bin/node --input-type=module -e '
  const [t] = await (await fetch("http://127.0.0.1:${VERIFY_PORT}/json/list")).json().then(l => l.filter(x => x.type === "page"));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: process.argv[1], returnByValue: true } }));
  ws.onmessage = (m) => { console.log(JSON.stringify(JSON.parse(m.data).result.result.value ?? null)); process.exit(0); };
' ${JSON.stringify(expr).replace(/'/g, "'\\''")}`));

let failures = 0;
const check = (what, ok, observed) => { if (!ok) failures++; console.log(`${ok ? "OK  " : "FAIL"} ${what} - observed ${JSON.stringify(observed)}`); };
const refused = (r) => r?.refusal ? `${r.refusal.class}/${r.refusal.code}: ${r.refusal.message}` : null;

reap("bench-a11y-chrome"); reap("/tmp/rp-");
const fixture = bg(`/usr/local/bin/node ${DEPLOY}/fixture-server.mjs ${DEPLOY}/fixtures /tmp/rp-seen.json ${FX}`, "/tmp/rp-fx.log");
let chrome = null;
async function open(path) {
  reap("bench-a11y-chrome");
  session("rm -rf /tmp/bench-a11y-chrome");
  chrome = bg(`chromium --no-sandbox --no-first-run --force-renderer-accessibility --user-data-dir=/tmp/bench-a11y-chrome --remote-debugging-port=${VERIFY_PORT} http://127.0.0.1:${FX}${path}`, "/tmp/rp-chrome.log");
  await sleep(6000);
}

await open("/form");
const exe = session("readlink -f /proc/$(pgrep -o -f 'chromium/chromium.*bench-a11y-chrome')/exe").trim();
const published = session(`python3 -c "
import gi;gi.require_version('Atspi','2.0');from gi.repository import Atspi
d=Atspi.get_desktop(0);print([d.get_child_at_index(i).get_name() for i in range(d.get_child_count())])"`).trim();
console.log(`chromium executable (/proc/<pid>/exe): ${exe}`);
console.log(`AT-SPI applications: ${published}`);
const grants = { applications: [{ name: "Chromium", executable: exe }] };
session(`echo '${JSON.stringify(grants)}' > /tmp/rp-grants.json`);
console.log(`grant: ${JSON.stringify(grants)} --allow edit --allow activate --allow submit --allow rawInput`);
const daemon = bg(`/usr/local/bin/node ${DEPLOY}/daemon/main.mjs --backend atspi --socket /tmp/rp-d.sock --audit /tmp/rp-audit.jsonl --ws-host 0.0.0.0 --ws-port ${WS_PORT} --grants /tmp/rp-grants.json --allow edit --allow activate --allow submit --allow rawInput`, "/tmp/rp-daemon.log");
await sleep(3000);
const ip = docker("inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", CONTAINER).trim();
const c = await connect({ url: `ws://${ip}:${WS_PORT}` });
const app = "Chromium";

async function find(role, name) {
  for (let i = 0; i < 40; i++) {
    const r = await c.queryElements({ application: app, role, ...(name ? { name } : {}), limit: 50 });
    if (r.elements?.length) return r.elements[0];
    await sleep(500);
  }
  throw new Error(`no ${role} ${JSON.stringify(name)} over the daemon`);
}
async function act(role, name, action) {
  const el = await find(role, name);
  const r = await c.activateElement({ id: el.id, action });
  console.log(`  daemon: ${action} ${role} ${JSON.stringify(name)} (published ${el.actions.map((a) => a.name).join(",")}) -> ${refused(r) ?? "ok"}`);
  await sleep(800);
  return r;
}
async function write(role, name, text) {
  const el = await find(role, name);
  // Chromium's text boxes publish no EditableText interface, so the text goes
  // in through the daemon's typeText (rawInput) - focus, then keystrokes.
  const r = await c.typeText({ id: el.id, text });
  console.log(`  daemon: typeText ${role} ${JSON.stringify(name)} -> ${refused(r) ?? "ok"}`);
  await sleep(500);
}

try {
  console.log("== form");
  await write("textbox", "Full name", "Ada Lovelace");
  check("Full name holds the text", dom(`document.querySelector("[name=name]").value`) === "Ada Lovelace", dom(`document.querySelector("[name=name]").value`));
  await write("textbox", "Email", "ada@example.org");
  check("Email holds the text", dom(`document.querySelector("[name=email]").value`) === "ada@example.org", dom(`document.querySelector("[name=email]").value`));
  // The <select> publishes its options as menu items carrying their own "select" action.
  const opt = await find("menuitem", "Evening");
  const r = await c.activateElement({ id: opt.id, action: "select" });
  console.log(`  daemon: select menuitem "Evening" (published ${opt.actions.map((a) => a.name).join(",")}) -> ${refused(r) ?? "ok"}`);
  await sleep(800);
  check("Shift is Evening", dom(`document.querySelector("[name=shift]").value`) === "Evening", dom(`document.querySelector("[name=shift]").value`));
  await act("checkbox", "I would like a T-shirt", "check");
  check("T-shirt box is checked", dom(`document.querySelector("[name=tshirt]").checked`) === true, dom(`document.querySelector("[name=tshirt]").checked`));
  await act("button", "Sign up", "press");
  await sleep(1500);
  check("server received the sign-up", seen().submit?.name === "Ada Lovelace" && seen().submit?.shift === "Evening" && seen().submit?.tshirt === "yes", seen().submit ?? null);

  console.log("== react todo");
  await open("/todo");
  await write("textbox", "New item", "Milk");
  check("controlled input holds Milk", dom(`document.querySelector("input").value`) === "Milk", dom(`document.querySelector("input").value`));
  await act("button", "Add item", "press");
  check("server received the list", JSON.stringify(seen().state) === JSON.stringify(["Milk"]), seen().state ?? null);

  console.log("== bad page");
  await open("/bad");
  const inputs = (await c.queryElements({ application: app, role: "textbox", limit: 10 })).elements ?? [];
  console.log(`  unlabelled text boxes over the daemon: ${inputs.map((e) => JSON.stringify(e.name)).join(", ")}`);
  // Chromium's own address bar is a text box too; the page's boxes are the others. The
  // input's only name is its placeholder - the page gives it no label.
  const who = inputs.find((e) => e.name === "your name");
  const w = await c.typeText({ id: who.id, text: "Grace" });
  console.log(`  daemon: typeText "your name" text box -> ${refused(w) ?? "ok"}`);
  check("unlabelled input holds Grace", dom(`document.getElementById("who").value`) === "Grace", dom(`document.getElementById("who").value`));
  const clickable = (await c.queryElements({ application: app, limit: 400 })).elements.filter((e) => e.actions.some((a) => a.name === "click"));
  console.log(`  elements publishing click: ${clickable.map((e) => `${e.role} ${JSON.stringify(e.name)}`).join(" | ")}`);
  const texts = (await c.queryElements({ application: app, limit: 400 })).elements.filter((e) => e.actions.some((a) => a.name === "clickAncestor"));
  console.log(`  elements publishing clickAncestor: ${texts.map((e) => `${e.role} ${JSON.stringify(e.name)}`).join(" | ")}`);
  const sendText = texts.find((e) => e.name.includes("Send it"));
  const s = await c.activateElement({ id: sendText.id, action: "clickAncestor" });
  console.log(`  daemon: clickAncestor "Send it" -> ${refused(s) ?? "ok"}`);
  await sleep(1000);
  check("#out says clicked", dom(`document.getElementById("out").textContent`) === "clicked", dom(`document.getElementById("out").textContent`));
  check("server saw the send", seen().state?.sent === true && seen().state?.name === "Grace", seen().state ?? null);
  const subText = texts.find((e) => e.name.includes("Subscribe"));
  if (!subText) console.log(`LIMIT: the roleless "Subscribe" span publishes no action over AT-SPI (no clickAncestor text, not among click sections)`);
  else {
    const t = await c.activateElement({ id: subText.id, action: "clickAncestor" });
    console.log(`  daemon: clickAncestor "Subscribe" -> ${refused(t) ?? "ok"}`);
    await sleep(1000);
    const sub = dom(`document.getElementById("sub").textContent`);
    if (sub.startsWith("☑") && seen().state?.subscribed === true) check("fake checkbox turned on", true, sub);
    else console.log(`LIMIT: clickAncestor on the roleless "Subscribe" span changed nothing (page reads ${JSON.stringify(sub)}, server ${JSON.stringify(seen().state)})`);
  }
} catch (e) {
  failures++;
  console.log(`FAIL ${e.message}`);
} finally {
  c.close?.();
  for (const pid of [daemon, fixture]) kill(pid);
  reap("bench-a11y-chrome");
}
console.log(failures === 0 ? "ROUTE: GREEN" : `ROUTE: RED (${failures} failed)`);
process.exit(failures === 0 ? 0 : 1);
