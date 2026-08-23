import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTemplateStore } from "@mastra-cc/voice/node";

import { createWakeControl } from "./wake-control.js";
import { startWakeControlServer } from "./wake-control-server.js";

const origin = "http://127.0.0.1:4173";
const nonce = "proof-bootstrap-nonce-not-logged";
const dir = mkdtempSync(join(tmpdir(), "wake-control-proof-"));
let now = 1_000;
let cancelled = false;
const control = createWakeControl({
  origin,
  nonce,
  now: () => now,
  templates: createTemplateStore(join(dir, "templates.json")),
  capture: async (signal) =>
    await new Promise<Buffer>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        cancelled = true;
        reject(new Error("capture cancelled"));
      });
    }),
});
const server = await startWakeControlServer(control);
const endpoint = `http://127.0.0.1:${server.port}`;

function assertion(ok: boolean, label: string): void {
  if (!ok) throw new Error(`CONTROL PROOF: missing assertion: ${label}`);
  console.log(`ok - ${label}`);
}

try {
  console.log(`CONTROL PID: ${process.pid}`);
  console.log(`CONTROL BIND: 127.0.0.1:${server.port}`);
  const redeem = await fetch(`${endpoint}/control/bootstrap`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ nonce }),
  });
  const cookie = redeem.headers.get("set-cookie") ?? "";
  assertion(redeem.status === 204 && cookie.includes("HttpOnly"), "one bootstrap redemption issued a protected cookie");

  const second = await fetch(`${endpoint}/control/bootstrap`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ nonce }),
  });
  assertion(second.status === 401, "second bootstrap redemption rejected");

  const missing = await fetch(`${endpoint}/control/command`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ id: 1, type: "heartbeat" }),
  });
  assertion(missing.status === 401, "missing session rejected");

  const wrongOrigin = await fetch(`${endpoint}/control/command`, {
    method: "POST",
    headers: { origin: "http://127.0.0.1:9999", cookie, "content-type": "application/json" },
    body: JSON.stringify({ id: 1, type: "heartbeat" }),
  });
  assertion(wrongOrigin.status === 401, "wrong origin rejected");

  const heartbeat = await fetch(`${endpoint}/control/command`, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({ id: 1, type: "heartbeat" }),
  });
  assertion(heartbeat.status === 200, "ordered command accepted");
  const replay = await fetch(`${endpoint}/control/command`, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({ id: 1, type: "heartbeat" }),
  });
  assertion(replay.status === 401, "replayed command rejected");

  const activeTake = fetch(`${endpoint}/control/command`, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({ id: 2, type: "capture", takeId: "proof-take" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  now += 6_000;
  control.sweep();
  const expiredTake = await activeTake;
  assertion(expiredTake.status === 401 && cancelled, "three missed heartbeats cancelled and discarded the active take");
  assertion(control.snapshot().takes.length === 0, "expired take left no audio or fingerprint state");

  const afterExpiry = await fetch(`${endpoint}/control/command`, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: JSON.stringify({ id: 3, type: "heartbeat" }),
  });
  assertion(afterExpiry.status === 401, "post-expiry command rejected");
  console.log("CONTROL PROOF: GREEN");
} finally {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}
