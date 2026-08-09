// M1 Phase 1 placeholder: the hub exists so the workspace pipelines have a real
// subject. In Phase 3 it calls the daemon through packages/transport and prints
// the result; this formatter is the shape it will print.
export function formatElement(role: string, name: string, id: string): string {
  return `${role} "${name}" (${id})`;
}
