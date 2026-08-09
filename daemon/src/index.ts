// M1 Phase 1 placeholder: the daemon package exists so the workspace pipelines
// have a real subject. The socket server and the accessibility backend land in
// Phases 3-4. What is here already true: M1's daemon implements no effect-class
// operation, so everything that is not `observe` is refused (docs/07-ROADMAP.md M1).
export const OBSERVE = "observe";

export function refusesScope(scope: string): boolean {
  return scope !== OBSERVE;
}
