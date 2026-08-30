import { createTool } from "@mastra/core/tools";
import { METHOD_DESCRIPTORS, METHOD_NAMES, type MethodName } from "@mastra-cc/protocol-types";
import type { TransportClient } from "@mastra-cc/transport";

// THE ADAPTER. @mastra/core is a PEER dependency and is imported only from this
// module, which is reachable only through the "@mastra-cc/desktop/mastra"
// subpath. The base entry point never touches it, so a runtime that has no
// agent framework installed can still install and import this package (C5).
//
// One tool per protocol method, and nothing else: no macro, no retry, no
// composite verb. Each tool's schema and description are GENERATED from
// protocol/schema.json (via METHOD_DESCRIPTORS) rather than written here, so a
// protocol change cannot leave a tool describing a surface that no longer
// exists. What the agent needs beyond the per-method description - sequencing,
// write-then-read, that a refusal is an answer - is the INSTRUCTIONS, which
// belong in the agent's prompt, not smeared across fourteen descriptions.

/** The text an agent must be given alongside these tools. Re-exported so a caller needs one import. */
export { INSTRUCTIONS } from "./index.js";

export type DesktopTools = Record<MethodName, ReturnType<typeof createTool>>;

/**
 * Build one Mastra tool per protocol method, bound to an already-open client.
 *
 * The client is dialled by the caller (`connect()` from the base entry) because
 * the lifetime of a connection is the caller's business: these tools do not
 * open, reopen or close one.
 *
 * A refusal from the daemon is returned as the daemon wrote it. Nothing here
 * inspects a result for a `refusal` field and turns it into a thrown error, or
 * softens its wording: the agent is supposed to read the refusal and decide.
 */
export function desktopTools(client: TransportClient): DesktopTools {
  const tools = {} as DesktopTools;
  for (const method of METHOD_NAMES) {
    const descriptor = METHOD_DESCRIPTORS[method];
    tools[method] = createTool({
      id: method,
      description: descriptor.description,
      inputSchema: descriptor.params,
      execute: async (input: unknown) => {
        const call = client[method] as (params: unknown) => Promise<unknown>;
        return await call.call(client, input ?? {});
      },
    });
  }
  return tools;
}
