// SETUP ONLY. Native writes calibrate output; never used by the model runner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../daemon/package.json', import.meta.url));
const dbus = require('dbus-native');
assert.equal(process.env.FIELD_PROOF_ISOLATED, '1');
const [nativePath, valuesPath, buttonName] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(nativePath));
const values = JSON.parse(fs.readFileSync(valuesPath));
const session = dbus.sessionBus();
let bus;
const exchanges = [];
const invoke = (connection, request) => new Promise((resolve, reject) => connection.invoke(request, (error, ...reply) => {
  exchanges.push({ request, ...(error ? { error } : { reply }) });
  error ? reject(new Error(JSON.stringify(error))) : resolve(reply);
}));
try {
  const [address] = await invoke(session, { destination: 'org.a11y.Bus', path: '/org/a11y/bus', interface: 'org.a11y.Bus', member: 'GetAddress' });
  bus = dbus.createClient({ busAddress: address, direct: false });
  for (const [label, value] of Object.entries(values)) {
    const matches = data.nodes.filter(n => ['text', 'entry'].includes(n.role) && n.labelledTargets.some(ref => data.nodes.some(target => JSON.stringify(target.ref) === JSON.stringify(ref) && target.name === label)));
    assert.equal(matches.length, 1, `unique measured direct label: ${label}`);
    const [success] = await invoke(bus, { destination: matches[0].ref[0], path: matches[0].ref[1], interface: 'org.a11y.atspi.EditableText', member: 'SetTextContents', signature: 's', body: [value] });
    assert.equal(success, true);
  }
  if (buttonName !== undefined) {
  const buttons = data.nodes.filter(n => n.role === 'push button' && n.name === buttonName);
  assert.equal(buttons.length, 1);
  const ref = buttons[0].ref;
  const request = { destination: ref[0], path: ref[1], interface: 'org.a11y.atspi.Action' };
  const [actions] = await invoke(bus, { ...request, member: 'GetActions' });
  const index = actions.findIndex(a => a[0].toLowerCase() === 'click');
  assert.ok(index >= 0);
  const [success] = await invoke(bus, { ...request, member: 'DoAction', signature: 'i', body: [index] });
  assert.equal(success, true);
  }
} finally {
  console.log(JSON.stringify({ setupOnly: true, values, exchanges }, null, 2));
  bus?.connection.stream.end();
  session.connection.stream.end();
}
