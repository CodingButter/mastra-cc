import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Reads protocol/schema.json and emits packages/protocol-types: TypeScript
// types, constants, and a runtime validator. The emitted package is BUILD
// OUTPUT and is git-ignored (ADR-0009) - what is committed is this generator
// and the golden fixtures in protocol/golden/ that its output is diffed
// against (CI step 1). Emission is deterministic: same schema bytes, same
// output bytes, no timestamps.
//
// Usage: node protocol/generate.mjs [--out <dir>] [--schema <file>]

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const root = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = arg("--schema", join(root, "protocol", "schema.json"));
const outDir = arg("--out", join(root, "packages", "protocol-types"));

const schemaText = readFileSync(schemaPath, "utf8");
const schema = JSON.parse(schemaText);
const digest = createHash("sha256").update(schemaText).digest("hex");

const pascal = (s) => s[0].toUpperCase() + s.slice(1);

function tsType(spec) {
  const base = spec.type.replace("[]", "");
  const array = spec.type.endsWith("[]") ? "[]" : "";
  if (base === "string" || base === "number" || base === "boolean") return base + array;
  if (base === "role") return "Role" + array;
  if (base === "state") return "State" + array;
  if (base === "action") return "ActionName" + array;
  return pascal(base) + array;
}

function emitInterface(name, fields) {
  const lines = [`export interface ${pascal(name)} {`];
  for (const [field, spec] of Object.entries(fields)) {
    lines.push(`  /** ${spec.description} */`);
    lines.push(`  ${field}${spec.required ? "" : "?"}: ${tsType(spec)};`);
  }
  lines.push("}");
  return lines.join("\n");
}

const parts = [];
parts.push("// GENERATED from protocol/schema.json - do not edit (ADR-0009).");
parts.push(`// ${schema.title} v${schema.version}`);
parts.push("");
parts.push(`export const PROTOCOL_VERSION = ${JSON.stringify(schema.version)};`);
parts.push(`export const SCHEMA_DIGEST = ${JSON.stringify(digest)};`);
parts.push(`export const ID_PATTERN = new RegExp(${JSON.stringify(schema.idPattern)});`);
parts.push(`export const ROLES = ${JSON.stringify(schema.roles)} as const;`);
parts.push("export type Role = (typeof ROLES)[number];");
parts.push(`export const STATES = ${JSON.stringify(schema.states)} as const;`);
parts.push("export type State = (typeof STATES)[number];");
parts.push(`export const ACTIONS = ${JSON.stringify(schema.actions)} as const;`);
parts.push("export type ActionName = (typeof ACTIONS)[number];");
parts.push(`export const METHOD_NAMES = ${JSON.stringify(Object.keys(schema.methods))} as const;`);
parts.push("export type MethodName = (typeof METHOD_NAMES)[number];");
parts.push("");
for (const [name, type] of Object.entries(schema.types)) {
  parts.push(`/** ${type.description} */`);
  parts.push(emitInterface(name, type.fields));
  parts.push("");
}
for (const [method, spec] of Object.entries(schema.methods)) {
  parts.push(`/** ${spec.description} */`);
  parts.push(emitInterface(`${method}Params`, spec.params));
  parts.push("");
  parts.push(emitInterface(`${method}Result`, spec.returns));
  parts.push("");
}
parts.push(`const FIELD_SPECS = ${JSON.stringify(
  Object.fromEntries(
    Object.entries(schema.types).map(([name, type]) => [
      name,
      Object.fromEntries(Object.entries(type.fields).map(([f, s]) => [f, { type: s.type, required: s.required === true }])),
    ]),
  ),
)} as const;`);
parts.push(`
type FieldSpec = { type: string; required: boolean };

function problemsFor(typeName: keyof typeof FIELD_SPECS, value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) {
    return [\`\${String(typeName)}: not an object\`];
  }
  const record = value as Record<string, unknown>;
  const specs = FIELD_SPECS[typeName] as Record<string, FieldSpec>;
  for (const [field, spec] of Object.entries(specs)) {
    const present = field in record && record[field] !== undefined;
    if (!present) {
      if (spec.required) problems.push(\`\${String(typeName)}.\${field}: required field is missing\`);
      continue;
    }
    const v = record[field];
    const base = spec.type.replace("[]", "");
    const isArray = spec.type.endsWith("[]");
    const values = isArray ? (Array.isArray(v) ? v : null) : [v];
    if (values === null) {
      problems.push(\`\${String(typeName)}.\${field}: expected an array\`);
      continue;
    }
    for (const item of values) {
      if (base === "string" && typeof item !== "string") problems.push(\`\${String(typeName)}.\${field}: expected a string\`);
      else if (base === "number" && typeof item !== "number") problems.push(\`\${String(typeName)}.\${field}: expected a number\`);
      else if (base === "role" && !(ROLES as readonly string[]).includes(item as string)) problems.push(\`\${String(typeName)}.\${field}: \${JSON.stringify(item)} is not a role\`);
      else if (base === "state" && !(STATES as readonly string[]).includes(item as string)) problems.push(\`\${String(typeName)}.\${field}: \${JSON.stringify(item)} is not a state\`);
      else if (base === "action" && !(ACTIONS as readonly string[]).includes(item as string)) problems.push(\`\${String(typeName)}.\${field}: \${JSON.stringify(item)} is not an action\`);
      else if (base in FIELD_SPECS) problems.push(...problemsFor(base as keyof typeof FIELD_SPECS, item));
    }
  }
  if (typeName === "semanticElement" && typeof record.id === "string" && !ID_PATTERN.test(record.id)) {
    problems.push(\`semanticElement.id: \${JSON.stringify(record.id)} does not match the id pattern\`);
  }
  return problems;
}

/** Validate a semanticElement; returns an empty array when it conforms. */
export function validateSemanticElement(value: unknown): string[] {
  return problemsFor("semanticElement", value);
}
`);

const indexTs = parts.join("\n");

const packageJson = `${JSON.stringify(
  {
    name: "@mastra-cc/protocol-types",
    version: schema.version,
    private: true,
    type: "module",
    main: "./src/index.ts",
    types: "./src/index.ts",
    description: "GENERATED from protocol/schema.json - do not edit (ADR-0009).",
  },
  null,
  2,
)}\n`;

mkdirSync(join(outDir, "src"), { recursive: true });
writeFileSync(join(outDir, "package.json"), packageJson);
writeFileSync(join(outDir, "src", "index.ts"), `${indexTs}\n`);
console.log(`generate: 2 file(s) emitted to ${outDir} (schema v${schema.version}, digest ${digest.slice(0, 12)}...)`);
