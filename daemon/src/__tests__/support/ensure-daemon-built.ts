import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const sleep = (milliseconds: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

export function ensureDaemonBuilt(root: string): void {
  const key = Buffer.from(root).toString("hex").slice(-24);
  const lock = join("/tmp", `mastra-cc-test-build-${process.ppid}-${key}.lock`);
  const ready = join("/tmp", `mastra-cc-test-build-${process.ppid}-${key}.ready`);
  while (true) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (existsSync(ready)) return;
      sleep(25);
    }
  }
  try {
    if (existsSync(ready)) return;
    const built = spawnSync("pnpm", ["--filter", "@mastra-cc/daemon", "build"], { cwd: root, encoding: "utf8" });
    if (built.status !== 0) throw new Error(built.stderr || built.stdout || "daemon build failed");
    writeFileSync(ready, "ready\n");
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
