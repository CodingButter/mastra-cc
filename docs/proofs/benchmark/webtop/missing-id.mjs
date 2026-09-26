// Model-free proof: a request that names its element under the wrong key is
// the caller's mistake. Deploys <repo-root>'s built daemon into the Webtop
// container, starts it over AT-SPI with KDE System Settings granted, and sends
// clickElement with `element` instead of `id`.
// Usage: node missing-id.mjs <repo-root>
//   on 235d043 (base):   world/UnperformableElementError - blamed on the desk
//   on this branch:      agent/MalformedParameter         - blamed on the caller
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const CONTAINER = "mcc-bench", WS_PORT = 9992, DEPLOY = "/opt/mastra-cc/missing-id";
// The client is this checkout's; only the daemon under test comes from <repo-root>.
const here = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const { connect } = await import(createRequire(join(here, "apps/desk-demo/package.json")).resolve("@mastra-cc/desktop"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) => execFileSync("docker", a, { encoding: "utf8", env: { ...process.env, DOCKER_HOST: "unix:///var/run/docker.sock" } });
const session = (cmd) => docker("exec", "-u", "1000", CONTAINER, "bash", "-lc",
  `export DISPLAY=:1 XDG_RUNTIME_DIR=/config/.XDG; export DBUS_SESSION_BUS_ADDRESS=$(tr '\\0' '\\n' </proc/$(pgrep -n plasmashell)/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p'); ${cmd}`);

console.log(`repo: ${root} @ ${execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()}`);
docker("exec", CONTAINER, "bash", "-c", `rm -rf ${DEPLOY} && mkdir -p ${DEPLOY}/daemon && chown -R 1000 ${DEPLOY}`);
docker("cp", join(root, "daemon/dist") + "/.", `${CONTAINER}:${DEPLOY}/daemon`);
docker("cp", join(root, "daemon/node_modules") + "/.", `${CONTAINER}:${DEPLOY}/daemon/node_modules`);

const daemonPid = session(`nohup /usr/local/bin/node ${DEPLOY}/daemon/main.mjs --backend atspi --socket /tmp/mi-d.sock --audit /tmp/mi-audit.jsonl --ws-host 0.0.0.0 --ws-port ${WS_PORT} --grant systemsettings --allow rawInput >/tmp/mi-daemon.log 2>&1 </dev/null & echo $!`).trim();
try {
  await sleep(3000);
  const ip = docker("inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", CONTAINER).trim();
  const c = await connect({ url: `ws://${ip}:${WS_PORT}` });
  const params = { element: "el-000000000001" };
  console.log(`request: clickElement ${JSON.stringify(params)}  (no "id")`);
  const r = await c.clickElement(params);
  const refusal = r.refusal;
  console.log(`refusal: ${refusal ? `${refusal.class}/${refusal.code}` : "none"}`);
  if (refusal) console.log(`message: ${refusal.message}`);
  console.log(refusal?.class === "agent" && refusal.code === "MalformedParameter" ? "MISSING-ID: CALLER'S MISTAKE" : "MISSING-ID: BLAMED ON SOMEONE ELSE");
  c.close?.();
} finally {
  session(`kill -9 ${daemonPid} 2>/dev/null; true`);
}
process.exit(0);
