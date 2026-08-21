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
// So: the operator's three parts are handed to Memory, which is the thing that
// validates them, and the hub reports what came back. Review caught an earlier
// version of this function checking the three parts and then calling
// `new Subconscious()` with none of them - a presence check followed by a
// construction that could not have used what was checked. That is the silent
// no-op this comment was already complaining about, written by the person
// complaining.

import { Memory, Subconscious } from "@mastra/memory";

export interface SubconsciousStorage {
  /** where knowledge is written. `@mastra/core`'s FilesystemStore is one; a database store is another. */
  readonly storage: unknown;
  /** the semantic index the subconscious requires. Without it, @mastra/memory refuses at construction. */
  readonly vector: unknown;
  /** what turns text into vectors. Also required. */
  readonly embedder: unknown;
}

export type SubconsciousState =
  | { readonly on: true; readonly memory: Memory; readonly subconscious: Subconscious }
  | { readonly on: false; readonly reason: string };

/**
 * The one place the OFF sentence is built, so it is grammatical for one missing
 * part as well as three. Review found the previous version telling an operator
 * who forgot only the vector index that the hub "was given neither" - wrong, and
 * wrong on the likeliest real deployment.
 */
function nameThem(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;
}

/**
 * What the hub says about its own memory at boot. Not a log line the operator
 * might have filtered out - a value the caller has to look at.
 *
 * The parts are not merely counted: they are passed to Memory, which refuses
 * construction when the subconscious cannot be backed. Constructing a
 * Subconscious directly would sidestep exactly that validation, which is why
 * this function does not.
 */
export function bootSubconscious(store: Partial<SubconsciousStorage> | undefined): SubconsciousState {
  const missing = (["storage", "vector", "embedder"] as const).filter((part) => store?.[part] === undefined);
  if (missing.length > 0) {
    return {
      on: false,
      reason: `the subconscious is OFF: it needs ${nameThem(missing)}, and this hub was given ${
        missing.length === 1 ? "no such thing" : "none of those"
      } - nothing is being remembered, and nothing will be`,
    };
  }
  const subconscious = new Subconscious();
  try {
    const memory = new Memory({
      storage: store!.storage as never,
      vector: store!.vector as never,
      embedder: store!.embedder as never,
      options: { observationalMemory: { experimental_subconscious: subconscious } },
    });
    return { on: true, memory, subconscious };
  } catch (error) {
    // @mastra/memory's own refusal, carried whole: it is the library's sentence
    // about the operator's own configuration, not a provider's prose about a
    // request, and an operator who cannot read it cannot fix the store.
    return {
      on: false,
      reason: `the subconscious is OFF: the memory this hub was given would not take it - ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** The sentence a caller prints. One place, so "off" is always said the same way. */
export function announce(state: SubconsciousState): string {
  return state.on ? "the subconscious is on" : `hub: ${state.reason}`;
}
