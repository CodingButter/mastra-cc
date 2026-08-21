import { connect } from "@mastra-cc/transport";

export { type Capability, mintToolSurface, type Tool } from "./tools/mint.js";
export { type HubActivity, type ObservedElement, STRIPPED_KEYS, type StrippedObservation, strippedView } from "./memory/stripped.js";
export { announce, bootSubconscious } from "./memory/subconscious.js";
export {
  type CredentialStore,
  type ModelConfiguration,
  PROVIDERS,
  type Provider,
  type Resolution,
  resolveModel,
  type ResolvedModel,
} from "./models/configure.js";

// The hub: calls the daemon through packages/transport and prints the
// result. Nothing else (docs/07-ROADMAP.md:88 - "apps/hub calling through
// transport and printing the result"). --query lists elements; --open asks
// the daemon to open an application by name (M2.1) and prints the element it
// became, or the daemon's refusal, verbatim.

export function formatElement(role: string, name: string, id: string): string {
  return `element: role=${role} name="${name}" id=${id}`;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

export async function run(args: string[], print: (line: string) => void): Promise<number> {
  const name = flag(args, "--query");
  const openName = flag(args, "--open");
  const socketPath = flag(args, "--socket");

  const client = await connect({ socketPath });
  try {
    if (openName !== undefined) {
      const { application, refusal } = await client.openApplication({ name: openName });
      if (application !== undefined) {
        print(`application: role=${application.role} name=${JSON.stringify(application.name)} id=${application.id}`);
        return 0;
      }
      print(`hub: ${refusal ?? "the daemon answered with neither an application nor a refusal"}`);
      return 1;
    }
    const { elements } = await client.queryElements(name === undefined ? {} : { name });
    if (elements.length === 0) {
      print(`hub: no element matched ${JSON.stringify(name ?? "(everything)")}`);
      return 1;
    }
    for (const element of elements) {
      print(formatElement(element.role, element.name, element.id));
    }
    return 0;
  } finally {
    client.close();
  }
}
