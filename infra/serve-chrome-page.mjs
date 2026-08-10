// Serves daemon/fixtures/chrome-page/ over HTTP on PAGE_PORT so the browser
// loads the fixture page from a URL. A file:// URL would put /home/<user>
// into every target list the capture records - a filesystem path must never
// enter a tape or a transcript.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_PORT = 9745; // must agree with DEBUG_PORT/PAGE_PORT in daemon/src/backends/cdp/channel.ts
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "daemon", "fixtures", "chrome-page");

const server = createServer(async (request, response) => {
  const name = normalize(new URL(request.url ?? "/", "http://localhost").pathname).replaceAll("..", "");
  try {
    const body = await readFile(join(root, name === "/" ? "page.html" : name));
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
});

server.listen(PAGE_PORT, "127.0.0.1", () => {
  console.log(`serving chrome-page fixture on http://127.0.0.1:${PAGE_PORT}/page.html`);
});
