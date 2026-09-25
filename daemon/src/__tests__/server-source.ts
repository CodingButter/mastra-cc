import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// The server's source as one text: the hub plus the modules it re-exports
// (ADR-0122). Static checks that read "the server" read all of it.
const src = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export function serverSource(): string {
  const parts = readdirSync(join(src, "server")).filter((f) => f.endsWith(".ts")).sort();
  return [readFileSync(join(src, "server.ts"), "utf8"), ...parts.map((f) => readFileSync(join(src, "server", f), "utf8"))].join("\n");
}
