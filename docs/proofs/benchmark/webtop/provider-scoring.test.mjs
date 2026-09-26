import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// Exercise the harness's actual scoring loop without Docker or paid model calls.
const source = readFileSync(new URL("../bench-webtop.mjs", import.meta.url), "utf8");
const declaration = source.match(/^const PROVIDER_OUT = .+;$/m)?.[0];
const loop = source.slice(source.indexOf("deploy();\n"));
assert.ok(declaration);
assert.ok(loop.startsWith("deploy();"));

async function score(records, out = "/tmp/proof.jsonl") {
  const writes = [];
  let calls = 0;
  let exit;
  try {
    await runInNewContext(`(async () => { ${declaration}\n${loop} })()`, {
      OUT: out, RUNS: 1, ONLY: [], TASKS: { form: {} }, deploy() {},
      runOnce: async () => ({ ok: true, steps: 1, tokens: 2, refusals: [], ...records[calls++] }),
      appendFileSync: (path, line) => writes.push({ path, record: JSON.parse(line) }),
      sleep: async () => {}, console: { log() {}, error() {} },
      process: { exit(code) { exit = code; throw new Error("EXIT"); } },
    });
  } catch (error) {
    if (error.message !== "EXIT") throw error;
  }
  return { writes, calls, exit };
}

test("four provider refusals block completion without a scored result", async () => {
  const result = await score(Array(4).fill({ error: "402 credits depleted", ok: false }));
  assert.equal(result.exit, 2);
  assert.equal(result.calls, 4);
  assert.equal(result.writes.length, 4);
  assert.ok(result.writes.every(({ path, record }) => path === "/tmp/proof-provider-refused.jsonl" && record.infra === "provider"));
});

test("a normal answer mentioning quota or billing stays scored", async () => {
  const result = await score([{ answer: "The billing screen reports quota 429." }]);
  assert.equal(result.exit, 0);
  assert.equal(result.calls, 1);
  assert.equal(result.writes[0].path, "/tmp/proof.jsonl");
  assert.equal(result.writes[0].record.ok, true);
});

test("retried attempts follow the output basename and only success is scored", async () => {
  const result = await score([{ error: "503 high demand" }, { answer: "done" }], "/tmp/bench-webtop-a11y.jsonl");
  assert.equal(result.exit, 0);
  assert.equal(result.calls, 2);
  assert.equal(result.writes[0].path, "/tmp/bench-webtop-a11y-provider-refused.jsonl");
  assert.equal(result.writes[1].path, "/tmp/bench-webtop-a11y.jsonl");
  assert.equal(result.writes[1].record.attempts, 2);
});

test("non-provider errors remain scored failures", async () => {
  const result = await score([{ error: "element missing", ok: false }]);
  assert.equal(result.exit, 0);
  assert.equal(result.calls, 1);
  assert.equal(result.writes[0].path, "/tmp/proof.jsonl");
  assert.equal(result.writes[0].record.ok, false);
});
