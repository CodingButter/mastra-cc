import assert from 'node:assert/strict';
import { grabPixels } from '../../../daemon/src/backends/atspi/capture.ts';
import { requestControl, controlState } from '../../../apps/desk-demo/src/lib/control.ts';

// In-process reproductions: no real desktop, network, or credentials touched.
const selected = [];
await grabPixels(
  { x: 100, y: 100, width: 20, height: 20 },
  async () => [
    { id: 'authorized-window', x: 0, y: 0, width: 800, height: 600 },
    { id: 'unrelated-window', x: 90, y: 90, width: 50, height: 50 },
  ],
  async id => { selected.push(id); return Buffer.from('pixels'); },
);
assert.equal(selected[0], 'unrelated-window');
console.log('DEFECT REPRODUCED: unrelated containing window chosen for capture.');

const keepAlive = setTimeout(() => {}, 1000);
try {
  const handover = requestControl('human still entering information', 10);
  assert.equal(controlState().mode, 'interact');
  const note = await handover.done;
  assert.equal(controlState().mode, 'view');
  assert.match(note, /nobody confirmed/);
  console.log('DEFECT REPRODUCED: timeout returns control without human Done.');
} finally { clearTimeout(keepAlive); }
