import { connect } from "@mastra-cc/transport";

// The hub: calls queryElements through packages/transport and prints the
// result. Nothing else (docs/07-ROADMAP.md:88 - "apps/hub calling through
// transport and printing the result").

export function formatElement(role: string, name: string, id: string): string {
  return `element: role=${role} name="${name}" id=${id}`;
}

export async function run(args: string[], print: (line: string) => void): Promise<number> {
  const queryIndex = args.indexOf("--query");
  const name = queryIndex >= 0 && args[queryIndex + 1] ? args[queryIndex + 1] : undefined;
  const socketIndex = args.indexOf("--socket");
  const socketPath = socketIndex >= 0 && args[socketIndex + 1] ? args[socketIndex + 1] : undefined;

  const client = await connect({ socketPath });
  try {
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
