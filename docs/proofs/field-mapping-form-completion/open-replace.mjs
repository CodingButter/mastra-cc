// Setup only: open the measured ordinary application's real Replace dialog.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../daemon/package.json', import.meta.url));
const dbus = require('dbus-native');
assert.equal(process.env.FIELD_PROOF_ISOLATED, '1');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const target = data.nodes.find(n => n.role === 'menu item' && n.name === (data.application === 'pluma' ? 'Replace...' : 'Find and Replace...      '));
assert.ok(target, 'measured Find and Replace menu item required');
const session = dbus.sessionBus();
let bus;
const call = (connection, request) => new Promise((resolve, reject) => connection.invoke(request, (error, ...reply) => error ? reject(error) : resolve(reply)));
try {
  const [address] = await call(session, { destination: 'org.a11y.Bus', path: '/org/a11y/bus', interface: 'org.a11y.Bus', member: 'GetAddress' });
  bus = dbus.createClient({ busAddress: address, direct: false });
  const request = { destination: target.ref[0], path: target.ref[1], interface: 'org.a11y.atspi.Action' };
  const [actions] = await call(bus, { ...request, member: 'GetActions' });
  console.log(JSON.stringify({ setupOnly: true, target, actions }));
  const index = actions.findIndex(action => action[0] === 'Click');
  assert.ok(index >= 0, 'published click action required');
  const [success] = await call(bus, { ...request, member: 'DoAction', signature: 'i', body: [index] });
  assert.equal(success, true);
  console.log(JSON.stringify({ setupOnly: true, target, actions, success }));
} finally {
  bus?.connection.stream.end();
  session.connection.stream.end();
}
