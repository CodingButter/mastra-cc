import type { TransportClient } from "@mastra-cc/transport";

// The tool surface an agent is handed, MINTED for one session rather than
// imported as a module-level array (ADR-0007). There is no exported list of
// tools in this file - only a function that builds one, given a client and the
// capabilities that session actually holds. A module-level surface would be a
// surface every caller shares, and the first time two sessions wanted different
// capabilities one of them would be handed the other's.
//
// The daemon already refuses what a session may not do; this surface is a
// second, different thing. The daemon's gate answers "you asked and the answer
// is no". This decides what the agent can SEE to ask for. An agent that can see
// a door it may not open will try the door, put the refusal in its context, and
// reason about how to get through it - which is the behaviour ADR-0007's
// amendment A13 names: "a key an agent can present is a key an agent can be
// tricked into presenting". The same is true of a capability it can name.

export type Capability = "edit" | "activate" | "submit";

export interface Tool {
  readonly name: string;
  readonly description: string;
  /** which side of the read/act line this tool sits on - the reason it is in the mint */
  readonly kind: "observe" | Capability;
  execute(input: Record<string, unknown>): Promise<unknown>;
}

// The read-only floor. Every mint contains exactly these, and no capability
// adds to or removes from them: reading is what this daemon does by default
// (ADR-0007, "read-only by default"), and a session that could not read would
// have nothing to act on.
const OBSERVE_TOOLS = ["queryElements", "attestElement", "listApplications"] as const;

// Each effect verb, and the ONE capability that puts it in the surface. The
// mapping is the daemon's own effect-class split (ADR-0019) read from this
// side: a session holding "edit" sees the three writing verbs and does not see
// the two that commit.
const CAPABILITY_TOOLS: Record<Capability, readonly string[]> = {
  edit: ["editElement", "setElementValue", "setElementText", "setElementCaret"],
  activate: ["activateElement", "revealElement"],
  submit: ["submitElement"],
};

// A refusal reaches the agent in the daemon's own words. The daemon writes long,
// specific refusals naming the setting or the authority that produced them, and
// rewording one here would put the hub's voice over the daemon's measurement -
// the same mistake server.ts:650 refuses one rung down. The tool returns what
// the daemon said, byte for byte.
async function callDaemon(
  client: TransportClient,
  method: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const call = (client as unknown as Record<string, (p: unknown) => Promise<unknown>>)[method];
  return await call.call(client, input);
}

function toolFor(client: TransportClient, name: string, kind: Tool["kind"]): Tool {
  return {
    name,
    description: `${name} on the daemon`,
    kind,
    execute: (input) => callDaemon(client, name, input),
  };
}

export interface MintOptions {
  client: TransportClient;
  /**
   * The capabilities this session holds, decided at construction. Deliberately
   * not readable from a tool argument, an environment variable or a default:
   * every one of those is a channel the agent itself can reach, and a surface
   * an agent can widen is not a surface.
   */
  capabilities?: readonly Capability[];
  /**
   * Extra tools this deployment supplies. Present so a duplicate name has
   * somewhere to come FROM: the collision below is the point of the parameter.
   */
  extra?: readonly Tool[];
}

export function mintToolSurface(options: MintOptions): Map<string, Tool> {
  const { client, capabilities = [], extra = [] } = options;
  const surface = new Map<string, Tool>();
  const owner = new Map<string, string>();

  const add = (tool: Tool, from: string): void => {
    const held = owner.get(tool.name);
    // Naming BOTH sides, because "duplicate tool" tells an operator that
    // something collided and nothing about which two things collided. A silent
    // last-wins would be worse still: the surface would depend on construction
    // order, and an added tool could quietly replace a granted one.
    if (held !== undefined) {
      throw new Error(
        `hub: two tools are both named "${tool.name}" - ${held} and ${from} each supply one, and a surface cannot hold both`,
      );
    }
    owner.set(tool.name, from);
    surface.set(tool.name, tool);
  };

  for (const name of OBSERVE_TOOLS) add(toolFor(client, name, "observe"), "the read-only floor");
  // The TABLE is iterated, not the caller's list, so a capability named twice
  // grants once rather than colliding with itself - and so the check below is
  // one line that stands between an effect verb and the surface.
  for (const capability of Object.keys(CAPABILITY_TOOLS) as Capability[]) {
    if (!capabilities.includes(capability)) continue;
    for (const name of CAPABILITY_TOOLS[capability]) {
      add(toolFor(client, name, capability), `the "${capability}" capability`);
    }
  }
  for (const tool of extra) add(tool, "this deployment");

  return surface;
}
