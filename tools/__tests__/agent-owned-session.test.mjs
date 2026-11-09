import { chmod, copyFile, mkdtemp, readFile, readlink, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const names = ["kate", "dolphin", "konsole", "chromium"];
const waitFor = async (predicate, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for test process state");
};
const run = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, args, options);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", chunk => { stdout += chunk; });
  child.stderr?.on("data", chunk => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", status => resolve({ status, stdout, stderr }));
});

async function exactPids(name) {
  const result = spawnSync("pgrep", ["-x", name], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split(/\s+/).filter(Boolean).map(Number) : [];
}

async function killExactNames() {
  for (const name of names) spawnSync("pkill", ["-KILL", "-x", name]);
}

describe("the shared agent-owned desktop session", () => {
  it("uses the one exact-name cleanup and launch contract from webtop", async () => {
    const [session, start] = await Promise.all([
      readFile(join(root, "infra/agent-owned-session.sh"), "utf8"),
      readFile(join(root, "infra/webtop/start.sh"), "utf8"),
    ]);
    expect(session).toContain("for name in kate dolphin konsole chromium; do pkill -TERM -x \"$name\" || true; done");
    expect(session).toContain("deadline=$((SECONDS + 5))");
    expect(session).toContain("pgrep -x \"$name\" >/dev/null && pkill -KILL -x \"$name\" || true");
    expect(session).toContain("agent-owned-session: %s is still running after TERM and KILL");
    expect(session).toContain("setsid nohup \"$NODE\" \"$DAEMON_MAIN\"");
    expect(session).toContain("open-main-apps.mjs");
    expect(start).toContain("agent-owned-session.sh");
    expect(start).not.toMatch(/pkill\s+-(?:TERM|KILL)|openApplication/);
  });

  it("removes four orphan processes and relaunches only daemon-owned replacements", async () => {
    if (process.platform !== "linux") return;
    const dir = await mkdtemp(join(tmpdir(), "mastra-cc-agent-session-"));
    const socket = join(dir, "daemon.sock");
    const ownership = join(dir, "ownership.json");
    const fakeDaemon = join(dir, "fake-daemon.mjs");
    const old = [];
    try {
      for (const name of names) {
        const executable = join(dir, name);
        await copyFile("/usr/bin/sleep", executable);
        await chmod(executable, 0o755);
        old.push(spawn(executable, ["30"], { stdio: "ignore" }));
      }
      await waitFor(async () => (await Promise.all(names.map(exactPids))).every(pids => pids.length > 0));
      const oldPids = new Set(old.map(child => child.pid));
      await writeFile(fakeDaemon, `
import net from "node:net";
import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
const names = ${JSON.stringify(names)};
const socket = process.argv[process.argv.indexOf("--socket") + 1];
const ownership = process.env.MASTRA_CC_TEST_OWNERSHIP;
const owned = [];
rmSync(socket, { force: true });
const server = net.createServer(connection => {
  let buffer = "";
  connection.on("data", chunk => {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf("\\n");
      if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.type === "hello") connection.write(JSON.stringify({ type: "hello", digest: message.digest, version: "1.30.0" }) + "\\n");
      if (message.type === "request") {
        const name = message.params.name;
        if (!names.includes(name)) throw new Error("unexpected app " + name);
        const child = spawn(process.env.MASTRA_CC_TEST_BIN + "/" + name, ["30"], { detached: false, stdio: "ignore" });
        owned.push({ name, pid: child.pid });
        writeFileSync(ownership, JSON.stringify(owned));
        connection.write(JSON.stringify({ type: "response", id: message.id, result: { application: { id: "app-" + name, role: "application", name, application: name, actions: [], capabilities: [] } } }) + "\\n");
      }
    }
  });
});
server.listen(socket);
`, "utf8");
      const result = await run("bash", [join(root, "infra/agent-owned-session.sh")], {
        cwd: root,
        env: {
          ...process.env,
          MASTRA_CC_SOCKET: socket,
          MASTRA_CC_DAEMON_MAIN: fakeDaemon,
          MASTRA_CC_TEST_BIN: dir,
          MASTRA_CC_TEST_OWNERSHIP: ownership,
          MASTRA_CC_AUDIT: join(dir, "audit.jsonl"),
        },
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const owned = JSON.parse(await readFile(ownership, "utf8"));
      expect(owned.map(entry => entry.name)).toEqual(names);
      expect(owned.every(entry => !oldPids.has(entry.pid))).toBe(true);
      for (const { name, pid } of owned) expect(await exactPids(name)).toContain(pid);
      for (const pid of oldPids) expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      await killExactNames();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("detaches the daemon without retaining the caller's boot lock", async () => {
    if (process.platform !== "linux") return;
    const dir = await mkdtemp(join(tmpdir(), "mastra-cc-agent-detach-"));
    const socket = join(dir, "daemon.sock");
    const lock = join(dir, "boot.lock");
    const pidFile = join(dir, "daemon.pid");
    const fakeDaemon = join(dir, "fake-daemon.mjs");
    try {
      await writeFile(fakeDaemon, `
import net from "node:net";
import { rmSync } from "node:fs";
const socket = process.argv[process.argv.indexOf("--socket") + 1];
rmSync(socket, { force: true });
const server = net.createServer(connection => {
  let buffer = "";
  connection.on("data", chunk => {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf("\\n");
      if (end < 0) break;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.type === "hello") connection.write(JSON.stringify({ type: "hello", digest: message.digest, version: "1.30.0" }) + "\\n");
      if (message.type === "request") connection.write(JSON.stringify({ type: "response", id: message.id, result: { application: { id: "app-" + message.params.name, role: "application", name: message.params.name } } }) + "\\n");
    }
  });
});
server.listen(socket);
`, "utf8");
      const result = spawnSync("bash", ["-lc", `exec 9>${JSON.stringify(lock)}; flock 9; ${JSON.stringify(join(root, "infra/agent-owned-session.sh"))} 9>&-`], {
        cwd: root,
        encoding: "utf8",
        timeout: 20_000,
        env: {
          ...process.env,
          MASTRA_CC_SOCKET: socket,
          MASTRA_CC_DAEMON_MAIN: fakeDaemon,
          MASTRA_CC_AUDIT: join(dir, "audit.jsonl"),
          MASTRA_CC_DAEMON_LOG: join(dir, "daemon.log"),
          MASTRA_CC_DAEMON_PID_FILE: pidFile,
        },
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const daemonPid = Number((await readFile(pidFile, "utf8")).trim());
      expect(spawnSync("flock", ["-w", "3", lock, "true"]).status).toBe(0);
      const descriptors = await readdir(`/proc/${daemonPid}/fd`);
      const targets = await Promise.all(descriptors.map(async descriptor => readlink(`/proc/${daemonPid}/fd/${descriptor}`).catch(() => "")));
      expect(targets).not.toContain(lock);
      expect(spawnSync("ps", ["-o", "sid=", "-p", String(daemonPid)], { encoding: "utf8" }).stdout.trim()).toBe(String(daemonPid));
      process.kill(daemonPid, "SIGTERM");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("fails explicitly when an application survives TERM and KILL", async () => {
    if (process.platform !== "linux") return;
    const dir = await mkdtemp(join(tmpdir(), "mastra-cc-agent-survivor-"));
    try {
      await writeFile(join(dir, "pgrep"), "#!/bin/sh\nexit 0\n", "utf8");
      await writeFile(join(dir, "pkill"), "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(join(dir, "pgrep"), 0o755);
      await chmod(join(dir, "pkill"), 0o755);
      const result = spawnSync("bash", [join(root, "infra/agent-owned-session.sh")], {
        cwd: root,
        encoding: "utf8",
        timeout: 15_000,
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, MASTRA_CC_NODE: "/bin/false" },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/kate.*still running/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
