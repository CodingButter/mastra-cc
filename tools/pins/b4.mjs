import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { collect, fail, rootFromArgs, stripComments } from "./lib.mjs";

// B4: a client process may have at most one microphone consumer
// (docs/01-ARCHITECTURE.md:144). M5's widget calls the package-owned
// `createMicrophoneCapture` boundary; naming that boundary here keeps the pin
// attached to the selected runtime even though capture mechanics live outside
// the client source tree. The count is printed so zero cannot masquerade as a
// permanently green assertion whose output never changes when its first
// subject arrives.
const MICROPHONE_CONSUMER = /\b(?:getUserMedia|MediaRecorder|AudioWorklet|createMediaStreamSource|createMicrophoneCapture|node-record-lpcm16|naudiodon|portaudio|arecord)\b/g;

const root = rootFromArgs(process.argv);
const files = collect(root, ["apps"], [".ts", ".js", ".mjs", ".cjs"])
  .filter((file) => !relative(root, file).startsWith(`${join("apps", "hub")}/`));

if (files.length === 0) fail("pin-b4: no files matched - the pin would pass vacuously");

const consumers = [];
for (const file of files) {
  const source = stripComments(readFileSync(file, "utf8"), file);
  if (MICROPHONE_CONSUMER.test(source)) consumers.push(relative(root, file));
  MICROPHONE_CONSUMER.lastIndex = 0;
}

if (consumers.length > 1) {
  fail(`pin-b4: ${consumers.length} microphone consumers in one client process: ${consumers.join(", ")} (B4 requires at most one)`);
}
console.log(`pin-b4: ok - ${consumers.length} microphone consumer(s) across ${files.length} client file(s)`);
