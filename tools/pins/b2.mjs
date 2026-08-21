import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { collect, fail, rootFromArgs, stripComments } from "./lib.mjs";

// B2: the hub imports no audio API and holds no audio buffer
// (docs/01-ARCHITECTURE.md:142, ADR-0006). The subject is the hub package, and
// it exists as of M3 - which is why this pin is wired here and was honestly
// absent before.
//
// TWO HALVES, because docs/05-TEST-STRATEGY.md rule 3 demands it and the
// prototype is the reason: it deleted a transcriber's seven files and eighty
// megabytes and left the dependency declared. A source-only scan would have
// passed that tree while eighty megabytes of audio machinery sat in
// node_modules waiting for one import to bring it back.
//
//   Source half   - no audio API, no audio buffer type, no provider audio
//                   endpoint appears in the hub's own source.
//   Manifest half - apps/hub/package.json declares no audio dependency.
//
// The hub is allowed to name a live-audio MODEL, because naming the model a
// device will dial is the whole point of ADR-0006's arrangement: the hub says
// which model, the device carries the audio. So the banned tokens below are
// APIs and buffer types, not the word "audio".

const AUDIO_APIS = [
  "getUserMedia",
  "AudioContext",
  "webkitAudioContext",
  "MediaRecorder",
  "MediaStream",
  "AudioWorklet",
  "ScriptProcessorNode",
  "AudioBuffer",
  "createMediaStreamSource",
  "navigator.mediaDevices",
];

// Audio packages, by the names they actually ship under. A declared-but-
// unimported one passes a source scan and is exactly the shape that slipped
// through before.
const AUDIO_PACKAGES = [
  "node-speaker",
  "speaker",
  "mic",
  "node-record-lpcm16",
  "naudiodon",
  "audify",
  "web-audio-api",
  "wavefile",
  "node-wav",
  "@discordjs/opus",
  "opusscript",
  "sherpa-onnx-node",
  "whisper-node",
  "nodejs-whisper",
  "@xenova/transformers",
  "vosk",
  "portaudio",
];

const root = rootFromArgs(process.argv);
const files = collect(root, [join("apps", "hub")], [".ts", ".js", ".mjs", ".cjs"]);

// The vacuity guard. A pin over zero files passes without looking at anything,
// which is how a pin becomes a status update in costume. Removing this line is
// the mutation `b2-vacuous-guard-removed`.
if (files.length === 0) fail("pin-b2: no files matched - the pin would pass vacuously");

const violations = [];
for (const file of files) {
  // Comments stripped first: the ADR that bans a thing contains the word for
  // the thing, and so does the module explaining why the hub holds no audio.
  const source = stripComments(readFileSync(file, "utf8"), file);
  for (const api of AUDIO_APIS) {
    if (source.includes(api)) {
      violations.push(`pin-b2: audio API "${api}" in the hub at ${relative(root, file)} - audio never enters the hub process (ADR-0006)`);
    }
  }
  for (const name of AUDIO_PACKAGES) {
    if (source.includes(`"${name}"`) || source.includes(`'${name}'`)) {
      violations.push(`pin-b2: audio package "${name}" imported by the hub at ${relative(root, file)} (ADR-0006)`);
    }
  }
}

// THE MANIFEST HALF. Deleting code does not delete the dependency.
const manifestPath = join(root, "apps", "hub", "package.json");
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  // A missing manifest is not a pass. The hub declaring nothing because its
  // manifest is unreadable is the vacuous shape one level up from an empty
  // file set.
  fail("pin-b2: apps/hub/package.json could not be read - the manifest half would pass vacuously");
}
const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
for (const name of declared) {
  if (AUDIO_PACKAGES.includes(name)) {
    violations.push(`pin-b2: audio dependency "${name}" declared in apps/hub/package.json - a declared package is a package, imported or not (ADR-0006)`);
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  process.exit(1);
}
console.log(`pin-b2: ok - ${files.length} file(s) and ${declared.length} declared dependencies, no audio in the hub`);
