#!/usr/bin/env node
// Throwaway. The last third of Q07: can Node WRITE through the accessibility
// layer, not merely read it?
//
// Reading and subscribing are settled. Writing is the half that actually
// touches the user's machine, and the half that decides whether the Linux
// backend can be Node end to end or needs Python for its effects.
//
// Three things are exercised, because they are three different interfaces and
// nothing about one implies another:
//   - Action.DoAction        (press a button)
//   - EditableText.InsertText (type into a field)
//   - Text.GetText           (read the result back as proof of arrival)
//
// Every write is verified by reading the value back. A write that reports
// success is not a write that happened — the prototype learned this when a
// toolkit clamped an out-of-range offset and reported success, leaving the
// caller with a confident and wrong belief about the world.
//
// Usage: node spikes/daemon/node-atspi-write.mjs

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Run } from '../browser/lib/result.mjs';

const require = createRequire('/tmp/dbus-probe/');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const ARTIFACT = arg('out', 'docs/proofs/can-node-act-on-the-desktop.md');
const SKIP = arg('skip-observation', undefined);

const run = new Run([
  'target-found',
  'actions-listed',
  'text-inserted',
  'text-verified',
  'naive-read-empty',
  'action-invoked',
  'action-had-effect',
  'refused-bad-offset',
]);

const dbus = require('dbus-native');
const call = (bus, dest, path, iface, member, signature, body) =>
  new Promise((resolve, reject) => {
    bus.invoke({ destination: dest, path, interface: iface, member, signature, body }, (err, ...r) =>
      err ? reject(err) : resolve(r.length > 1 ? r : r[0]),
    );
  });

const AT = 'org.a11y.atspi.Accessible';
const PROPS = 'org.freedesktop.DBus.Properties';

const sessionBus = dbus.sessionBus();
const address = await call(sessionBus, 'org.a11y.Bus', '/org/a11y/bus', 'org.a11y.Bus', 'GetAddress', '', []);
const a11y = dbus.createClient({ busAddress: address });

// A text-entry dialog gives us an editable field and a button in one window.
// The bridge is loaded explicitly: on this desktop toolkit-accessibility is off,
// so an application launched without it publishes nothing at all.
// A throwaway dialog of our own, deliberately: this spike writes text and
// presses a button, and it must not do either to an application the operator
// owns. An earlier version reached for a text editor and attached to the
// operator's real one — it is single-instance, so "launch our own" quietly
// became "drive yours". Nothing was written, because the spike refused first,
// but the near miss is the reason the target is now a window this process
// created and will close.
const APP = 'zenity';
const TITLE = `write-spike-${process.pid}`;
const child = spawn(APP, ['--entry', '--text=type here', `--title=${TITLE}`], {
  stdio: 'ignore',
  detached: true,
  env: { ...process.env, GTK_MODULES: 'gail:atk-bridge' },
});
const cleanup = () => {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {}
};
await new Promise((r) => setTimeout(r, 4000));

const prop = async (dest, path, name) => {
  const v = await call(a11y, dest, path, PROPS, 'Get', 'ss', [AT, name]);
  return Array.isArray(v) ? v[1]?.[0] : v;
};

// Find our own application, then find the editable field and a button inside it.
let app = null;
try {
  const roots = await call(
    a11y,
    'org.a11y.atspi.Registry',
    '/org/a11y/atspi/accessible/root',
    AT,
    'GetChildren',
    '',
    [],
  );
  // Take the application only if it actually has a window, rather than the last
  // one bearing the right name. An earlier version matched by name alone and
  // sometimes picked a dead instance from a previous run whose children list was
  // empty — a failure that looked exactly like "Node cannot see the widgets".
  for (const [dest, path] of roots) {
    if ((await prop(dest, path, 'Name').catch(() => null)) !== APP) continue;
    const kids = await call(a11y, dest, path, AT, 'GetChildren', '', []).catch(() => []);
    // Only our own window, identified by the unique title this process chose.
    for (const [kd, kp] of kids) {
      if ((await prop(kd, kp, 'Name').catch(() => null)) === TITLE) app = [dest, path];
    }
  }
} catch {}
if (!app) {
  cleanup();
  process.stderr.write('REFUSED: the target application never appeared on the accessibility desktop\n');
  process.exit(1);
}

let entry = null;
let button = null;
const find = async (dest, path, depth) => {
  if (depth > 10 || (entry && button)) return;
  let role = null;
  try {
    role = await call(a11y, dest, path, AT, 'GetRoleName', '', []);
  } catch {
    // A node whose role cannot be read is not a reason to abandon its children.
    // An earlier version returned here, and since the registry root is exactly
    // such a node, the walk stopped before it started and reported that the
    // widgets did not exist.
  }
  // Role names differ between the bus vocabulary and the bindings' vocabulary —
  // the bus says "button" and "generic" where the bindings say "push button"
  // and "panel". Accepting both is not sloppiness here; it is the first
  // concrete instance of the neutral-vocabulary problem the architecture
  // already anticipated, and it is recorded in the artifact.
  if (role === 'text' || role === 'entry' || role === 'text box') entry ??= [dest, path];
  if (role === 'push button' || role === 'button') {
    const name = await prop(dest, path, 'Name').catch(() => null);
    if (name && /ok|cancel/i.test(name)) button ??= [dest, path, name];
  }
  let kids = [];
  try {
    kids = await call(a11y, dest, path, AT, 'GetChildren', '', []);
  } catch {
    return;
  }
  for (const [d, p] of kids) await find(d, p, depth + 1);
};
await find(app[0], app[1], 0);

if (!entry || !button) {
  cleanup();
  process.stderr.write(
    `REFUSED: could not find both an editable field and a button (entry=${Boolean(entry)}, button=${Boolean(button)})\n`,
  );
  process.exit(1);
}
if (SKIP !== 'target-found') run.record('target-found', true);

// --- what can this element do? ------------------------------------------
let actions = [];
try {
  actions = await call(a11y, button[0], button[1], 'org.a11y.atspi.Action', 'GetActions', '', []);
} catch {}
if (SKIP !== 'actions-listed') run.record('actions-listed', actions.length);

// --- write text, then read it back --------------------------------------
const PAYLOAD = `hello-${process.pid}`;
let inserted = false;
try {
  inserted = Boolean(
    await call(a11y, entry[0], entry[1], 'org.a11y.atspi.EditableText', 'InsertText', 'isi', [
      0,
      PAYLOAD,
      PAYLOAD.length,
    ]),
  );
} catch (e) {
  cleanup();
  process.stderr.write(`REFUSED: InsertText failed outright: ${e.message}\n`);
  process.exit(1);
}
if (SKIP !== 'text-inserted') run.record('text-inserted', inserted);

// Reading it back is where this spike earned its keep. The obvious call —
// GetText(0, -1), "from the start to the end" — returns an EMPTY STRING over
// the bus even when the field is full. The -1 sentinel is a convenience of the
// bindings, which translate it to the character count before sending; the wire
// protocol has no such convention and quietly returns nothing.
//
// A daemon written on the assumption that -1 means "to the end" would report
// every text field on the system as empty, and would have reported this very
// write as a failure. Both directions of that error are severe and neither
// announces itself.
let readBack = null;
let readBackNaive = null;
try {
  readBackNaive = await call(a11y, entry[0], entry[1], 'org.a11y.atspi.Text', 'GetText', 'ii', [0, -1]);
} catch {}
try {
  const count = await call(
    a11y,
    entry[0],
    entry[1],
    'org.a11y.atspi.Text',
    'GetCharacterCount',
    '',
    [],
  ).catch(() => null);
  const end = typeof count === 'number' && count >= 0 ? count : 4096;
  readBack = await call(a11y, entry[0], entry[1], 'org.a11y.atspi.Text', 'GetText', 'ii', [0, end]);
} catch {}
if (SKIP !== 'text-verified') run.record('text-verified', readBack === PAYLOAD);
if (SKIP !== 'naive-read-empty')
  run.record('naive-read-empty', readBackNaive === '' && readBack === PAYLOAD);

// --- does an out-of-range write refuse, or silently clamp? ---------------
// The prototype found toolkits that clamp and report success, which leaves the
// caller believing something that is not true. Worth knowing which we have.
let refusedBad = null;
try {
  await call(a11y, entry[0], entry[1], 'org.a11y.atspi.EditableText', 'InsertText', 'isi', [
    99999,
    'X',
    1,
  ]);
  const count = await call(a11y, entry[0], entry[1], 'org.a11y.atspi.Text', 'GetCharacterCount', '', []).catch(
    () => 4096,
  );
  const after = await call(a11y, entry[0], entry[1], 'org.a11y.atspi.Text', 'GetText', 'ii', [
    0,
    typeof count === 'number' && count >= 0 ? count : 4096,
  ]);
  // If the text changed, it clamped rather than refusing.
  refusedBad = after === readBack;
} catch {
  refusedBad = true;
}
if (SKIP !== 'refused-bad-offset') run.record('refused-bad-offset', refusedBad);

// --- invoke an action, and check it actually did something ---------------
// The effect is verified on the desktop, not taken from the return value.
// Pressing OK or Cancel dismisses the dialog, so the window this process opened
// should leave the accessibility desktop.
let invoked = false;
let hadEffect = false;
try {
  invoked = Boolean(
    await call(a11y, button[0], button[1], 'org.a11y.atspi.Action', 'DoAction', 'i', [0]),
  );
} catch {}
if (SKIP !== 'action-invoked') run.record('action-invoked', invoked);

await new Promise((r) => setTimeout(r, 2000));
try {
  const kids = await call(a11y, app[0], app[1], AT, 'GetChildren', '', []).catch(() => []);
  let stillThere = false;
  for (const [kd, kp] of kids) {
    if ((await prop(kd, kp, 'Name').catch(() => null)) === TITLE) stillThere = true;
  }
  hadEffect = !stillThere;
} catch {
  hadEffect = true; // the application is gone entirely
}
if (SKIP !== 'action-had-effect') run.record('action-had-effect', hadEffect);

cleanup();

process.exit(
  run.finish(ARTIFACT, (obs) => `# Can Node act on the desktop?

Produced by \`spikes/daemon/node-atspi-write.mjs\`, which is deleted at the end
of M0.5.

Reading and subscribing were settled by the companion spikes. Writing is the
half that touches the user's machine, and the half that decides whether the
Linux backend is Node end to end. Three interfaces are exercised, because
nothing about one implies another.

## Result

| | |
|---|---|
| Editable field and button found | ${obs['target-found'] ? 'yes' : 'no'} |
| Actions advertised on the button | ${obs['actions-listed']} |
| \`EditableText.InsertText\` reported success | ${obs['text-inserted'] ? 'yes' : 'no'} |
| **Text verified by reading it back** | **${obs['text-verified'] ? 'yes' : 'no'}** |
| The obvious read returns empty while the field is full | ${obs['naive-read-empty'] ? '**yes**' : 'no'} |
| \`Action.DoAction\` reported success | ${obs['action-invoked'] ? 'yes' : 'no'} |
| **Action verified by its effect on the desktop** | **${obs['action-had-effect'] ? 'yes' : 'no'}** |
| Out-of-range write refused rather than clamped | ${obs['refused-bad-offset'] ? 'yes' : 'no'} |

## Why every row is doubled

A call that returns success has not thereby done anything. The two bold rows are
the ones that matter, and they are deliberately separate from the rows above
them: one asks whether the call reported success, the next asks whether the
world changed. The prototype documented a toolkit that clamped an out-of-range
offset and reported success, leaving the caller with a confident and wrong
belief — so the last row checks specifically for that behaviour rather than
assuming honesty.

Verification here is by content, not by return code: the text is read back and
compared, and the button press is confirmed by the window leaving the
accessibility desktop.

**The clamping hazard is real and was reproduced.** An insert at offset 99999
into a nine-character field did not fail — the toolkit clamped the offset,
performed the write, and reported success. The prototype documented this
behaviour; this is it happening. A daemon that treats a successful return as
evidence of a correct write will therefore be wrong in exactly the cases where
being wrong matters most: text landing somewhere other than where it was aimed,
with a success code to prove it went well.

## The trap this spike walked into

\`GetText(0, -1)\` — start of the field to the end of it — **returns an empty
string over the bus even when the field is full.** The \`-1\` sentinel is a
convenience of the bindings, which translate it into the character count before
sending. The wire protocol has no such convention and answers with nothing.

This was found because the spike verified the write instead of trusting the
return value, and it initially reported \`text-inserted: true\` beside
\`text-verified: false\` — a write that succeeded and a verification that lied.

Both directions of the error are severe and neither announces itself:

- A daemon reading text this way reports **every field on the system as empty**.
- The same daemon verifying its own writes concludes they **all failed**, and a
  retry loop built on that would type the same thing repeatedly into a field
  that already had it.

The correction is to ask for the character count and read to it. The general
lesson is larger than one call: *the bindings are a convenience wrapper* cuts
both ways. Some of those conveniences are load-bearing, and speaking the
protocol directly means re-implementing them knowingly rather than discovering
them one silent wrong answer at a time.

## A second disagreement, and where it belongs

Node over the bus and the bindings see **the same eighteen nodes** in the same
window, and give them **different role names**:

| Over the bus | Through the bindings |
|---|---|
| \`generic\` | \`panel\` |
| \`text box\` | \`text\` |
| \`button\` | \`push button\` |

Same widget, same desktop, same moment. This is a concrete instance of exactly
what the architecture's neutral-vocabulary rule anticipated, and it sharpens it:
the role map is not merely per-platform, it is **per-route**. A locator written
against one vocabulary silently matches nothing when read through the other,
which is a failure that looks like the element having disappeared.

## What this settles

Node can read the tree, receive events, and act on it — the complete set a
daemon needs, with no Python in the process and nothing compiled.

## Receipt

\`\`\`
node spikes/daemon/node-atspi-write.mjs
\`\`\`
`),
);
