// Independent native calibration, never an agent session or completion claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectNative } from './probe.mjs';
const [run, consumer, mode] = process.argv.slice(2);
const native = await connectNative(run);
const publicSnapshot = stage => execFileSync(process.execPath, [`${consumer}/public-inspect.mjs`, run, stage], { stdio: 'inherit', timeout: 60000 });
try {
  if (mode === '--reopened') {
    const reopened = await native.snapshot('reopened');
    const expected = fs.readFileSync(`${run}/expected.txt`, 'utf8');
    const documents = reopened.nodes.filter(n => n.interfaces.includes('org.a11y.atspi.EditableText') && n.text === expected);
    assert.equal(documents.length, 1, 'one reopened document with independently expected text');
    assert.deepEqual(fs.readFileSync(`${run}/document.txt`), fs.readFileSync(`${run}/expected.txt`));
    publicSnapshot('reopened');
    const entries = reopened.nodes.filter(n => n.role === 'menu item' && n.name.trim() === 'Find and Replace...' && n.actions?.length);
    assert.equal(entries.length, 1);
    assert.equal((await native.call(entries[0].ref, 'org.a11y.atspi.Action', 'DoAction', 'i', [0]))[0], true);
    await sleep(500);
    await native.snapshot('recreated-dialog'); publicSnapshot('recreated-dialog');
    console.log('REOPEN_CALIBRATION_GREEN: disk bytes and fresh native/public observations retained; not agent completion');
  } else {
  const initial = await native.snapshot('initial');
  publicSnapshot('initial');
  const replace = initial.nodes.filter(n => n.role === 'menu item' && n.name.trim() === 'Find and Replace...' && n.actions?.length);
  fs.writeFileSync(`${run}/replace-candidates.json`, JSON.stringify(replace, null, 2));
  assert.equal(replace.length, 1, 'one native Replace menu action');
  assert.equal((await native.call(replace[0].ref, 'org.a11y.atspi.Action', 'DoAction', 'i', [0]))[0], true);
  await sleep(500);
  const dialog = await native.snapshot('dialog');
  publicSnapshot('dialog');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [labelText, value] of [['Search for:', 'TOKEN_41'], ['Replace with:', 'VALUE_73']]) {
    const labels = dialog.nodes.filter(n => n.role === 'label' && n.name === labelText);
    assert.equal(labels.length, 1);
    const parents = dialog.nodes.filter(n => n.role === 'combo box' && n.relations.some(r => r[0] === 2 && r[1].some(ref => same(ref, labels[0].ref))));
    assert.equal(parents.length, 1);
    const fields = dialog.nodes.filter(n => n.interfaces.includes('org.a11y.atspi.EditableText') && same(n.parent, parents[0].ref) && parents[0].children.some(ref => same(ref, n.ref)));
    assert.equal(fields.length, 1, 'one reciprocally contained editable calibration field');
    assert.equal((await native.call(fields[0].ref, 'org.a11y.atspi.EditableText', 'SetTextContents', 's', [value]))[0], true);
  }
  const action = async (snapshot, role, name) => {
    const matches = snapshot.nodes.filter(n => n.role === role && n.name.trim() === name && n.actions?.length);
    assert.equal(matches.length, 1, `one calibration action: ${name}`);
    assert.equal((await native.call(matches[0].ref, 'org.a11y.atspi.Action', 'DoAction', 'i', [0]))[0], true);
    await sleep(300);
  };
  await action(dialog, 'check box', 'Replace all in:');
  await native.snapshot('filled'); publicSnapshot('filled');
  await action(dialog, 'push button', 'Replace');
  await native.snapshot('replaced'); publicSnapshot('replaced');
  await action(dialog, 'push button', 'Close');
  const document = await native.snapshot('before-save');
  fs.copyFileSync(`${run}/document.txt`, `${run}/unsaved.txt`);
  await action(document, 'menu item', 'Save');
  fs.copyFileSync(`${run}/document.txt`, `${run}/saved.txt`);
  assert.deepEqual(fs.readFileSync(`${run}/saved.txt`), fs.readFileSync(`${run}/expected.txt`), 'independent literal saved-byte calibration');
  await native.snapshot('saved'); publicSnapshot('saved');
  console.log('SAVED_CALIBRATION_CAPTURED: reopen calibration still required');
  }
} finally { native.close(); }
