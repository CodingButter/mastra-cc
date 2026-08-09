#!/usr/bin/env node
// Throwaway. Two questions, one spike:
//
//   1. CAN THE DAEMON TELL, before launching anything, that an installed
//      application is Chromium-based? If it can, "use the browser adapter for
//      this app" is a decision made from the filesystem rather than a hardcoded
//      list of app names that goes stale the moment somebody installs
//      something we never heard of.
//
//   2. Does attaching to an Electron application actually yield a usable tree?
//
// Classification is by filesystem evidence, never by name. An allowlist of
// known Electron apps would answer this question by assuming it.
//
// Usage: node spikes/browser/electron-attach.mjs [--launch NAME]

import { readdirSync, readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { Cdp } from './lib/cdp.mjs';
import { Run } from './lib/result.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const ARTIFACT = arg('out', 'docs/proofs/which-apps-the-browser-adapter-covers.md');
const LAUNCH = arg('launch', 'code');
const PORT = Number(arg('port', '9471'));
const SKIP = arg('skip-observation', undefined);

const run = new Run([
  'apps-inventoried',
  'apps-classified-chromium',
  'classification-evidence',
  'attached-app',
  'ax-nodes-plain',
  'ax-nodes-with-flag',
  'named-controls-plain',
  'named-controls-with-flag',
]);

// --- 1. inventory + classify ------------------------------------------------

const DESKTOP_DIRS = [
  '/usr/share/applications',
  '/var/lib/flatpak/exports/share/applications',
  join(process.env.HOME, '.local/share/applications'),
];

function execFromDesktop(file) {
  const text = readFileSync(file, 'utf8');
  const line = text.split('\n').find((l) => l.startsWith('Exec='));
  if (!line) return null;
  const first = line.slice(5).trim().split(/\s+/)[0];
  return first.replace(/^"|"$/g, '');
}

function resolveBinary(cmd) {
  if (!cmd) return null;
  try {
    const p = cmd.startsWith('/') ? cmd : execFileSync('which', [cmd], { encoding: 'utf8' }).trim();
    return realpathSync(p);
  } catch {
    return null;
  }
}

// A launcher entry does not reliably name a binary. /usr/bin/discord is a shell
// wrapper that exec's "$config_home/$DIR/$app_dir/$EXE", where one of those
// variables is only known at runtime (it is a version-stamped directory). A
// regex that strips the variables produces "/" and silently misclassifies the
// app, which is what the first version of this spike did.
//
// So: resolve the assignments the script makes, expand the environment, and
// glob whatever is left. Anything still unresolved becomes a wildcard rather
// than being deleted.
function unwrap(binPath) {
  try {
    if (readFileSync(binPath).subarray(0, 2).toString() !== '#!') return binPath;
    const text = readFileSync(binPath, 'utf8');
    const target = text.match(/exec\s+"?([^"\s]+)"?/)?.[1];
    if (!target) return binPath;

    const vars = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? '' };
    // NB both alternatives: quoted values land in group 2, unquoted in group 3.
    // Reading only group 2 silently blanks every unquoted assignment, which is
    // most of them, and the expansion then resolves to nonsense.
    for (const [, name, quoted, bare] of text.matchAll(/^\s*(\w+)=(?:"([^"]*)"|(\S+))\s*$/gm)) {
      vars[name] = quoted ?? bare ?? '';
    }
    // resolve nested references a couple of passes deep
    const expand = (s) => s.replace(/\$\{?(\w+)\}?/g, (m, n) => vars[n] ?? m);
    for (let i = 0; i < 3; i++) for (const k of Object.keys(vars)) vars[k] = expand(vars[k] ?? '');

    let path = expand(target).replace(/\/{2,}/g, '/');
    if (existsSync(path)) return realpathSync(path);

    // still has unresolved variables — glob those segments
    const pattern = path.replace(/\$\{?\w+\}?/g, '*');
    if (!pattern.includes('*')) return binPath;
    const hits = globSync(pattern);
    return hits.length ? realpathSync(hits.sort().at(-1)) : binPath;
  } catch {
    return binPath;
  }
}

function globSync(pattern) {
  const parts = pattern.split('/').filter(Boolean);
  let candidates = ['/'];
  for (const part of parts) {
    const next = [];
    for (const base of candidates) {
      if (!part.includes('*')) {
        const p = join(base, part);
        if (existsSync(p)) next.push(p);
        continue;
      }
      const re = new RegExp(`^${part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
      try {
        for (const entry of readdirSync(base)) if (re.test(entry)) next.push(join(base, entry));
      } catch {
        /* unreadable directory */
      }
    }
    candidates = next;
    if (!candidates.length) return [];
  }
  return candidates;
}

// Filesystem evidence that a binary is Chromium-based. Each marker is a real
// artifact of a Chromium/Electron distribution, not a guess from the name.
const MARKERS = [
  'resources/app.asar',
  'resources.pak',
  'chrome_100_percent.pak',
  'icudtl.dat',
  'libffmpeg.so',
  'v8_context_snapshot.bin',
  'snapshot_blob.bin',
];

function classify(binPath) {
  const dir = dirname(binPath);
  const found = MARKERS.filter((m) => existsSync(join(dir, m)));
  if (found.length >= 2) return { chromium: true, why: `${found.length} markers: ${found.slice(0, 3).join(', ')}` };
  // last resort: the binary itself advertises a Chrome version string
  try {
    const st = statSync(binPath);
    if (st.isFile() && st.size < 400_000_000) {
      const out = execFileSync('grep', ['-a', '-m1', '-o', 'Chrome/[0-9]\\+\\.[0-9]', binPath], {
        encoding: 'utf8',
        maxBuffer: 1 << 20,
      }).trim();
      if (out) return { chromium: true, why: `embedded version string ${out}` };
    }
  } catch {
    /* not found is the normal case */
  }
  return { chromium: false, why: found.length ? `only ${found.join(', ')}` : 'no markers' };
}

const seen = new Map();
for (const dir of DESKTOP_DIRS) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.desktop')) continue;
    const bin = unwrap(resolveBinary(execFromDesktop(join(dir, f))) ?? '');
    if (!bin || !existsSync(bin) || seen.has(bin)) continue;
    seen.set(bin, { app: f.replace(/\.desktop$/, ''), ...classify(bin) });
  }
}

const all = [...seen.entries()].map(([bin, v]) => ({ bin, ...v }));
const chromium = all.filter((a) => a.chromium);
if (all.length === 0) {
  process.stderr.write('REFUSED: inventoried no applications at all\n');
  process.exit(1);
}
if (SKIP !== 'apps-inventoried') run.record('apps-inventoried', all.length);
if (SKIP !== 'apps-classified-chromium') run.record('apps-classified-chromium', chromium.length);
if (SKIP !== 'classification-evidence') {
  run.record(
    'classification-evidence',
    chromium
      .slice(0, 12)
      .map((a) => `| \`${a.app}\` | \`${a.bin}\` | ${a.why} |`)
      .join('\n'),
  );
}

// --- 2. attach to one of them ----------------------------------------------

const pick = chromium.find((a) => a.app === LAUNCH) ?? chromium.find((a) => a.bin.includes(LAUNCH));
if (!pick) {
  process.stderr.write(`REFUSED: "${LAUNCH}" was not classified as Chromium-based; nothing to attach to\n`);
  process.exit(1);
}

// Attaching is not the same as being readable. The first version of this spike
// attached to VS Code, got a 3-node tree, and wrote that down as a success —
// which is the same empty-tree signature Chrome shows when its renderer
// accessibility is off. So the app is measured under BOTH conditions and the
// comparison is the result.
async function measure(port, extraArgs, label) {
  const dataDir = `/tmp/spike-electron-${label}-${Date.now()}`;
  const proc = spawn(pick.bin, [`--remote-debugging-port=${port}`, `--user-data-dir=${dataDir}`, ...extraArgs], {
    stdio: 'ignore',
    detached: true,
  });
  try {
    let endpoint = null;
    for (let i = 0; i < 60 && !endpoint; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) endpoint = await res.json();
      } catch {
        /* not up yet */
      }
    }
    if (!endpoint) throw new Error(`${pick.app} exposed no debugging endpoint within 30s (${label})`);

    // Wait for the window to actually render — an app still painting its first
    // frame has a small tree for reasons that have nothing to do with the flag.
    let page = null;
    let cdp = null;
    let nodes = [];
    for (let i = 0; i < 40; i++) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === 'page');
      if (page) {
        cdp?.close();
        cdp = await Cdp.connect(page.webSocketDebuggerUrl);
        await cdp.send('Accessibility.enable');
        ({ nodes } = await cdp.send('Accessibility.getFullAXTree'));
        if (nodes.length > 20) break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!page) throw new Error(`attached, but ${pick.app} exposed no page target (${label})`);

    const named = nodes.filter(
      (n) => n.name?.value && ['button', 'link', 'textbox', 'tab', 'menuitem'].includes(n.role?.value),
    );
    cdp?.close();
    return { endpoint, nodes: nodes.length, named };
  } finally {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const plain = await measure(PORT, [], 'plain');
const flagged = await measure(PORT + 1, ['--force-renderer-accessibility'], 'flagged');

if (SKIP !== 'attached-app') run.record('attached-app', `${pick.app} — ${plain.endpoint.Browser}`);
if (SKIP !== 'ax-nodes-plain') run.record('ax-nodes-plain', plain.nodes);
if (SKIP !== 'ax-nodes-with-flag') run.record('ax-nodes-with-flag', flagged.nodes);
const describe = (m) =>
  m.named.length
    ? `${m.named.length} (e.g. ${m.named.slice(0, 3).map((n) => `${n.role.value} "${n.name.value.slice(0, 22)}"`).join('; ')})`
    : '0';
if (SKIP !== 'named-controls-plain') run.record('named-controls-plain', describe(plain));
if (SKIP !== 'named-controls-with-flag') run.record('named-controls-with-flag', describe(flagged));

process.exit(
  run.finish(ARTIFACT, (obs) => `# Which apps the browser adapter covers

Produced by \`spikes/browser/electron-attach.mjs\`, which is deleted at the end
of M0.5.

The browser adapter is only worth building if the daemon can work out *by
itself* which applications it applies to. A hardcoded list of known Electron
apps would answer the question by assuming it, and would be wrong the first
time somebody installs something we never heard of.

## Classification

Applications are classified from **filesystem evidence next to the binary** —
the artifacts a Chromium distribution leaves behind — never from their name.
Launcher entries whose \`Exec\` is a shell wrapper are followed to the binary
they exec, because the evidence sits beside the real one.

| Measured | |
|---|---|
| Applications inventoried from launcher entries | ${obs['apps-inventoried']} |
| Classified Chromium-based | **${obs['apps-classified-chromium']}** |

| Application | Binary | Evidence |
|---|---|---|
${obs['classification-evidence']}

## Attaching is not the same as being readable

The app is launched twice: once plainly, and once with
\`--force-renderer-accessibility\`. Attaching succeeds either way, so attach
success is not evidence of a usable tree.

| Observation | Plain launch | With \`--force-renderer-accessibility\` |
|---|---|---|
| Attached | \`${obs['attached-app']}\` | same binary |
| Accessibility nodes | **${obs['ax-nodes-plain']}** | **${obs['ax-nodes-with-flag']}** |
| Named controls | **${obs['named-controls-plain']}** | **${obs['named-controls-with-flag']}** |

An earlier version of this spike measured only the plain launch, got a
three-node tree, and recorded it as a successful attach. Three nodes is the
same signature an unreadable Chrome shows, and calling that a success is
precisely the vacuous pass this repository treats as worse than no measurement.
The run now waits for the window to render before reading, so a small tree
means an empty tree rather than a slow one.

## What this settles

The adapter's applicability is **derived, not declared**. That matters beyond
tidiness: it is the difference between an adapter that covers the applications
a person actually has and one that covers the applications we happened to think
of. The same evidence tells the daemon how to launch the app — a Chromium-based
binary takes a debugging port and its own data directory, and everything else
goes to the platform's accessibility adapter.

## Receipt

\`\`\`
node spikes/browser/electron-attach.mjs --launch ${LAUNCH} --port ${PORT}
\`\`\`
`),
);
