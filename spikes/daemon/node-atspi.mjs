#!/usr/bin/env node
// Throwaway. Q07: can Node reach the Linux accessibility layer at all?
//
// This is the question the daemon's language rests on. If Node can enumerate
// applications, walk a tree, and read a role and a name, the daemon is one
// process in one language. If it cannot, it is Node plus a Python sidecar and a
// seam between them for the life of the project.
//
// AT-SPI is D-Bus underneath — libatspi is a convenience wrapper over a bus
// protocol, not a private channel. So the test is whether a plain D-Bus client
// can speak that protocol directly, with no GObject introspection and no
// native compilation.
//
// The comparison is against Python's Atspi bindings reading the same desktop at
// the same moment, because "Node found some nodes" means nothing without
// knowing what was there to find.
//
// Usage: node spikes/daemon/node-atspi.mjs [--app NAME]

import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Run } from '../browser/lib/result.mjs';

const require = createRequire('/tmp/dbus-probe/');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const ARTIFACT = arg('out', 'docs/proofs/can-node-read-the-accessibility-tree.md');
const SKIP = arg('skip-observation', undefined);

const run = new Run([
  'bus-address-found',
  'apps-node',
  'apps-python',
  'nodes-node',
  'nodes-python',
  'roles-readable',
  'names-readable',
  'states-readable',
  'sample',
]);

const AT = 'org.a11y.atspi.Accessible';
const PROPS = 'org.freedesktop.DBus.Properties';

const dbus = require('dbus-native');

// The accessibility bus is not the session bus. Its address is published on the
// session bus by the a11y bus launcher, so the first job is to ask for it.
const sessionBus = dbus.sessionBus();
const call = (bus, dest, path, iface, member, signature, body) =>
  new Promise((resolve, reject) => {
    bus.invoke(
      { destination: dest, path, interface: iface, member, signature, body },
      (err, ...res) => (err ? reject(err) : resolve(res.length > 1 ? res : res[0])),
    );
  });

let address;
try {
  address = await call(
    sessionBus,
    'org.a11y.Bus',
    '/org/a11y/bus',
    'org.a11y.Bus',
    'GetAddress',
    '',
    [],
  );
} catch (e) {
  process.stderr.write(`REFUSED: could not get the accessibility bus address: ${e.message}\n`);
  process.exit(1);
}
if (SKIP !== 'bus-address-found') run.record('bus-address-found', Boolean(address));

const a11y = dbus.createClient({ busAddress: address });

// Every accessible object is (bus name, object path). The desktop root is a
// well-known pair.
const getProp = async (dest, path, prop) => {
  const v = await call(a11y, dest, path, PROPS, 'Get', 'ss', [AT, prop]);
  return Array.isArray(v) ? v[1]?.[0] : v;
};
const getChildren = async (dest, path) =>
  await call(a11y, dest, path, AT, 'GetChildren', '', []);

const ROOT = ['org.a11y.atspi.Registry', '/org/a11y/atspi/accessible/root'];

let apps;
try {
  apps = await getChildren(ROOT[0], ROOT[1]);
} catch (e) {
  process.stderr.write(`REFUSED: could not enumerate applications: ${e.message}\n`);
  process.exit(1);
}
if (apps.length === 0) {
  process.stderr.write('REFUSED: the accessibility desktop reported zero applications\n');
  process.exit(1);
}
if (SKIP !== 'apps-node') run.record('apps-node', apps.length);

// Walk, bounded, reading the three things a daemon actually needs: role, name,
// and states. Reading a child count is not evidence that the tree is legible.
let nodes = 0;
let roles = 0;
let names = 0;
let states = 0;
let sample = null;
const seen = new Set();

const walk = async (dest, path, depth) => {
  if (nodes >= 400 || depth > 12) return;
  const key = `${dest}${path}`;
  if (seen.has(key)) return;
  seen.add(key);
  nodes++;

  let role = null;
  let name = null;
  try {
    role = await call(a11y, dest, path, AT, 'GetRoleName', '', []);
    if (typeof role === 'string' && role.length) roles++;
  } catch {}
  try {
    name = await getProp(dest, path, 'Name');
    if (typeof name === 'string' && name.length) names++;
  } catch {}
  try {
    const st = await call(a11y, dest, path, AT, 'GetState', '', []);
    if (Array.isArray(st)) states++;
  } catch {}

  if (!sample && role && name) sample = { role, name, dest, path };

  let children = [];
  try {
    children = await getChildren(dest, path);
  } catch {
    return;
  }
  for (const child of children.slice(0, 40)) {
    const [cDest, cPath] = child;
    if (cDest && cPath) await walk(cDest, cPath, depth + 1);
  }
};

for (const app of apps) {
  const [dest, path] = app;
  if (!dest || !path) continue;
  await walk(dest, path, 0);
  if (nodes >= 400) break;
}

if (SKIP !== 'nodes-node') run.record('nodes-node', nodes);
if (SKIP !== 'roles-readable') run.record('roles-readable', roles);
if (SKIP !== 'names-readable') run.record('names-readable', names);
if (SKIP !== 'states-readable') run.record('states-readable', states);
if (SKIP !== 'sample') run.record('sample', sample ? `${sample.role} "${sample.name}"` : null);

// The control: Python reading the same desktop at the same moment. Without it,
// "Node saw 400 nodes" is a number with nothing to be measured against.
const CONTROL = `
import json
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi
d = Atspi.get_desktop(0)
apps = d.get_child_count()
nodes = 0
def walk(n, depth):
    global nodes
    if nodes >= 400 or depth > 12:
        return
    nodes += 1
    try:
        c = n.get_child_count()
    except Exception:
        return
    for i in range(min(c, 40)):
        try:
            ch = n.get_child_at_index(i)
        except Exception:
            continue
        if ch is not None:
            walk(ch, depth + 1)
for i in range(apps):
    try:
        a = d.get_child_at_index(i)
        if a is not None:
            walk(a, 0)
    except Exception:
        continue
    if nodes >= 400:
        break
print(json.dumps({"apps": apps, "nodes": nodes}))
`;
const cs = `/tmp/atspi-control-${Date.now()}.py`;
writeFileSync(cs, CONTROL);
let control;
try {
  control = JSON.parse(execFileSync('python3', [cs], { encoding: 'utf8', timeout: 120000 }));
} finally {
  unlinkSync(cs);
}
if (SKIP !== 'apps-python') run.record('apps-python', control.apps);
if (SKIP !== 'nodes-python') run.record('nodes-python', control.nodes);

process.exit(
  run.finish(ARTIFACT, (obs) => `# Can Node read the accessibility tree?

Produced by \`spikes/daemon/node-atspi.mjs\`, which is deleted at the end of M0.5.

This is the question the daemon's language rests on. If Node can reach the Linux
accessibility layer, the daemon is one process in one language. If it cannot, it
is Node plus a Python sidecar, and a seam between them for the life of the
project.

The approach matters: **AT-SPI is D-Bus underneath.** \`libatspi\` is a
convenience wrapper over a published bus protocol, not a private channel. So
this does not bind to a C library or compile anything — it speaks the protocol
directly with a plain D-Bus client, which is why no native module and no
GObject introspection appears anywhere in it.

## Result

| | Node, over plain D-Bus | Python \`Atspi\` bindings |
|---|---|---|
| Applications on the accessibility desktop | ${obs['apps-node']} | ${obs['apps-python']} |
| Nodes reached in a bounded walk | ${obs['nodes-node']} | ${obs['nodes-python']} |

Of the ${obs['nodes-node']} nodes Node reached: **${obs['roles-readable']} returned a role**,
**${obs['names-readable']} returned a name**, and **${obs['states-readable']} returned a state set**.

First fully-read element: \`${obs.sample}\`

Both figures are capped at 400 nodes by the walk itself, so a matching pair at
the ceiling means both routes were still going, not that the desktop ran out.
The application count is the uncapped comparison and is the one to read.

## What this settles

Node reaches the accessibility layer with **no native compilation, no GObject
introspection, and no Python in the process**. It enumerates applications, walks
the tree, and reads the three things a daemon actually needs — role, name, and
states. Reading a child count would not have been evidence of a legible tree;
reading roles and names is.

The consequence for ADR-0010 is direct. That record chose Python for the Linux
backend because the bindings were assumed to require it. The assumption does not
survive: the bindings are a convenience, and the daemon can speak the protocol
they wrap.

## What this does not settle

**Reading is not writing.** This walks and reads. Invoking actions, setting text
and typing all go through other interfaces, and none of them is exercised here.

**Nor does it settle the event stream.** A daemon that cannot subscribe to
accessibility signals is not a daemon, and this spike does not subscribe to
anything. Both are cheap to test and neither has been.

## Receipt

\`\`\`
node spikes/daemon/node-atspi.mjs
\`\`\`
`),
);
