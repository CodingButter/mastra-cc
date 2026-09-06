// Independent, read-only AT-SPI measurement. No production backend imports and
// no diagnostic handles from the public API; this private desk has one entry.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../daemon/package.json', import.meta.url));
const dbus = require('dbus-native');
const accessible = 'org.a11y.atspi.Accessible';
const root = '/org/a11y/atspi/accessible/root';
function call(bus, destination, path, iface, member, signature, body) {
  return new Promise((resolve, reject) => {
    bus.invoke({ destination, path, interface: iface, member,
      ...(signature ? { signature, body } : {}) },
    (error, ...values) => error ? reject(new Error(JSON.stringify(error))) : resolve(values));
  });
}
export async function entryRectangle() {
  const session = dbus.sessionBus();
  let bus;
  try {
    const [address] = await call(session, 'org.a11y.Bus', '/org/a11y/bus', 'org.a11y.Bus', 'GetAddress');
    bus = dbus.createClient({ busAddress: String(address), direct: false });
    const [apps] = await call(bus, 'org.a11y.atspi.Registry', root, accessible, 'GetChildren');
    const queue = [...apps];
    const entries = [];
    let visited = 0;
    while (queue.length) {
      assert.ok(++visited <= 200, 'fixture tree exceeded measurement bound');
      const [destination, path] = queue.shift();
      const [role] = await call(bus, destination, path, accessible, 'GetRoleName');
      if (role === 'entry' || role === 'text') {
        const [rectangle] = await call(bus, destination, path, 'org.a11y.atspi.Component', 'GetExtents', 'u', [0]);
        entries.push(rectangle);
      }
      const [children] = await call(bus, destination, path, accessible, 'GetChildren');
      queue.push(...children);
    }
    assert.equal(entries.length, 1, 'expected precisely one native entry');
    const [x, y, width, height] = entries[0];
    assert.ok([x, y, width, height].every(Number.isInteger));
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1024 && y + height <= 768);
    return { x, y, width, height };
  } finally {
    bus?.connection.stream.end();
    session.connection.stream.end();
  }
}
