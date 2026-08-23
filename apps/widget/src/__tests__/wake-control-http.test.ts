import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTemplateStore } from "@mastra-cc/voice/node";

import { createWakeControl } from "../wake-control.js";
import { createWakeControlApp } from "../wake-control-server.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "wake-http-"));
  dirs.push(dir);
  const origin = "http://127.0.0.1:4173";
  const control = createWakeControl({
    origin,
    nonce: "b".repeat(64),
    templates: createTemplateStore(join(dir, "templates.json")),
    capture: async () => Buffer.from([1, 0, 2, 0]),
  });
  return { app: createWakeControlApp(control), origin };
}

async function redeem(app: ReturnType<typeof createWakeControlApp>, origin: string) {
  const response = await app.request("/control/bootstrap", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ nonce: "b".repeat(64) }),
  });
  return { response, cookie: response.headers.get("set-cookie") ?? "" };
}

describe("the loopback HTTP control boundary", () => {
  it("issues one narrow HttpOnly SameSite Strict host-only cookie", async () => {
    const { app, origin } = fixture();
    const { response, cookie } = await redeem(app, origin);

    expect(response.status).toBe(204);
    expect(cookie).toContain("wake_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/control");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain("Secure");
  });

  it("refuses racing second redemption, wrong origin, missing session, and replay", async () => {
    const { app, origin } = fixture();
    const { cookie } = await redeem(app, origin);
    const second = await redeem(app, origin);
    expect(second.response.status).toBe(401);

    const wrongOrigin = await app.request("/control/command", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:9999", cookie, "content-type": "application/json" },
      body: JSON.stringify({ id: 1, type: "heartbeat" }),
    });
    expect(wrongOrigin.status).toBe(401);

    const missing = await app.request("/control/command", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ id: 1, type: "heartbeat" }),
    });
    expect(missing.status).toBe(401);

    const first = await app.request("/control/command", {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ id: 1, type: "heartbeat" }),
    });
    expect(first.status).toBe(200);
    const replay = await app.request("/control/command", {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ id: 1, type: "heartbeat" }),
    });
    expect(replay.status).toBe(401);
  });
});
