// Live proof for ADR-0120: a process that names itself "firefox" is not
// Firefox. The daemon is granted "firefox"; the only thing on the bus calling
// itself that is a Python GTK fixture (GLib.set_prgname("firefox")).
//
//   node docs/proofs/grant-identity/demo.mjs <worktree> [--out file]
//
// <worktree> is the checkout whose daemon/dist/main.mjs is exercised; its
// schema digest is read from the generated bindings next to it.
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [tree, ...rest] = process.argv.slice(2);
const out = rest.includes("--out") ? rest[rest.indexOf("--out") + 1] : undefined;
const main = join(tree, "daemon/dist/main.mjs");
const DIGEST = /SCHEMA_DIGEST = "([0-9a-f]{64})"/.exec(readFileSync(join(tree, "packages/protocol-types/src/index.ts"), "utf8"))[1];
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), "grant-identity-"));
const sock = join(dir, "d.sock");
const fixture = spawn("python3", [join(dirname(fileURLToPath(import.meta.url)), "impostor.py")], { stdio: "ignore" });
await sleep(3000);
const daemon = spawn(process.execPath, [main, "--backend", "atspi", "--socket", sock, "--grant", "firefox", "--audit", join(dir, "audit.jsonl")], { stdio: ["ignore", "ignore", "pipe"] });
await sleep(3000);

function client() {
  const s = createConnection(sock);
  let buf = "";
  const waiters = new Map();
  let id = 0;
  s.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (m.type === "response") waiters.get(m.id)?.(m);
    }
  });
  s.write(JSON.stringify({ type: "hello", digest: DIGEST }) + "\n");
  return {
    ask: (method, params) => new Promise((r) => { const n = ++id; waiters.set(n, r); s.write(JSON.stringify({ type: "request", id: n, method, params }) + "\n"); }),
    end: () => s.destroy(),
  };
}

const c = client();
let leaked = false;
try {
  log(`fixture pid ${fixture.pid} runs ${readFileSync(`/proc/${fixture.pid}/cmdline`, "utf8").split("\0")[0]} and publishes the name "firefox"`);
  const all = await c.ask("queryElements", {});
  const names = (all.result?.elements ?? []).map((e) => e.name).filter(Boolean);
  const secret = names.includes("impostor-secret");
  log(`unscoped query: ${all.result?.elements?.length ?? 0} elements${secret ? ", including the field \"impostor-secret\"" : ""}`);
  const scoped = await c.ask("queryElements", { application: "firefox" });
  const r = scoped.result ?? {};
  log(`scoped to "firefox": ${r.refusal ? `refusal ${JSON.stringify(typeof r.refusal === "string" ? r.refusal : { class: r.refusal.class, code: r.refusal.code })}` : `${r.elements?.length ?? 0} elements answered`}`);
  leaked = secret || (r.elements?.length ?? 0) > 0;
  log(leaked ? "VERDICT: RED (the self-named impostor was read as the granted application)" : "VERDICT: GREEN (the impostor is invisible, and the scope is refused as an identity mismatch)");
} finally {
  c.end();
  fixture.kill();
  daemon.kill();
  if (out) writeFileSync(out, lines.join("\n") + "\n");
}
