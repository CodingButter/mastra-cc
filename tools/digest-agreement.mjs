import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// CI step 3: digest agreement. Every artifact that embeds a schema digest must
// embed THE digest of the schema on disk. In Phase 3 the daemon keys its
// socket on this digest and the transport refuses a mismatch at connect; this
// step keeps the committed golden fixtures (and the generated package, when
// present) honest about which schema they were cut from.
//
// Usage: node tools/digest-agreement.mjs [--root <dir>]

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const root = arg("--root") ?? fileURLToPath(new URL("..", import.meta.url));
const schemaDigest = createHash("sha256")
  .update(readFileSync(join(root, "protocol", "schema.json"), "utf8"))
  .digest("hex");

const artifacts = [join(root, "protocol", "golden", "src", "index.ts")];
const generated = join(root, "packages", "protocol-types", "src", "index.ts");
if (existsSync(generated)) artifacts.push(generated);

let problems = 0;
for (const artifact of artifacts) {
  let text = null;
  try {
    text = readFileSync(artifact, "utf8");
  } catch {
    console.error(`digest-agreement: ${artifact} is missing`);
    problems += 1;
    continue;
  }
  const declared = text.match(/SCHEMA_DIGEST = "([0-9a-f]{64})"/);
  if (!declared) {
    console.error(`digest-agreement: ${artifact} declares no schema digest`);
    problems += 1;
  } else if (declared[1] !== schemaDigest) {
    console.error(
      `digest-agreement: ${artifact} was cut from digest ${declared[1].slice(0, 12)}... but the schema on disk is ${schemaDigest.slice(0, 12)}...`,
    );
    problems += 1;
  }
}

if (problems > 0) {
  console.error(`digest-agreement: ${problems} problem(s)`);
  process.exit(1);
}
console.log(`digest-agreement: schema ${schemaDigest.slice(0, 12)}..., ${artifacts.length} artifact(s) agree`);
