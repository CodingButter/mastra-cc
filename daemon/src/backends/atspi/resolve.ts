import type { SemanticElement } from "@mastra-cc/protocol-types";

// Single-target resolution: the rule that must exist before anything ever
// acts. Ambiguity refuses and names EVERY candidate - it never takes the
// first match. Nothing found means look again (not-found is not proof of
// absence); two found means identity is unclear. Exposed to the operator via
// the daemon's one-shot --resolve flag; M2's effect-class operations resolve
// their targets through this same function.

export type Resolution = { element: SemanticElement } | { refusal: string };

export function resolveOne(candidates: SemanticElement[], query: string): Resolution {
  if (candidates.length === 0) {
    return { refusal: `nothing matched ${JSON.stringify(query)} - not found is not proof of absence; look again` };
  }
  if (candidates.length > 1) return { refusal: ambiguityRefusal(candidates, query) };
  return { element: candidates[0] };
}

function ambiguityRefusal(candidates: SemanticElement[], query: string): string {
  const named = candidates.map((c) => `${c.id} (${c.role} ${JSON.stringify(c.name)})`).join(", ");
  return `${candidates.length} elements match ${JSON.stringify(query)}: ${named} - identity is unclear, refusing to pick one`;
}
