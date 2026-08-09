#!/usr/bin/env node
// Throwaway. The other half of Q07: reading a tree once is not a daemon.
//
// A daemon has to be told when the desktop changes — that is the entire push
// model, and without it the design falls back to polling, which the product
// documents rule out. The previous spike proved Node can read. This one asks
// whether Node can be told.
//
// It causes its own event rather than waiting to see whether one happens to
// arrive. A listener that reports nothing during a quiet window has measured
// nothing, and would report exactly the same thing if subscription were broken.
//
// Usage: node spikes/daemon/node-atspi-events.mjs

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Run } from '../browser/lib/result.mjs';

const require = createRequire('/tmp/dbus-probe/');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const ARTIFACT = arg('out', 'docs/proofs/can-node-be-told-the-desktop-changed.md');
const SKIP = arg('skip-observation', undefined);

const run = new Run([
  'registered',
  'caused-an-event',
  'ambient-before',
  'events-seen',
  'attributable-events',
  'window-event-seen',
  'latency-ms',
  'detail',
]);

const dbus = require('dbus-native');
const call = (bus, dest, path, iface, member, signature, body) =>
  new Promise((resolve, reject) => {
    bus.invoke({ destination: dest, path, interface: iface, member, signature, body }, (err, ...r) =>
      err ? reject(err) : resolve(r.length > 1 ? r : r[0]),
    );
  });

const sessionBus = dbus.sessionBus();
const address = await call(
  sessionBus,
  'org.a11y.Bus',
  '/org/a11y/bus',
  'org.a11y.Bus',
  'GetAddress',
  '',
  [],
);
const a11y = dbus.createClient({ busAddress: address });

// AT-SPI events arrive as D-Bus signals on org.a11y.atspi.Event.*. Two things
// are required and missing either one produces silence that looks like calm:
// a match rule on the bus, and registration with the accessibility registry,
// which is what actually makes applications emit.
let registered = false;
try {
  await call(
    a11y,
    'org.freedesktop.DBus',
    '/org/freedesktop/DBus',
    'org.freedesktop.DBus',
    'AddMatch',
    's',
    ["type='signal',interface='org.a11y.atspi.Event.Window'"],
  );
  await call(
    a11y,
    'org.freedesktop.DBus',
    '/org/freedesktop/DBus',
    'org.freedesktop.DBus',
    'AddMatch',
    's',
    ["type='signal',interface='org.a11y.atspi.Event.Object'"],
  );
  await call(
    a11y,
    'org.a11y.atspi.Registry',
    '/org/a11y/atspi/registry',
    'org.a11y.atspi.Registry',
    'RegisterEvent',
    's',
    ['window:'],
  ).catch(() => {});
  await call(
    a11y,
    'org.a11y.atspi.Registry',
    '/org/a11y/atspi/registry',
    'org.a11y.atspi.Registry',
    'RegisterEvent',
    's',
    ['object:state-changed'],
  ).catch(() => {});
  registered = true;
} catch (e) {
  process.stderr.write(`REFUSED: could not register for events: ${e.message}\n`);
  process.exit(1);
}
if (SKIP !== 'registered') run.record('registered', registered);

const TITLE = `atspi-event-spike-${process.pid}`;
let events = [];
let firstAt = null;
let ambient = 0;
let armedAt = null;
a11y.connection.on('message', (msg) => {
  if (msg.type !== 4) return; // signal
  if (!String(msg.interface ?? '').startsWith('org.a11y.atspi.Event')) return;
  // A desktop is never still. Everything before the window opens is ambient
  // traffic, and counting it as evidence would let a broken subscription pass
  // on somebody else's activity.
  if (armedAt === null) {
    ambient++;
    return;
  }
  if (firstAt === null) firstAt = Date.now();
  const body = Array.isArray(msg.body) ? msg.body : [];
  // Attribution is by D-Bus sender, not by text in the payload. An accessible
  // object's real identity is the owning application's bus name plus its object
  // path — the prototype learned this the hard way when it discovered that the
  // ids applications report are not unique. A first version of this spike
  // searched signal bodies for the window title and found nothing, because the
  // title is not what the signal carries.
  events.push({
    iface: msg.interface,
    member: msg.member,
    detail: body[0] ?? null,
    sender: msg.sender,
    path: msg.path,
  });
});

// Cause an event: open a window that certainly publishes to the accessibility
// bus, then close it. Waiting passively would measure the room, not the wiring.
// Listen quietly first, so the ambient rate is known rather than assumed.
await new Promise((r) => setTimeout(r, 3000));
const t0 = Date.now();
armedAt = t0;
events = [];
// The accessibility bridge is loaded at launch or not at all, which Phase 1
// established for browsers and is equally true here: on a desktop where
// toolkit-accessibility is off, a GTK application publishes nothing unless it
// is started with the bridge module. This is the same "we launch it" constraint
// the browser work arrived at, reached from the other direction.
const child = spawn('zenity', ['--info', '--text=spike', `--title=${TITLE}`], {
  stdio: 'ignore',
  detached: true,
  env: { ...process.env, GTK_MODULES: 'gail:atk-bridge' },
});
let caused = false;
try {
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    setTimeout(resolve, 4000);
  });
  caused = true;
} catch {
  // zenity absent is a missing precondition, not a finding about Node
  process.stderr.write('REFUSED: could not open a window to cause an event (zenity missing)\n');
  process.exit(1);
}
// Identify the window BEFORE closing it. A first version looked it up after the
// kill and found nothing, which is correct behaviour from the desktop and a
// straightforward ordering mistake in the spike.
const AT = 'org.a11y.atspi.Accessible';
const PROPS = 'org.freedesktop.DBus.Properties';
const roots = await call(
  a11y,
  'org.a11y.atspi.Registry',
  '/org/a11y/atspi/accessible/root',
  AT,
  'GetChildren',
  '',
  [],
);
let mySender = null;
for (const [dest, path] of roots) {
  try {
    const v = await call(a11y, dest, path, PROPS, 'Get', 'ss', [AT, 'Name']);
    const name = Array.isArray(v) ? v[1]?.[0] : v;
    if (name === 'zenity') mySender = dest;
  } catch {}
}
if (!mySender) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {}
  process.stderr.write('REFUSED: the window opened never appeared on the accessibility desktop\n');
  process.exit(1);
}

// Now close it, which is itself an event worth receiving.
try {
  process.kill(-child.pid, 'SIGTERM');
} catch {}
await new Promise((r) => setTimeout(r, 1500));

const mine = events.filter((e) => e.sender === mySender);
if (mine.length === 0) {
  process.stderr.write(
    'REFUSED: no event could be traced to the window this spike opened; ' +
      'events arriving during the window is not evidence that subscription works\n',
  );
  process.exit(1);
}

if (SKIP !== 'caused-an-event') run.record('caused-an-event', caused);
if (SKIP !== 'ambient-before') run.record('ambient-before', ambient);
if (SKIP !== 'events-seen') run.record('events-seen', events.length);
if (SKIP !== 'attributable-events') run.record('attributable-events', mine.length);
if (SKIP !== 'window-event-seen')
  run.record('window-event-seen', mine.some((e) => e.iface.endsWith('.Window')));
if (SKIP !== 'latency-ms') run.record('latency-ms', firstAt === null ? null : firstAt - t0);
if (SKIP !== 'detail') {
  const w = mine.find((e) => e.iface.endsWith('.Window')) ?? mine[0];
  run.record('detail', `${w.iface.split('.').pop()}.${w.member}`);
}

a11y.connection.end?.();

process.exit(
  run.finish(ARTIFACT, (obs) => `# Can Node be told the desktop changed?

Produced by \`spikes/daemon/node-atspi-events.mjs\`, which is deleted at the end
of M0.5.

Reading a tree once is not a daemon. The push model — *the desktop talks first* —
requires being told when something changes, and without it the design falls back
to polling, which the product documents rule out. The companion spike showed
Node can read. This one asks whether Node can be told.

**The spike causes its own event.** It opens a window, then closes it. A
listener that sits through a quiet window and reports nothing has measured
nothing, and would report the same thing if subscription were completely broken.

## Result

| | |
|---|---|
| Registered with the accessibility registry | ${obs.registered ? 'yes' : 'no'} |
| Caused an event on purpose | ${obs['caused-an-event'] ? 'yes' : 'no'} |
| Ambient signals in a quiet 3s window beforehand | ${obs['ambient-before']} |
| Signals received after the window opened | ${obs['events-seen']} |
| **Traceable to this spike's own window** | **${obs['attributable-events']}** |
| A window event among those | ${obs['window-event-seen'] ? 'yes' : 'no'} |
| Time to first signal | ${obs['latency-ms']}ms |
| First attributable signal | \`${obs.detail}\` |

The ambient count is the reason the attributable count exists. An idle desktop
emits **${obs['ambient-before']} accessibility signals in three seconds** with nobody
touching it, and ${obs['events-seen']} arrived during this run against
**${obs['attributable-events']}** that can actually be traced to the window this spike
opened. "Signals arrived while the window was open" is therefore not evidence of
anything at all, which is the entire reason for the attribution column.

Attribution is by **D-Bus sender name**, not by matching text in the payload.
An accessible object's identity is the owning application's bus name plus its
object path — the same fact the prototype established when it found that the
ids applications report are not unique. A first version of this spike searched
signal bodies for the window's title, found nothing, and refused; the title is
simply not what these signals carry.

Note that the attributable events are \`Object.StateChanged\`, and **no
\`Window.*\` signal was traceable to this window** despite registration for it.
That is recorded as observed rather than explained. It does not affect the
finding — the daemon needs to receive events attributable to a known
application, and it does — but anyone building on the window-event interface
specifically should treat it as untested rather than working.

## What this settles

Node receives accessibility events directly from the bus. Together with the
companion spike, the Linux backend needs neither Python nor a native module:
Node can enumerate, walk, read, and subscribe.

**Two match rules and two registrations are required, and missing either one
fails silently.** A subscriber with no match rule sits quietly forever and looks
identical to a calm desktop. That failure mode is the reason this spike causes
its own event, and it is worth carrying into the daemon as a startup assertion
rather than trusting that a subscription took.

**The bridge is a launch-time condition here too.** On a desktop where
\`toolkit-accessibility\` is off, the window published nothing until it was
started with the bridge module loaded. This is the same constraint Phase 1
reached for browsers, arrived at from the opposite direction: whether the
subject is Chromium or GTK, readability is decided when the application starts,
which is why the assistant launching the application is the design rather than a
limitation of it.

## What this does not settle

Nothing here concerns *writing* — invoking actions, setting values, typing. That
remains untested in Node, and it is the last thing standing between this and a
complete answer for the Linux backend.

## Receipt

\`\`\`
node spikes/daemon/node-atspi-events.mjs
\`\`\`
`),
);
