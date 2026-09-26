// Serves the web fixtures inside the Webtop container and writes what the page
// posted to a file, so the harness checks the outcome without going through
// the daemon. usage: node fixture-server.mjs <fixtures-dir> <seen.json> <port>
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const [dir, seenFile, port] = process.argv.slice(2);
const seen = {};
writeFileSync(seenFile, "{}");
createServer((q, s) => {
  let body = "";
  q.on("data", (d) => (body += d));
  q.on("end", () => {
    if (q.method === "POST" && q.url === "/submit") {
      seen.submit = Object.fromEntries(new URLSearchParams(body));
      writeFileSync(seenFile, JSON.stringify(seen));
      s.writeHead(200, { "content-type": "text/html" });
      return s.end("<!doctype html><title>Thanks</title><h1>Thanks, you are signed up.</h1>");
    }
    if (q.method === "POST" && q.url === "/state") {
      seen.state = JSON.parse(body);
      writeFileSync(seenFile, JSON.stringify(seen));
      s.writeHead(204);
      return s.end();
    }
    const file = { "/form": "form.html", "/todo": "todo.html", "/bad": "bad.html", "/dist/todo.js": "dist/todo.js" }[q.url];
    if (!file) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/html" });
    s.end(readFileSync(join(dir, file)));
  });
}).listen(Number(port), "127.0.0.1");
