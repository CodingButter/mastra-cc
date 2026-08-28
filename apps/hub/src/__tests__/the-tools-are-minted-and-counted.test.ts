import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { registry, startServer } from "@mastra-cc/daemon";
import { connect, type TransportClient } from "@mastra-cc/transport";
import { mintToolSurface, type Tool } from "../tools/mint.js";

// What a session may SEE, which is a different question from what the daemon
// will allow. These tests assert the surface's exact membership rather than the
// presence of the tools they care about: a surface that grew a verb nobody
// decided to add would pass every membership check ever written, and the whole
// mechanism by which "read-only by default" survives a year is that adding a
// tool is a red build until someone edits a list on purpose.

const READ_ONLY = ["queryElements", "attestElement", "listApplications"];

const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-mint-")), "daemon.sock");
const serverPromise = startServer({
  socketPath,
  backend: registry.replay({ visibility: "all" }),
  // No effect authority: this session may read and nothing else, so the
  // refusal test below measures a real gate rather than a staged one.
  launch: { permits: new Set(), catalog: {}, table: undefined as never, allows: new Set() } as never,
});
let client: TransportClient | undefined;

async function connected(): Promise<TransportClient> {
  await serverPromise;
  client ??= await connect({ socketPath });
  return client;
}

afterAll(async () => {
  client?.close();
  (await serverPromise).close();
});

function names(surface: ReadonlyMap<string, Tool>): string[] {
  return [...surface.keys()].sort();
}

describe("the tool surface is minted for a session and its list is asserted", () => {
  it("a default mint holds exactly the read-only verbs - the set, not a sample of it", async () => {
    const surface = mintToolSurface({ client: await connected() });
    expect(names(surface)).toEqual([...READ_ONLY].sort());
  });

  it("an ungranted effect verb is ABSENT, not present and refusing", async () => {
    const surface = mintToolSurface({ client: await connected() });
    // Absent, because a door an agent can see is a door an agent will try. The
    // daemon would refuse the call; the point is that the agent never learns
    // there was something to call.
    expect(surface.has("editElement")).toBe(false);
    expect(surface.get("editElement")).toBeUndefined();
    expect([...surface.values()].every((t) => t.kind === "observe")).toBe(true);
  });

  it("a capability adds exactly its own verbs and nothing else's", async () => {
    const surface = mintToolSurface({ client: await connected(), capabilities: ["edit"] });
    expect(names(surface)).toEqual(
      [...READ_ONLY, "editElement", "setElementValue", "setElementText", "setElementCaret"].sort(),
    );
    // Holding one class does not grant another: the classes are separate
    // authorities on the daemon's side, and the surface reads the same split.
    expect(surface.has("submitElement")).toBe(false);
    expect(surface.has("activateElement")).toBe(false);
  });

  it("every capability's list is enumerated, not only the floor's", async () => {
    // The three tests above pin the floor and the edit list. Without this one,
    // ten verbs live in the capability table and only four are ever asserted as
    // a SET: a verb appended to the activate or submit row would be a green
    // build, which is the exact hole the enumeration claim exists to close.
    const activate = mintToolSurface({ client: await connected(), capabilities: ["activate"] });
    expect(names(activate)).toEqual([...READ_ONLY, "activateElement", "revealElement"].sort());

    const submit = mintToolSurface({ client: await connected(), capabilities: ["submit"] });
    expect(names(submit)).toEqual([...READ_ONLY, "submitElement"].sort());

    // And the whole table at once, so the surface's largest possible shape is
    // written down somewhere a reader can count.
    const everything = mintToolSurface({
      client: await connected(),
      capabilities: ["edit", "activate", "submit"],
    });
    expect(names(everything)).toEqual(
      [
        ...READ_ONLY,
        "editElement",
        "setElementValue",
        "setElementText",
        "setElementCaret",
        "activateElement",
        "revealElement",
        "submitElement",
      ].sort(),
    );
  });

  it("every minted tool sits under the capability the daemon classifies it as", async () => {
    // THE TWO SIDES ARE PINNED TO EACH OTHER, not each to itself. The hub's
    // table says it is "the daemon's own effect-class split read from this
    // side" - a claim nothing checked. Move a method between classes in the
    // daemon and this hub would go on granting it under the old capability,
    // silently, with every test on both sides green.
    //
    // The daemon's DISPATCH is read from source because it is the enforcement
    // itself, not a description of it; b11.mjs already reads the same table the
    // same way, and the one-entry-per-line rule it depends on is what makes
    // this parse honest.
    const dispatch = readFileSync(join(__dirname, "..", "..", "..", "..", "daemon", "src", "server.ts"), "utf8");
    const classified = new Map<string, string>();
    for (const line of dispatch.split("\n")) {
      const entry = /^\s{2}(\w+): \{ effectClass: "(\w+)"/.exec(line);
      if (entry !== null) classified.set(entry[1]!, entry[2]!);
    }
    expect(classified.size, "the daemon's dispatch table did not parse - this check would pass forever").toBe(14);

    const surface = mintToolSurface({
      client: await connected(),
      capabilities: ["edit", "activate", "submit"],
    });
    for (const tool of surface.values()) {
      expect(classified.get(tool.name), `${tool.name} is in the surface and not in the daemon's dispatch`).toBe(
        tool.kind,
      );
    }
  });

  it("two tools with one name throw at mint, and the error names both owners", async () => {
    const collide = (): unknown =>
      mintToolSurface({
        client: undefined as never,
        extra: [
          { name: "queryElements", description: "a second one", kind: "observe", execute: async () => undefined },
        ],
      });
    expect(collide).toThrow(/two tools are both named "queryElements"/);
    // Both sides named. "Duplicate tool" tells an operator that something
    // collided and nothing about what to go and fix.
    expect(collide).toThrow(/the read-only floor/);
    expect(collide).toThrow(/this deployment/);
  });

  it("a daemon refusal reaches the caller byte-identical", async () => {
    const surface = mintToolSurface({ client: await connected(), capabilities: ["edit"] });
    const element = (await surface.get("queryElements")!.execute({ name: "OK" })) as {
      elements: { id: string }[];
    };
    expect(element.elements.length).toBeGreaterThan(0);

    const answer = (await surface.get("editElement")!.execute({
      id: element.elements[0]!.id,
      value: "whatever",
    })) as { refusal?: string };

    // The session holds no effect authority on the daemon side, so this is the
    // daemon's own scope-gate sentence - not a hub paraphrase of it, and not a
    // thrown error the hub invented.
    // The WHOLE sentence, not a fragment of it: "byte-identical" is the claim,
    // and a substring check would pass over a hub that trimmed the remedy off
    // the end - which is the half an operator actually needs.
    expect(answer.refusal).toBe(
      'refused by the scope gate: "editElement" is edit-class and this session holds no edit authority for any application - this session was started without that class, and only a session started with it can perform this method',
    );
  });
});
