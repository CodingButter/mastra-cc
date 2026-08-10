// One measurement run: <mode> <n> connections against the live accessibility
// bus, through the daemon's exported probe primitive (the D-Bus binding stays
// inside daemon/ - B1). Prints one JSON line on success and exits 0; any
// failure exits non-zero (or dies of its signal), which the parent records as
// the run's result. This process is deliberately disposable: if concurrency
// aborts it, the parent survives to write that down.
//
// Modes (the separation 07-ROADMAP.md:80 demands):
//   sequential       - open and read through each connection one at a time
//   concurrent-setup - open all n connections at once, then read each in turn
//   concurrent-use   - open and read each sequentially FIRST, then read all
//                      n concurrently; a failure here is concurrent use, not
//                      setup, because every connection already proved itself
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const daemonDist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "daemon", "dist", "index.mjs");
const { openA11yConnection, bindingIdentity } = await import(daemonDist);

const [mode, nArg] = process.argv.slice(2);
const n = Number(nArg);
if (!["sequential", "concurrent-setup", "concurrent-use"].includes(mode) || !Number.isInteger(n) || n < 1) {
  console.error(`worker: usage: concurrent-worker.mjs <sequential|concurrent-setup|concurrent-use> <n>`);
  process.exit(2);
}

const started = performance.now();
const apps = [];
let connections = [];

if (mode === "sequential") {
  for (let i = 0; i < n; i += 1) {
    const conn = await openA11yConnection();
    connections.push(conn);
    apps.push(await conn.readApplications());
  }
} else if (mode === "concurrent-setup") {
  connections = await Promise.all(Array.from({ length: n }, () => openA11yConnection()));
  for (const conn of connections) apps.push(await conn.readApplications());
} else {
  for (let i = 0; i < n; i += 1) {
    const conn = await openA11yConnection();
    connections.push(conn);
    await conn.readApplications();
  }
  apps.push(...(await Promise.all(connections.map((conn) => conn.readApplications()))));
}

const ms = performance.now() - started;
await Promise.all(connections.map((conn) => conn.close()));
console.log(JSON.stringify({ mode, n, apps, ms: Math.round(ms * 10) / 10, binding: bindingIdentity() }));
process.exit(0);
