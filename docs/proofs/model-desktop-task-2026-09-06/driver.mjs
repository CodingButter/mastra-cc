// Controlled native fixture, not a real business app or proof of general competence.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { MastraCC, INSTRUCTIONS } from '../../../packages/desktop/dist/mastra.mjs';

const require = createRequire(new URL('../../../apps/desk-demo/package.json', import.meta.url));
const { Agent } = require('@mastra/core/agent');
const run = process.argv[2];
if (!run) throw new Error('usage: driver.mjs RUN');
const root = new URL('../../../', import.meta.url);
const model = process.env.MASTRA_CC_MODEL ?? 'google/gemini-2.5-flash';
const task = 'Read the receipt shown in the Receipt transfer window. Put the receipt number into Receipt number and its printed total into Total paid, then press Record receipt. Verify the result.';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const secrets = [process.env.GOOGLE_API_KEY, ...Object.entries(process.env)
  .filter(([key]) => /(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key))
  .map(([, value]) => value)].filter(Boolean);
function serialize(value) {
  let text = JSON.stringify(value, function (key, item) {
    if ((key === 'data' && this?.format && ['png', 'jpeg', 'webp'].includes(this.format)) ||
        (key === 'image' && typeof item === 'string')) {
      return `<image payload omitted: ${item?.length ?? 0} characters>`;
    }
    if (typeof item === 'string' && /^data:image\//.test(item)) return '<image payload omitted>';
    return item;
  });
  for (const secret of secrets) text = text?.split(secret).join('<credential redacted>');
  return text;
}
function log(event, data) { console.log(serialize({ event, ...data })); }
async function buildHashes(relative, hashes) {
  const url = new URL(`${relative}/`, root);
  for (const entry of await readdir(url, { withFileTypes: true })) {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await buildHashes(path, hashes);
    else if (entry.isFile()) hashes[path] = sha256(await readFile(new URL(path, root)));
  }
}
async function daemonAddress() {
  for (let i = 0; i < 80; i++) {
    const text = await readFile(`${run}/daemon.log`, 'utf8').catch(() => '');
    const match = /websocket listening on (127\.0\.0\.1:\d+)/.exec(text);
    if (match) return `ws://${match[1]}`;
    await sleep(200);
  }
  throw new Error('daemon WebSocket readiness timed out');
}

let desk;
let timer;
let calls = 0;
let steps = 0;
let finalMessage = '';
let failure;
const controller = new AbortController();
try {
  if (!process.env.GOOGLE_API_KEY) throw new Error('Missing GOOGLE_API_KEY');
  const hashes = {};
  await buildHashes('packages/desktop/dist', hashes);
  await buildHashes('daemon/dist', hashes);
  const metadata = {
    scope: 'Controlled native fixture; not a real business app or proof of general competence',
    model, instructionsSource: 'shipped INSTRUCTIONS', instructionsSha256: sha256(INSTRUCTIONS),
    buildHashes: hashes, maxSteps: 24, modelDeadlineMs: 180000, temperature: 0, task,
  };
  log('metadata', metadata);
  await writeFile(`${run}/metadata.json`, serialize(metadata));
  desk = new MastraCC({ url: await daemonAddress() });
  const tools = Object.fromEntries(Object.entries(desk.getTools({
    // This guard runs inside MastraCC after any pending connection dial.
    beforeDispatch: () => controller.signal.throwIfAborted(),
  })).map(([name, tool]) => [name, {
    ...tool,
    execute: async (...args) => {
      controller.signal.throwIfAborted();
      const call = ++calls;
      log('call', { call, name, arguments: args[0] });
      try {
        const result = await tool.execute(...args);
        log('result', { call, name, result });
        return result;
      } catch (error) {
        log('tool-error', { call, name, error: String(error) });
        throw error;
      }
    },
  }]));
  const agent = new Agent({ id: 'model-desktop-task', name: 'model-desktop-task',
    instructions: INSTRUCTIONS, model, tools });
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('model exceeded 180-second deadline');
      controller.abort(error);
      reject(error);
    }, 180000);
  });
  const answer = await Promise.race([agent.generate(task, {
    maxSteps: 24, abortSignal: controller.signal, modelSettings: { temperature: 0 },
    onStepFinish: () => { steps += 1; log('step-finished', { steps }); },
  }), deadline]);
  clearTimeout(timer);
  controller.signal.throwIfAborted();
  finalMessage = String(answer.text ?? '');
  log('model-finished', { finalMessage, steps, calls, finishReason: answer.finishReason });
} catch (error) {
  failure = error;
  log('failure', { error: String(error) });
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  controller.abort(new Error('model run ended'));
  try { await desk?.close(); } catch (error) {
    failure ??= error;
    process.exitCode = 1;
    log('close-failure', { error: String(error) });
  }
  log('summary', { finalMessage, steps, calls, failed: Boolean(failure) });
}
// The oracle has fixture knowledge; the model driver never reads its answers.
try {
  const { stdout, stderr } = await promisify(execFile)(process.execPath,
    [fileURLToPath(new URL('./verify.mjs', import.meta.url)), run],
    { timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  log('oracle', { stdout, stderr });
} catch (error) {
  log('oracle-failure', { error: String(error), stdout: error.stdout, stderr: error.stderr });
  process.exitCode = 1;
}
