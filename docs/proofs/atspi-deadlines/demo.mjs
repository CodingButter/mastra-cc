// Live proof for ADR-0117: a frozen application is refused within the AT-SPI
// call deadline instead of the bus's own 25s NoReply.
//
//   node docs/proofs/atspi-deadlines/demo.mjs <daemon/dist/main.mjs> [--out file]
//
// Launches Mousepad, starts the daemon with it granted, answers one query while
// Mousepad is alive, SIGSTOPs it, times a second query, then SIGCONTs and cleans up.
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [main, ...rest] = process.argv.slice(2);
const out = rest[rest.indexOf("--out") + 1];
const DIGEST = "ee9919e49bd6190f8531174f29f6d92b3831d3a4063b7d957ea1cf41246f38e3";
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), "atspi-dl-"));
const sock = join(dir, "d.sock");
const app = spawn("mousepad", ["--disable-server"], { stdio: "ignore" });
await sleep(3000);
const daemon = spawn(process.execPath, [main, "--backend", "atspi", "--socket", sock, "--grant", "mousepad", "--audit", join(dir, "audit.jsonl")], { stdio: ["ignore", "ignore", "pipe"] });
await sleep(3000);

function client() {
  const s = createConnection(sock);
  let buf = "", waiters = new Map(), id = 0;
  s.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (m.type === "response") waiters.get(m.id)?.(m);
    }
  });
  s.write(JSON.stringify({ type: "hello", digest: DIGEST }) + "\n");
  return {
    ask: (method, params) => new Promise((r) => { const n = ++id; waiters.set(n, r); s.write(JSON.stringify({ type: "request", id: n, method, params }) + "\n"); }),
    end: () => s.destroy(),
  };
}

async function timed(c, label) {
  const t0 = Date.now();
  const r = await Promise.race([c.ask("queryElements", { application: "mousepad", role: "text" }), sleep(40_000).then(() => "PENDING")]);
  const ms = Date.now() - t0;
  const summary = r === "PENDING" ? "still pending" : r.error ? `error: ${r.error.message ?? JSON.stringify(r.error)}` : r.result?.refusal ? `refusal: ${JSON.stringify(r.result.refusal)}` : `answered ${r.result?.elements?.length ?? "?"} elements`;
  log(`${label}: ${ms} ms, ${summary}`);
  return { ms, r };
}

const c = client();
try {
  await timed(c, "alive");
  process.kill(app.pid, "SIGSTOP");
  log(`SIGSTOP mousepad pid ${app.pid}`);
  const { ms } = await timed(c, "frozen");
  log(ms < 12_000 ? `VERDICT: GREEN (refused within the 10s deadline)` : `VERDICT: RED (waited ${ms} ms)`);
} finally {
  c.end();
  try { process.kill(app.pid, "SIGCONT"); } catch {}
  app.kill(); daemon.kill();
  if (out) writeFileSync(out, lines.join("\n") + "\n");
}
