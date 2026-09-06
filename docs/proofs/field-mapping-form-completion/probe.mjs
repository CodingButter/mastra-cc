// Read-only native measurements on an explicitly isolated proof desktop.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../../../daemon/package.json', import.meta.url));
const dbus = require('dbus-native');
const A = 'org.a11y.atspi.Accessible';
const P = 'org.freedesktop.DBus.Properties';
const root = '/org/a11y/atspi/accessible/root';
export function labelledTargets(reply) {
  assert.ok(Array.isArray(reply) && reply.length === 1 && Array.isArray(reply[0]));
  return reply[0].flatMap(relation => {
    assert.ok(Array.isArray(relation) && relation.length === 2 && Number.isInteger(relation[0]) && Array.isArray(relation[1]));
    for (const ref of relation[1]) assert.ok(Array.isArray(ref) && ref.length === 2 && ref.every(x => typeof x === 'string'));
    return relation[0] === 2 ? relation[1] : [];
  });
}
export async function probe(application) {
  assert.equal(process.env.FIELD_PROOF_ISOLATED, '1', 'run through the private desktop harness');
  const exchanges = [];
  const session = dbus.sessionBus();
  let bus;
  const call = (connection, ref, iface, member, signature, body) => new Promise((resolve, reject) => {
    const request = { destination: ref[0], path: ref[1], interface: iface, member, ...(signature ? { signature, body } : {}) };
    connection.invoke(request, (error, ...reply) => {
      exchanges.push({ request, ...(error ? { error } : { reply }) });
      error ? reject(new Error(JSON.stringify(error))) : resolve(reply);
    });
  });
  try {
    const [address] = await call(session, ['org.a11y.Bus', '/org/a11y/bus'], 'org.a11y.Bus', 'GetAddress');
    bus = dbus.createClient({ busAddress: String(address), direct: false });
    const prop = async (ref, name) => (await call(bus, ref, P, 'Get', 'ss', [A, name]))[0];
    const [apps] = await call(bus, ['org.a11y.atspi.Registry', root], A, 'GetChildren');
    const matching = [];
    for (const ref of apps) {
      const name = await prop(ref, 'Name');
      if ((typeof name === 'string' ? name : name[1][0]) === application) matching.push(ref);
    }
    assert.equal(matching.length, 1, `expected one application named ${application}`);
    const appRoot = matching[0];
    const queue = [appRoot], nodes = [], seen = new Set();
    while (queue.length) {
      const ref = queue.shift(), key = JSON.stringify(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      assert.ok(seen.size <= 2000, 'measurement tree bound');
      const [role] = await call(bus, ref, A, 'GetRoleName');
      const name = await prop(ref, 'Name');
      const parent = await prop(ref, 'Parent');
      const relations = await call(bus, ref, A, 'GetRelationSet');
      let bounds;
      try { [bounds] = await call(bus, ref, 'org.a11y.atspi.Component', 'GetExtents', 'u', [0]); } catch { bounds = null; }
      nodes.push({ ref, role, name, parent, relations, bounds, labelledTargets: labelledTargets(relations) });
      const [children] = await call(bus, ref, A, 'GetChildren');
      queue.push(...children);
    }
    return { application, appRoot, nodes, exchanges };
  } catch (error) {
    if (process.argv[3]) fs.writeFileSync(`${process.argv[3]}.failed.json`, JSON.stringify({ exchanges, error: String(error) }, null, 2));
    throw error;
  } finally {
    bus?.connection.stream.end();
    session.connection.stream.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await probe(process.argv[2]);
  fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
  for (const node of result.nodes.filter(n => ['text', 'entry'].includes(n.role))) console.log(JSON.stringify(node));
}
