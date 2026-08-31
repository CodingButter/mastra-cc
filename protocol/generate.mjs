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

const pascal = (s) =>
  s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");

// The closed vocabularies: a field typed with one of these may hold nothing
// outside the list, and the list lives in the schema so that adding a value is
// a schema change that goes through the freeze gate. The table maps the
// schema's plural key to the emitted constant and type name; `base` is what a
// field spec writes as its type. Adding a vocabulary here is the ONLY thing a
// new closed enum needs - the emitted validator reads this table too, so a
// vocabulary can never be declared but left unchecked.
// An action NAME is deliberately absent from this table (schema version 1.4.0,
// ADR-0047): names are read off the element, so the set of them is the
// desktop's to decide and not ours to enumerate. What stayed closed is
// everything the daemon itself decides - roles, states, and the three ways a
// capability can be unavailable. Opening the name while closing the
// availability beside it is the whole design: a word we did not invent,
// answered by a verdict we did.
const VOCABULARIES = [
  { key: "roles", constant: "ROLES", type: "Role", base: "role" },
  { key: "states", constant: "STATES", type: "State", base: "state" },
  { key: "availabilityStates", constant: "AVAILABILITY_STATES", type: "AvailabilityState", base: "availabilityState" },
  { key: "operationNames", constant: "OPERATION_NAMES", type: "OperationName", base: "operationName" },
  { key: "capabilityNames", constant: "CAPABILITY_NAMES", type: "CapabilityName", base: "capabilityName" },
  { key: "priorities", constant: "PRIORITIES", type: "Priority", base: "priority" },
  { key: "changeKinds", constant: "CHANGE_KINDS", type: "ChangeKind", base: "changeKind" },
  { key: "attributions", constant: "ATTRIBUTIONS", type: "Attribution", base: "attribution" },
];

const vocabularyFor = (base) => VOCABULARIES.find((v) => v.base === base);

function tsType(spec) {
  if ("literal" in spec) return JSON.stringify(spec.literal);
  if ("literals" in spec) return spec.literals.map((value) => JSON.stringify(value)).join(" | ");
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

function emitType(name, spec) {
  if (spec.fields) return emitInterface(name, spec.fields);
  const variants = spec.variants.map((variant) => {
    const variantName = `${pascal(name)}${pascal(variant.name)}`;
    return { variantName, source: emitInterface(variantName, variant.fields) };
  });
  return `${variants.map(({ source }) => source).join("\n\n")}\n\nexport type ${pascal(name)} = ${variants.map(({ variantName }) => variantName).join(" | ")};`;
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
  parts.push(emitType(name, type));
  parts.push("");
}
for (const [method, spec] of Object.entries(schema.methods)) {
  parts.push(`/** ${spec.description} */`);
  parts.push(emitInterface(`${method}Params`, spec.params));
  parts.push("");
  parts.push(emitInterface(`${method}Result`, spec.returns));
  parts.push("");
}
function paramJsonSchema(spec) {
  const property = { description: spec.description };
  const vocabulary = vocabularyFor(spec.type);
  if (vocabulary) {
    property.type = "string";
    property.enum = schema[vocabulary.key];
  } else if (spec.type === "string" || spec.type === "number" || spec.type === "boolean") {
    property.type = spec.type === "boolean" ? "boolean" : spec.type;
  } else {
    throw new Error(`generate: no JSON Schema mapping for param type "${spec.type}"`);
  }
  if (spec.pattern === "idPattern") property.pattern = schema.idPattern;
  return property;
}

const methodDescriptors = Object.fromEntries(
  Object.entries(schema.methods).map(([method, spec]) => [
    method,
    {
      description: spec.description,
      params: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(spec.params).map(([field, field_spec]) => [field, paramJsonSchema(field_spec)]),
        ),
        required: Object.entries(spec.params)
          .filter(([, field_spec]) => field_spec.required === true)
          .map(([field]) => field),
        additionalProperties: false,
      },
    },
  ]),
);
parts.push(
  "/** Each method's description and a JSON Schema for its parameters, generated from the same schema the types come from. */",
);
parts.push(
  `export const METHOD_DESCRIPTORS: Record<MethodName, { description: string; params: Record<string, unknown> }> = ${JSON.stringify(
    methodDescriptors,
    null,
    2,
  )};`,
);
parts.push("");
const runtimeFieldSpecs = (fields) =>
  Object.fromEntries(
    Object.entries(fields).map(([field, spec]) => [
      field,
      {
        type: spec.type ?? null,
        literal: spec.literal ?? null,
        literals: spec.literals ?? null,
        required: spec.required === true,
        pattern: spec.pattern ?? null,
      },
    ]),
  );
parts.push(`const TYPE_SPECS = ${JSON.stringify(
  Object.fromEntries(
    Object.entries(schema.types).map(([name, type]) => [
      name,
      type.fields
        ? { fields: runtimeFieldSpecs(type.fields), variants: null }
        : {
            fields: null,
            variants: type.variants.map((variant) => ({
              name: variant.name,
              fields: runtimeFieldSpecs(variant.fields),
            })),
          },
    ]),
  ),
)} as const;`);
parts.push(`const VOCABULARY_VALUES: Record<string, readonly string[]> = ${JSON.stringify(
  Object.fromEntries(VOCABULARIES.map(({ base, key }) => [base, schema[key]])),
)};`);
parts.push(`
type FieldSpec = {
  type: string | null;
  literal: string | null;
  literals: readonly string[] | null;
  required: boolean;
  pattern: string | null;
};
type TypeName = keyof typeof TYPE_SPECS;

function problemsFor(typeName: TypeName, value: unknown): string[] {
  if (typeof value !== "object" || value === null) {
    return [\`\${String(typeName)}: not an object\`];
  }
  const record = value as Record<string, unknown>;
  const typeSpec = TYPE_SPECS[typeName];
  if (typeSpec.variants) {
    const variant = typeSpec.variants.find(({ fields }) =>
      Object.values(fields).some((field) => field.literal !== null && record.kind === field.literal),
    );
    if (!variant) return [\`\${String(typeName)}.kind: \${JSON.stringify(record.kind)} does not select a variant\`];
    const problems = fieldProblems(String(typeName), variant.fields as Record<string, FieldSpec>, record, true);
    if (typeName === "observableContent") problems.push(...observableContentProblems(record));
    return problems;
  }
  return fieldProblems(String(typeName), typeSpec.fields as Record<string, FieldSpec>, record, false);
}

function observableContentProblems(record: Record<string, unknown>): string[] {
  if (record.kind !== "text-window") return [];
  const problems: string[] = [];
  const integerFields = ["offset", "length", "totalLength", "startLine", "endLine", "totalLines"] as const;
  for (const field of integerFields) {
    const value = record[field];
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      problems.push(\`observableContent.\${field}: expected a safe integer\`);
    }
  }
  const offset = record.offset;
  const length = record.length;
  const totalLength = record.totalLength;
  const startLine = record.startLine;
  const endLine = record.endLine;
  const totalLines = record.totalLines;
  if (typeof offset === "number" && offset < 0) problems.push("observableContent.offset: must not be negative");
  if (typeof length === "number" && length < 0) problems.push("observableContent.length: must not be negative");
  if (typeof totalLength === "number" && totalLength < 0) problems.push("observableContent.totalLength: must not be negative");
  if (typeof record.value === "string" && typeof length === "number" && Array.from(record.value).length !== length) {
    problems.push("observableContent.length: must equal the Unicode-scalar length of value");
  }
  if (typeof offset === "number" && typeof length === "number" && typeof totalLength === "number" && offset + length > totalLength) {
    problems.push("observableContent: offset plus length exceeds totalLength");
  }
  if (typeof startLine === "number" && startLine < 1) problems.push("observableContent.startLine: must be at least one");
  if (typeof endLine === "number" && typeof startLine === "number" && endLine < startLine) problems.push("observableContent.endLine: must not precede startLine");
  if (typeof totalLines === "number" && typeof endLine === "number" && totalLines < endLine) problems.push("observableContent.totalLines: must not precede endLine");
  return problems;
}

function fieldProblems(typeName: string, specs: Record<string, FieldSpec>, record: Record<string, unknown>, exact: boolean): string[] {
  const problems: string[] = [];
  if (exact) {
    for (const field of Object.keys(record)) {
      if (!(field in specs)) problems.push(\`\${typeName}.\${field}: field is not valid for this variant\`);
    }
  }
  for (const [field, spec] of Object.entries(specs)) {
    const present = field in record && record[field] !== undefined;
    if (!present) {
      if (spec.required) problems.push(\`\${typeName}.\${field}: required field is missing\`);
      continue;
    }
    const v = record[field];
    if (spec.literal !== null && v !== spec.literal) {
      problems.push(\`\${typeName}.\${field}: expected \${JSON.stringify(spec.literal)}\`);
      continue;
    }
    if (spec.literals !== null && !spec.literals.includes(v as string)) {
      problems.push(\`\${typeName}.\${field}: \${JSON.stringify(v)} is not an allowed value\`);
      continue;
    }
    if (spec.type === null) continue;
    const base = spec.type.replace("[]", "");
    const isArray = spec.type.endsWith("[]");
    const values = isArray ? (Array.isArray(v) ? v : null) : [v];
    if (values === null) {
      problems.push(\`\${typeName}.\${field}: expected an array\`);
      continue;
    }
    for (const item of values) {
      if (base === "string" && typeof item !== "string") problems.push(\`\${typeName}.\${field}: expected a string\`);
      else if (base === "number" && typeof item !== "number") problems.push(\`\${typeName}.\${field}: expected a number\`);
      else if (base === "boolean" && typeof item !== "boolean") problems.push(\`\${typeName}.\${field}: expected a boolean\`);
      else if (base in VOCABULARY_VALUES && !VOCABULARY_VALUES[base].includes(item as string)) problems.push(\`\${typeName}.\${field}: \${JSON.stringify(item)} is not one of the \${base} values\`);
      else if (base in TYPE_SPECS) problems.push(...problemsFor(base as TypeName, item));
    }
    if (spec.pattern === "idPattern" && typeof v === "string" && !ID_PATTERN.test(v)) {
      problems.push(\`\${typeName}.\${field}: \${JSON.stringify(v)} does not match the id pattern\`);
    }
  }
  problems.push(...availabilityProblems(typeName, specs, record));
  return problems;
}

/**
 * The rule the field specs cannot express, enforced wherever an availability
 * appears: a thing withheld by configuration names the setting that withheld
 * it, and nothing else names a setting at all. This is what keeps the three
 * availability states from collapsing into each other. "Turned off by a
 * setting" and "never offered by the platform" look alike to a caller and are
 * opposites to anyone deciding what to do next: the first is a door with a
 * key, the second is a wall. A withheld thing with no setting named is an
 * unanswerable refusal, and an unexposed thing that names one invents a remedy
 * that does not exist.
 */
function availabilityProblems(typeName: string, specs: Record<string, FieldSpec>, record: Record<string, unknown>): string[] {
  if (!("availability" in specs)) return [];
  const problems: string[] = [];
  const withheld = record.availability === "disabled-by-configuration";
  const names = typeof record.disabledBy === "string" && record.disabledBy.length > 0;
  if (withheld && !names) problems.push(\`\${typeName}.disabledBy: an availability withheld by configuration must name the setting that withholds it\`);
  if (!withheld && record.disabledBy !== undefined) problems.push(\`\${typeName}.disabledBy: present on an availability of \${JSON.stringify(record.availability)} - only a configuration-withheld one names a setting\`);
  return problems;
}

/** Validate a semanticElement; returns an empty array when it conforms. */
export function validateSemanticElement(value: unknown): string[] {
  return problemsFor("semanticElement", value);
}

/** Validate one installedApplication as the listing reports it; returns an empty array when it conforms. */
export function validateInstalledApplication(value: unknown): string[] {
  return problemsFor("installedApplication", value);
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
    // The protocol's own version is this package's version: a consumer that
    // resolves @mastra-cc/protocol-types@1.6.1 is holding schema v1.6.1 and
    // nothing else. It is deliberately NOT the daemon's version (ADR-0057).
    version: schema.version,
    license: "MIT",
    publishConfig: { access: "public" },
    // This package carries runtime values as well as types - METHOD_NAMES,
    // TYPE_SPECS, METHOD_DESCRIPTORS - so it is compiled, and the entry point is
    // the compiled module. Pointing main at src/index.ts would work everywhere
    // in this workspace and nowhere in a consumer's node_modules, where node
    // will not strip types for a dependency.
    files: ["dist", "src"],
    type: "module",
    main: "./dist/index.js",
    // Declarations come from a real emit step: a consumer's dts bundler cannot reach into
    // a source file that belongs to no project, and TypeScript 7's tsgo refuses to try.
    types: "./dist/index.d.ts",
    description: "GENERATED from protocol/schema.json - do not edit (ADR-0009).",
    scripts: {
      build: "tsc -p tsconfig.json",
    },
    devDependencies: {
      // Without this the compiler is absent from this package's .bin path under pnpm's
      // isolated node_modules and the build script cannot run.
      typescript: "catalog:",
    },
  },
  null,
  2,
)}\n`;

const tsconfigJson = `${JSON.stringify(
  {
    compilerOptions: {
      rootDir: "src",
      outDir: "dist",
      declaration: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2022",
      strict: true,
      skipLibCheck: true,
    },
    include: ["src"],
  },
  null,
  2,
)}\n`;

mkdirSync(join(outDir, "src"), { recursive: true });
const emitted = [
  ["package.json", packageJson],
  ["tsconfig.json", tsconfigJson],
  [join("src", "index.ts"), `${indexTs}\n`],
];
for (const [relative, contents] of emitted) writeFileSync(join(outDir, relative), contents);
console.log(
  `generate: ${emitted.length} file(s) emitted to ${outDir} (schema v${schema.version}, digest ${digest.slice(0, 12)}...)`,
);
