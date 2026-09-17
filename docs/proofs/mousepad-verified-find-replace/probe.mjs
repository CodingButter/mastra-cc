// Independent calibration-only native access. Never exposed to the model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../daemon/package.json', import.meta.url));
const dbus = require('dbus-native');
export const A = 'org.a11y.atspi.Accessible';
export const unpack = value => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && Array.isArray(value[1]) ? value[1][0] : value;
export async function connectNative(run) {
  assert.equal(process.env.MOUSEPAD_PROOF_ISOLATED, '1');
  const session = dbus.sessionBus();
  let bus;
  const exchanges = [];
  const invoke = (connection, ref, iface, member, signature, body) => new Promise((resolve, reject) => {
    const request = { destination: ref[0], path: ref[1], interface: iface, member, ...(signature ? { signature, body } : {}) };
    const timer = setTimeout(() => reject(new Error(`native deadline: ${member}`)), 3000);
    connection.invoke(request, (error, ...reply) => {
      clearTimeout(timer);
      exchanges.push({ time: Date.now(), request, ...(error ? { error: String(error) } : { reply }) });
      error ? reject(new Error(String(error))) : resolve(reply);
    });
  });
  const [address] = await invoke(session, ['org.a11y.Bus', '/org/a11y/bus'], 'org.a11y.Bus', 'GetAddress');
  bus = dbus.createClient({ busAddress: String(address), direct: false });
  const call = (ref, iface, member, signature, body) => invoke(bus, ref, iface, member, signature, body);
  const property = async (ref, name) => unpack((await call(ref, 'org.freedesktop.DBus.Properties', 'Get', 'ss', [A, name]))[0]);
  async function snapshot(name) {
    const [apps] = await call(['org.a11y.atspi.Registry', '/org/a11y/atspi/accessible/root'], A, 'GetChildren');
    const matches = [];
    for (const ref of apps) if (await property(ref, 'Name') === 'mousepad') matches.push(ref);
    assert.equal(matches.length, 1, 'one isolated Mousepad');
    const appRoot = matches[0], queue = [appRoot], seen = new Set(), nodes = [];
    while (queue.length) {
      const ref = queue.shift(), key = JSON.stringify(ref);
      if (seen.has(key)) continue;
      seen.add(key); assert.ok(seen.size <= 2000, 'measurement ceiling, not a proposed public bound');
      const [role] = await call(ref, A, 'GetRoleName');
      const [interfaces] = await call(ref, A, 'GetInterfaces');
      const [children] = await call(ref, A, 'GetChildren');
      const [owner] = await call(ref, A, 'GetApplication');
      const [states] = await call(ref, A, 'GetState');
      const [relations] = await call(ref, A, 'GetRelationSet');
      const node = { ref, role, name: await property(ref, 'Name'), parent: await property(ref, 'Parent'), owner, interfaces, children, states, relations };
      if (interfaces.includes('org.a11y.atspi.Component')) {
        try { [node.bounds] = await call(ref, 'org.a11y.atspi.Component', 'GetExtents', 'u', [0]); }
        catch (error) { node.boundsError = String(error); }
      }
      if (interfaces.includes('org.a11y.atspi.Action')) [node.actions] = await call(ref, 'org.a11y.atspi.Action', 'GetActions');
      if (interfaces.includes('org.a11y.atspi.Text')) [node.text] = await call(ref, 'org.a11y.atspi.Text', 'GetText', 'ii', [0, -1]);
      nodes.push(node); queue.push(...children);
    }
    const result = { application: 'mousepad', appRoot, time: Date.now(), nodes };
    fs.writeFileSync(`${run}/${name}.native.json`, JSON.stringify(result, null, 2) + '\n');
    return result;
  }
  return { call, snapshot, close() { fs.writeFileSync(`${run}/native-exchanges.json`, JSON.stringify(exchanges, null, 2) + '\n'); bus.connection.stream.end(); session.connection.stream.end(); } };
}
