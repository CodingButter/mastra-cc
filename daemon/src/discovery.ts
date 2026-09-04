import { ROLES, type DiscoverElementsResult, type ElementDiscoveryEntry, type Role } from "@mastra-cc/protocol-types";

export interface DiscoveryMetadata {
  role: Role;
  name: string;
  actions: readonly string[];
  operations: readonly string[];
}

const roleOrder = new Map<Role, number>(ROLES.map((role, index) => [role, index]));

export function aggregateDiscovery(metadata: readonly DiscoveryMetadata[], limit: number): DiscoverElementsResult {
  const byKey = new Map<string, { entry: ElementDiscoveryEntry; actions: Set<string>; operations: Set<string> }>();
  for (const item of metadata) {
    const key = `${item.role}\0${item.name}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, {
        entry: { role: item.role, name: item.name, count: 1, actions: [], operations: [] },
        actions: new Set(item.actions),
        operations: new Set(item.operations),
      });
      continue;
    }
    existing.entry.count += 1;
    for (const action of item.actions) existing.actions.add(action);
    for (const operation of item.operations) existing.operations.add(operation);
  }

  const entries = [...byKey.values()].map(({ entry, actions, operations }) => ({
    ...entry,
    actions: [...actions].sort(),
    operations: [...operations].sort(),
  }));
  entries.sort((left, right) =>
    (roleOrder.get(left.role) ?? Number.MAX_SAFE_INTEGER) - (roleOrder.get(right.role) ?? Number.MAX_SAFE_INTEGER) ||
    (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
  );
  return { entries: entries.slice(0, limit), truncated: entries.length > limit };
}
