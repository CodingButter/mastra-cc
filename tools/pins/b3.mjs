import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { collect, fail, rootFromArgs, stripComments } from "./lib.mjs";

// B3: clients receive minted tokens; provider credentials never enter a client
// process (docs/01-ARCHITECTURE.md:143, ADR-0007). The hub is deliberately
// excluded because holding credentials and minting the narrower token is its job.
const CREDENTIAL_NAMES = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "ELEVENLABS_API_KEY",
];
const PROVIDER_PACKAGES = [
  "@anthropic-ai/sdk",
  "openai",
  "@google/genai",
  "@google/generative-ai",
  "@deepseek-ai/sdk",
  "elevenlabs",
];

const root = rootFromArgs(process.argv);
const files = collect(root, ["apps"], [".ts", ".js", ".mjs", ".cjs"])
  .filter((file) => !relative(root, file).startsWith(`${join("apps", "hub")}/`));

if (files.length === 0) fail("pin-b3: no files matched - the pin would pass vacuously");

const violations = [];
for (const file of files) {
  const path = relative(root, file);
  const source = stripComments(readFileSync(file, "utf8"), file);
  for (const name of CREDENTIAL_NAMES) {
    if (source.includes(name)) violations.push(`pin-b3: provider credential "${name}" referenced by a client at ${path} (ADR-0007)`);
  }
  for (const name of PROVIDER_PACKAGES) {
    if (source.includes(`"${name}"`) || source.includes(`'${name}'`)) {
      violations.push(`pin-b3: provider SDK "${name}" imported by a client at ${path} (ADR-0007)`);
    }
  }
}

for (const app of new Set(files.map((file) => relative(root, file).split(/[\\/]/)[1]))) {
  const manifestPath = join(root, "apps", app, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail(`pin-b3: apps/${app}/package.json could not be read - the manifest half would pass vacuously`);
  }
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    if (PROVIDER_PACKAGES.includes(name)) {
      violations.push(`pin-b3: provider SDK "${name}" declared in apps/${app}/package.json - a client holds no provider credential machinery (ADR-0007)`);
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(violation);
  process.exit(1);
}
console.log(`pin-b3: ok - ${files.length} client file(s), provider credentials remain in the hub`);
