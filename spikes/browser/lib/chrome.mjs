// Throwaway. Launches Chrome into a disposable profile and finds its endpoint.
//
// Never the operator's profile. Since Chrome 136 --remote-debugging-port is
// ignored unless --user-data-dir points somewhere other than the default, so a
// separate profile is not a choice we are making, it is a constraint.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/opt/google/chrome/chrome';

export function chromePath() {
  if (!existsSync(CHROME)) throw new Error(`chrome not found at ${CHROME}`);
  return CHROME;
}

export async function launchChrome({
  port,
  profileDir,
  extraArgs = [],
  headless = true,
  url = 'about:blank',
} = {}) {
  const dir = profileDir ?? mkdtempSync(join(tmpdir(), 'spike-chrome-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=DialMediaRouteProvider',
    ...(headless ? ['--headless=new'] : []),
    ...extraArgs,
    url,
  ];
  const proc = spawn(chromePath(), args, { stdio: 'ignore', detached: false });

  const endpoint = await waitForEndpoint(port, 15000);
  return {
    proc,
    profileDir: dir,
    endpoint,
    async kill() {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      await new Promise((r) => setTimeout(r, 300));
      if (!profileDir) rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function waitForEndpoint(port, ms) {
  const deadline = Date.now() + ms;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`chrome: no debugging endpoint on ${port} within ${ms}ms (${lastErr})`);
}
