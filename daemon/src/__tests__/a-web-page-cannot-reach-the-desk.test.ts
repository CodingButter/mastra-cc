import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { registry } from "../backends/registry.js";
import { startWebSocketServer } from "../server.js";

// Audit M6: any website the operator visits can open a WebSocket to a loopback
// port, and the browser labels it with that page's Origin. A browser Origin
// not on the operator's list is refused at the handshake; a client that sends
// no Origin (the transport, a script) is not a web page and connects as before.

let listener: Awaited<ReturnType<typeof startWebSocketServer>> | undefined;
afterEach(() => {
  listener?.close();
  listener = undefined;
});

async function listen(allowedOrigins?: ReadonlySet<string>) {
  listener = await startWebSocketServer({
    port: 0,
    backend: registry.replay({ visibility: "all" }),
    visibility: "all",
    ...(allowedOrigins === undefined ? {} : { allowedOrigins }),
  });
  return listener.port;
}

function handshake(port: number, origin?: string): Promise<"open" | number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, origin === undefined ? {} : { origin });
    socket.on("open", () => {
      socket.close();
      resolve("open");
    });
    socket.on("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
    socket.on("error", () => undefined);
  });
}

describe("the websocket and web pages", () => {
  it("refuses every browser origin when none is allowed", async () => {
    const port = await listen();
    expect(await handshake(port, "https://evil.example")).toBe(401);
    expect(await handshake(port, "http://localhost:3000")).toBe(401);
  });

  it("admits a client that sends no Origin, as before", async () => {
    const port = await listen();
    expect(await handshake(port)).toBe("open");
  });

  it("admits exactly the origins the operator listed", async () => {
    const port = await listen(new Set(["http://localhost:3000"]));
    expect(await handshake(port, "http://localhost:3000")).toBe("open");
    expect(await handshake(port, "http://localhost:3001")).toBe(401);
    expect(await handshake(port, "https://evil.example")).toBe(401);
  });
});
