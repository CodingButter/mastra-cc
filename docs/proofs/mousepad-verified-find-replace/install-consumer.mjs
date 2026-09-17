// Install published tarballs, then relocate the exact installed pnpm runtime closure.
// No registry resolution is performed for Mastra, its providers, or its peers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = process.argv[3] ? fs.realpathSync(process.argv[3]) : fileURLToPath(new URL('../../../', import.meta.url));
const out = path.resolve(process.argv[2]);
assert.ok(!fs.existsSync(out), 'use a fresh installation directory');
fs.mkdirSync(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: ['ignore', fs.openSync(path.join(out, 'setup.log'), 'a'), fs.openSync(path.join(out, 'setup.log'), 'a')] });
for (const name of ['protocol-types', 'transport', 'desktop']) run('pnpm', ['--filter', `@mastra-cc/${name}`, 'pack', '--pack-destination', out]);
const consumer = path.join(out, 'consumer');
fs.mkdirSync(consumer);
fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'mousepad-installed-proof', private: true, type: 'module' }));
const tarballs = fs.readdirSync(out).filter(f => f.endsWith('.tgz')).sort();
assert.equal(tarballs.length, 3);
run('npm', ['install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs.map(f => path.join(out, f))]);
const copied = new Map();
function resolvePackage(from, name) {
  for (let dir = from;; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    if (dir === path.dirname(dir)) throw new Error(`missing locked dependency ${name} from ${from}`);
  }
}
function link(target, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  assert.ok(!fs.existsSync(dest), `unexpected existing dependency ${dest}`);
  fs.symlinkSync(path.relative(path.dirname(dest), target), dest, 'dir');
}
function relocate(source) {
  if (copied.has(source)) return copied.get(source).destination;
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json')));
  const key = hash(path.relative(root, source)).slice(0, 20);
  const destination = path.join(consumer, '.locked', key, 'node_modules', manifest.name);
  fs.cpSync(source, destination, { recursive: true, filter: p => path.basename(p) !== 'node_modules' });
  const record = { name: manifest.name, version: manifest.version, source: path.relative(root, source), destination, dependencies: {} };
  copied.set(source, record);
  const dependencies = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies };
  for (const name of Object.keys(dependencies).sort()) {
    let dependency;
    try { dependency = resolvePackage(source, name); }
    catch (error) {
      if (name in (manifest.optionalDependencies ?? {}) || manifest.peerDependenciesMeta?.[name]?.optional) { record.dependencies[name] = { absentOptional: true }; continue; }
      throw error;
    }
    const target = relocate(dependency);
    record.dependencies[name] = path.relative(consumer, target);
    link(target, path.join(destination, 'node_modules', name));
  }
  return destination;
}
const core = relocate(resolvePackage(path.join(root, 'apps/desk-demo'), '@mastra/core'));
link(core, path.join(consumer, 'node_modules/@mastra/core'));
// All runtime dependencies resolve from their copied package, including peer variants.
const files = {};
function inventory(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, entry.name), relative = path.relative(consumer, p);
    if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(p);
      assert.ok(real.startsWith(consumer + path.sep), `escaping symlink ${relative}`);
      files[relative] = { link: fs.readlinkSync(p) };
    } else if (entry.isDirectory()) inventory(p);
    else files[relative] = { sha256: hash(fs.readFileSync(p)) };
  }
}
inventory(consumer);
fs.copyFileSync(path.join(root, 'pnpm-lock.yaml'), path.join(out, 'source-pnpm-lock.yaml'));
const lock = { sourceLockSha256: hash(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'))), tarballs: Object.fromEntries(tarballs.map(f => [f, hash(fs.readFileSync(path.join(out, f)))])), packages: [...copied.values()].map(r => ({ ...r, destination: path.relative(consumer, r.destination) })), files };
fs.writeFileSync(path.join(out, 'consumer-lock.json'), JSON.stringify(lock, null, 2) + '\n');
run('node', ['--input-type=module', '-e', `const names=['@mastra-cc/desktop','@mastra-cc/desktop/mastra','@mastra/core/agent']; for(const name of names){await import(name);console.log(name,import.meta.resolve(name));}`], consumer);
console.log(`INSTALLED_IMPORTS_GREEN: ${copied.size} locked runtime packages; ${consumer}`);
