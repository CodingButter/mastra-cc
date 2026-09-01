import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { METHOD_DESCRIPTORS } from "@mastra-cc/protocol-types";
import { describe, expect, it } from "vitest";
import { INSTRUCTIONS } from "../index.js";

// PROSE THAT NAMES A VERB THE PROTOCOL DOES NOT HAVE IS WORSE THAN NO PROSE.
//
// The instructions are read by a model that will do what they say. A sentence
// telling it to call `setText` when the method is `setElementText` does not
// degrade gracefully - it spends the agent's step budget on a tool that is not
// there, and the transcript blames the desktop. The instructions were written by
// hand from transcripts, and a renamed method would leave them behind silently,
// because nothing else in this repository reads them.
//
// The vocabulary is taken from the protocol itself - the method table and every
// property name and enum value in the schema - rather than listed here. A list
// written out in this file would be one more copy to drift.

const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../protocol/schema.json", import.meta.url)), "utf8"),
) as unknown;

/** Every property name and string enum value anywhere in the schema. */
function vocabularyOf(node: unknown, into: Set<string>): Set<string> {
  if (typeof node === "string") into.add(node);
  else if (Array.isArray(node)) for (const item of node) vocabularyOf(item, into);
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      into.add(key);
      vocabularyOf(value, into);
    }
  }
  return into;
}

const vocabulary = vocabularyOf(schema, new Set(Object.keys(METHOD_DESCRIPTORS)));

// Only camelCase tokens are checked. Single lowercase words in the prose are
// ordinary English as often as they are protocol nouns, and the failure this
// guards against - an invented or renamed verb - is camelCase every time.
const camelCase = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/;

const quoted = [...INSTRUCTIONS.matchAll(/`([a-zA-Z][a-zA-Z0-9_.]*)`/g)].map((match) => match[1]!);

describe("the literacy prose", () => {
  it("quotes identifiers at all", () => {
    // Guards the guard: prose that stopped naming anything would pass every
    // assertion below without checking a single word.
    expect(quoted.filter((token) => camelCase.test(token.split(".")[0]!)).length).toBeGreaterThan(5);
  });

  it("names only verbs and fields the protocol actually has", () => {
    const invented = [...new Set(quoted)]
      .flatMap((token) => token.split("."))
      .filter((part) => camelCase.test(part) && !vocabulary.has(part));
    expect(invented, `the instructions name ${invented.join(", ")}, which the protocol does not`)
      .toEqual([]);
  });

  it("still names the methods the errands proved an agent needs", () => {
    // The transcripts turned on these four specifically: finding elements,
    // reading them back after a write, opening what is not running, and the
    // submit that a form control does not advertise.
    for (const method of ["queryElements", "readElementContent", "listApplications", "submitElement"]) {
      expect(INSTRUCTIONS).toContain(`\`${method}\``);
    }
  });
});
