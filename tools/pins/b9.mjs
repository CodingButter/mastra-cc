import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { collect, fail, rootFromArgs, stripComments } from "./lib.mjs";

// B9: transcription stays outside every client (docs/01-ARCHITECTURE.md:149,
// ADR-0005). Source and manifests are both checked because the prototype
// deleted its transcriber code while leaving the dependency installed.
const TRANSCRIBER_PACKAGES = [
  "@huggingface/transformers",
  "@xenova/transformers",
  "whisper-node",
  "nodejs-whisper",
  "whisper.cpp",
  "sherpa-onnx-node",
  "vosk",
  "@deepgram/sdk",
  "assemblyai",
];

const root = rootFromArgs(process.argv);
const files = collect(root, ["apps"], [".ts", ".js", ".mjs", ".cjs"])
  .filter((file) => !relative(root, file).startsWith(`${join("apps", "hub")}/`));

if (files.length === 0) fail("pin-b9: no files matched - the pin would pass vacuously");

const violations = [];
for (const file of files) {
  const path = relative(root, file);
  const source = stripComments(readFileSync(file, "utf8"), file);
  for (const name of TRANSCRIBER_PACKAGES) {
    if (source.includes(`"${name}"`) || source.includes(`'${name}'`)) {
      violations.push(`pin-b9: transcriber "${name}" imported by a client at ${path} (ADR-0005)`);
    }
  }
}

for (const app of new Set(files.map((file) => relative(root, file).split(/[\\/]/)[1]))) {
  const manifestPath = join(root, "apps", app, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail(`pin-b9: apps/${app}/package.json could not be read - the manifest half would pass vacuously`);
  }
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    if (TRANSCRIBER_PACKAGES.includes(name)) {
      violations.push(`pin-b9: transcriber "${name}" declared in apps/${app}/package.json - deleting code does not delete the dependency (ADR-0005)`);
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  process.exit(1);
}
console.log(`pin-b9: ok - ${files.length} client file(s), no transcriber in any client`);
