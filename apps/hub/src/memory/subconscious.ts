// THE HUB'S SUBCONSCIOUS.
//
// Jamie: "we are utilizing the subconscious in the hub aswell. This will be
// important."
//
// The factory gates its subconscious on the storage it needs actually existing,
// plus an explicit flag, and that is the part worth copying: a subconscious with
// nowhere to write is a silent no-op, and a silent no-op is the failure mode
// this repository dislikes most. A hub that quietly remembers nothing will be
// asked, months later, why it forgot - and the answer will be that it never
// started.
//
// MEASURED at @mastra/memory@1.27.0, and recorded in the segment's progress
// file: `new Memory({ storage })` constructs, and adding
// `experimental_subconscious` to it throws
//
//   "Subconscious semantic knowledge requires a vector store. Pass a `vector`
//    option to Memory."
//
// and, past that, demands an embedder. No concrete vector store ships in the
// three dependencies this milestone is authorised to add - @mastra/core exports
// MastraVector as an abstract class and no implementation - so the store is
// something the operator supplies, not something this milestone can assume.
//
// So: the wiring is here, and it says what it is doing. It does not pretend.

import { Subconscious } from "@mastra/memory";

export interface SubconsciousStorage {
  /** where knowledge is written. `@mastra/core`'s FilesystemStore is one; a database store is another. */
  readonly storage: unknown;
  /** the semantic index the subconscious requires. Without it, @mastra/memory refuses at construction. */
  readonly vector: unknown;
  /** what turns text into vectors. Also required. */
  readonly embedder: unknown;
}

export type SubconsciousState =
  | { readonly on: true; readonly subconscious: Subconscious }
  | { readonly on: false; readonly reason: string };

/**
 * What the hub says about its own memory at boot. Not a log line the operator
 * might have filtered out - a value the caller has to look at.
 */
export function bootSubconscious(store: Partial<SubconsciousStorage> | undefined): SubconsciousState {
  const missing = (["storage", "vector", "embedder"] as const).filter((part) => store?.[part] === undefined);
  if (missing.length > 0) {
    return {
      on: false,
      reason: `the subconscious is OFF: it needs ${missing.join(", ")} and this hub was given ${
        missing.length === 3 ? "none of them" : "neither"
      } - nothing is being remembered, and nothing will be`,
    };
  }
  return { on: true, subconscious: new Subconscious() };
}

/** The sentence a caller prints. One place, so "off" is always said the same way. */
export function announce(state: SubconsciousState): string {
  return state.on ? "the subconscious is on" : `hub: ${state.reason}`;
}
