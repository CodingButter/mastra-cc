import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import type { WakeControl, WakeControlCommand } from "./wake-control.js";

const COOKIE = "wake_session";

function commandFrom(value: unknown): WakeControlCommand {
  if (typeof value !== "object" || value === null) throw new Error("invalid wake control command");
  const command = value as Record<string, unknown>;
  if (!Number.isSafeInteger(command.id) || (command.id as number) <= 0) {
    throw new Error("invalid wake control command id");
  }
  if (command.type === "heartbeat" || command.type === "reset") {
    return { id: command.id as number, type: command.type };
  }
  if (command.type === "capture" && typeof command.takeId === "string") {
    return { id: command.id as number, type: "capture", takeId: command.takeId };
  }
  if (
    command.type === "publish" &&
    Array.isArray(command.takeIds) &&
    command.takeIds.every((takeId) => typeof takeId === "string")
  ) {
    return { id: command.id as number, type: "publish", takeIds: command.takeIds as string[] };
  }
  throw new Error("invalid wake control command");
}

export function createWakeControlApp(control: WakeControl): Hono {
  const app = new Hono();
  app.post("/control/bootstrap", async (context) => {
    try {
      const body: unknown = await context.req.json();
      const nonce =
        typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).nonce === "string"
          ? ((body as Record<string, unknown>).nonce as string)
          : "";
      const { session } = control.redeem(nonce, context.req.header("origin") ?? "");
      setCookie(context, COOKIE, session, {
        httpOnly: true,
        sameSite: "Strict",
        path: "/control",
      });
      return context.body(null, 204);
    } catch {
      return context.json({ error: "unauthorized" }, 401);
    }
  });
  app.post("/control/command", async (context) => {
    try {
      const session = getCookie(context, COOKIE) ?? "";
      const command = commandFrom(await context.req.json());
      const result = await control.command(session, context.req.header("origin") ?? "", command);
      if (command.type === "publish" || command.type === "reset") deleteCookie(context, COOKIE, { path: "/control" });
      return context.json(result);
    } catch {
      return context.json({ error: "unauthorized" }, 401);
    }
  });
  return app;
}

export async function startWakeControlServer(control: WakeControl): Promise<Readonly<{
  port: number;
  close(): Promise<void>;
}>> {
  const app = createWakeControlApp(control);
  return await new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      resolve({
        port: info.port,
        close: async () => await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
    server.once("error", reject);
  });
}
