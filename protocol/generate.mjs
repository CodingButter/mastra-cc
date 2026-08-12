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

// The closed vocabularies: a field typed with one of these may hold nothing
// outside the list, and the list lives in the schema so that adding a value is
// a schema change that goes through the freeze gate. The table maps the
// schema's plural key to the emitted constant and type name; `base` is what a
// field spec writes as its type. Adding a vocabulary here is the ONLY thing a
// new closed enum needs - the emitted validator reads this table too, so a
// vocabulary can never be declared but left unchecked.
const VOCABULARIES = [
  { key: "roles", constant: "ROLES", type: "Role", base: "role" },
  { key: "states", constant: "STATES", type: "State", base: "state" },
  { key: "actions", constant: "ACTIONS", type: "ActionName", base: "action" },
  { key: "priorities", constant: "PRIORITIES", type: "Priority", base: "priority" },
  { key: "changeKinds", constant: "CHANGE_KINDS", type: "ChangeKind", base: "changeKind" },
  { key: "attributions", constant: "ATTRIBUTIONS", type: "Attribution", base: "attribution" },
];

const vocabularyFor = (base) => VOCABULARIES.find((v) => v.base === base);

function tsType(spec) {
  const base = spec.type.replace("[]", "");
  const array = spec.type.endsWith("[]") ? "[]" : "";
  if (base === "string" || base === "number" || base === "boolean") return base + array;
  const vocabulary = vocabularyFor(base);
  if (vocabulary) return vocabulary.type + array;
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
for (const { key, constant, type } of VOCABULARIES) {
  if (!Array.isArray(schema[key])) {
    throw new Error(`generate: the schema declares no "${key}" vocabulary, but the generator emits one from it`);
  }
  parts.push(`export const ${constant} = ${JSON.stringify(schema[key])} as const;`);
  parts.push(`export type ${type} = (typeof ${constant})[number];`);
}
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
      Object.fromEntries(
        Object.entries(type.fields).map(([f, s]) => [
          f,
          { type: s.type, required: s.required === true, pattern: s.pattern ?? null },
        ]),
      ),
    ]),
  ),
)} as const;`);
parts.push(`const VOCABULARY_VALUES: Record<string, readonly string[]> = ${JSON.stringify(
  Object.fromEntries(VOCABULARIES.map(({ base, key }) => [base, schema[key]])),
)};`);
parts.push(`
type FieldSpec = { type: string; required: boolean; pattern: string | null };

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
      else if (base === "boolean" && typeof item !== "boolean") problems.push(\`\${String(typeName)}.\${field}: expected a boolean\`);
      else if (base in VOCABULARY_VALUES && !VOCABULARY_VALUES[base].includes(item as string)) problems.push(\`\${String(typeName)}.\${field}: \${JSON.stringify(item)} is not one of the \${base} values\`);
      else if (base in FIELD_SPECS) problems.push(...problemsFor(base as keyof typeof FIELD_SPECS, item));
    }
    // A pattern named in the schema is enforced wherever it is named, not only
    // on the one type that happened to need it first.
    if (spec.pattern === "idPattern" && typeof v === "string" && !ID_PATTERN.test(v)) {
      problems.push(\`\${String(typeName)}.\${field}: \${JSON.stringify(v)} does not match the id pattern\`);
    }
  }
  return problems;
}

/** Validate a semanticElement; returns an empty array when it conforms. */
export function validateSemanticElement(value: unknown): string[] {
  return problemsFor("semanticElement", value);
}

/**
 * Validate a changeEvent; returns an empty array when it conforms. Beyond the
 * field specs it enforces the one rule the specs cannot express: a cause id is
 * present if and only if the change is attributed to this session.
 */
export function validateChangeEvent(value: unknown): string[] {
  const problems = problemsFor("changeEvent", value);
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const claimsSelf = record.attribution === "self";
  const hasCause = record.causeId !== undefined;
  if (claimsSelf && !hasCause) problems.push("changeEvent.causeId: a change attributed to self must name the call that caused it");
  if (!claimsSelf && hasCause) problems.push(\`changeEvent.causeId: present on a change attributed to \${JSON.stringify(record.attribution)} - only self carries a cause\`);
  return problems;
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
