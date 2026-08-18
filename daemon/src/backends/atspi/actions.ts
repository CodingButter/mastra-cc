import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Action, Diagnostic } from "@mastra-cc/protocol-types";
import { UnrecordedExchangeError } from "./channel.js";

// Reading the verbs an element publishes, off the element (ADR-0043,
// ADR-0045). Nothing in this file decides WHAT an element can do; it asks,
// and carries the answer through unnormalised. The table this replaced said
// a button could be "pressed" - a word no application on this machine has
// ever published.

const ACTION_IFACE = "org.a11y.atspi.Action";
const ACCESSIBLE_IFACE = "org.a11y.atspi.Accessible";

// A minimal view of the channel seam: every exchange goes through call(), so
// capture and replay both see the action reads (daemon/src/backends/atspi/channel.ts).
interface CallSeam {
  call(exchange: { destination: string; path: string; iface: string; member: string; signature?: string; body?: unknown[] }): Promise<unknown[]>;
}

// Pin B10's deny-list, read from the pin's own file rather than copied: a
// second copy is a second truth that drifts (amendment A2, ADR-0047 clause 3).
function denyList(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (;;) {
    const candidate = join(dir, "tools", "pins", "deny-list.json");
    try {
      return JSON.parse(readFileSync(candidate, "utf8")) as string[];
    } catch {
      const parent = dirname(dir);
      if (parent === dir) throw new Error("action reader: no deny-list above this module - refusing to guess platform vocabulary");
      dir = parent;
    }
  }
}

const DENY_LIST = denyList();

// ADR-0047 clause 3: an application is free to publish an action named after
// its toolkit, and when it does the name is carried VERBATIM - dropping it
// makes a real affordance invisible and renaming it makes a call name a verb
// the element will not answer to. The check reports; it does not rewrite.
// Substring, not B10's word boundary: "gtkClick" is the case the decision
// names, and a word-boundary match would miss exactly that example.
export function deniedTermsIn(name: string): string[] {
  const lowered = name.toLowerCase();
  return DENY_LIST.filter((term) => lowered.includes(term));
}

// The namespaced keys this reader records. The Diagnostic type names only the
// two fields the schema declares; namespaced keys travel beside them exactly
// as the ADR-0040 route stamp does (roles.ts), inside the subtree that is B10's
// single sanctioned exemption.
export type ActionDiagnostic = Diagnostic & Record<string, string>;

export interface PublishedActions {
  actions: Action[];
  // Measurements about the read itself, destined for the diagnostic subtree -
  // the one sanctioned home for non-neutral vocabulary (B10).
  diagnostic?: ActionDiagnostic;
}

// What a failed read is allowed to say. The D-Bus error NAME
// (org.freedesktop.DBus.Error.Failed) is what a reader matches on, so it is
// carried whole; the free-text message is the part that can run long and is
// the part that gets truncated.
function describeError(error: unknown): string {
  const raw = String((error as Error)?.message ?? error);
  const match = raw.match(/org\.[A-Za-z0-9_.]*Error\.[A-Za-z0-9_]+/);
  return match === null ? raw.slice(0, 200) : `${match[0]} ${raw.slice(0, 200)}`;
}

function decodeBulk(rows: unknown): Array<{ name: string; description: string }> {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const cells = row as unknown[];
    return { name: String(cells?.[0] ?? ""), description: String(cells?.[1] ?? "") };
  });
}

// The whole reader. The bulk reply is the COUNT and the description source;
// the per-index name is the answer (main plan finding 5: 10 of 263 elements
// answered bulk with all-empty names while GetName(index) named them, and the
// bulk reply carries display wording - "Click" where the element's own word is
// "click"). Where the two disagree the per-index name wins and the
// disagreement is recorded, never silently resolved (ADR-0045 clause 6).
export async function readPublishedActions(
  channel: CallSeam,
  ref: { busName: string; objectPath: string },
): Promise<PublishedActions> {
  // Pre-flight, and the reason this reader never asks a question the element
  // cannot answer. Measured at baseline: Accessible.GetInterfaces answered on
  // 721 of 721 elements without a single error, and its verdict agreed with
  // GetActions in both directions every time - 36 elements listed the action
  // interface and 36 answered. Asking it first means an element without the
  // interface is never asked for actions, so a capture records no failed call
  // and a replay of that capture makes the identical decision from the tape.
  // Without it, an element that errors live becomes an UNRECORDED exchange on
  // replay, and the only ways out are to relax replay's refusal (nailed shut
  // deliberately - see the mutation that pins it) or to invent an answer.
  let interfaces: string[];
  try {
    const [listed] = await channel.call({
      destination: ref.busName,
      path: ref.objectPath,
      iface: ACCESSIBLE_IFACE,
      member: "GetInterfaces",
    });
    interfaces = Array.isArray(listed) ? listed.map(String) : [];
  } catch (error) {
    // The 721-of-721 sample says this call does not error. A sample is not a
    // proof, and gnome-shell demonstrably errors on OTHER Accessible calls, so
    // the failure has a home: an element that cannot say which interfaces it
    // carries publishes no actions AND says why. Letting the error escape would
    // delete the whole element from the answer at the walk's catch - a reader
    // that cannot list its verbs would become a reader nobody can see.
    if (error instanceof UnrecordedExchangeError) throw error;
    return { actions: [], diagnostic: { "mastra-cc/actions-unreadable": describeError(error) } };
  }
  if (!interfaces.includes(ACTION_IFACE)) return { actions: [] };

  let rows: Array<{ name: string; description: string }>;
  try {
    const [reply] = await channel.call({
      destination: ref.busName,
      path: ref.objectPath,
      iface: ACTION_IFACE,
      member: "GetActions",
    });
    rows = decodeBulk(reply);
  } catch (error) {
    // Measured at baseline: some applications answer this with a D-Bus error
    // (gnome-shell, gsd-keyboard). An element that cannot be asked publishes
    // NO actions - which is not the same as an element that was asked and
    // published none, so the distinction is recorded rather than flattened.
    // Rethrown errors (an off-tape replay read) are the caller's business.
    if (error instanceof UnrecordedExchangeError) throw error;
    return { actions: [], diagnostic: { "mastra-cc/actions-unreadable": describeError(error) } };
  }

  const actions: Action[] = [];
  const disagreements: string[] = [];
  const denied: string[] = [];

  const unnamed: string[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const bulk = rows[index] as { name: string; description: string };
    let reply: unknown;
    try {
      [reply] = await channel.call({
        destination: ref.busName,
        path: ref.objectPath,
        iface: ACTION_IFACE,
        member: "GetName",
        signature: "i",
        body: [index],
      });
    } catch (error) {
      // The element counted this action but will not name it. The bulk cell
      // holds display wording, never the word a call names (finding 5), so
      // there is nothing here that could be performed - the action is dropped
      // and its absence is stated. The alternatives are worse: publishing the
      // display form invents a verb the element will not answer to, and
      // letting the error escape deletes the entire element from the answer.
      if (error instanceof UnrecordedExchangeError) throw error;
      unnamed.push(`${index}:${describeError(error)}`);
      continue;
    }
    const name = String(reply ?? "");
    if (bulk.name !== name) disagreements.push(`${index}:${JSON.stringify(bulk.name)}!=${JSON.stringify(name)}`);
    const hits = deniedTermsIn(name);
    if (hits.length > 0) denied.push(`${JSON.stringify(name)}:${hits.join(",")}`);
    actions.push({
      name,
      // MEASURED, and not yet fully answered here. A GTK button with
      // sensitivity off still enumerates its actions: a probe on this machine
      // found an insensitive button publishing ["click"] while its state set
      // carried neither `enabled` nor `sensitive`. So "available" is, for that
      // element, a claim the platform contradicts.
      //
      // It is not corrected by picking a different word from the closed three:
      // the element DID publish the verb, so it is not `not-exposed`, and no
      // setting of ours turned it off, so it is not `disabled-by-configuration`
      // - naming a setting that does not exist is the false-remedy failure
      // ADR-0042 exists to kill. The missing state is "the application itself
      // disabled it", and inventing it here is a schema change this segment is
      // not allowed to make.
      //
      // What saves the caller meanwhile: the fact is not lost. The element
      // carries its own `states`, and an insensitive control answers without
      // `enabled` right beside this list. Segment 3 owns the meaning of the
      // three action states (03-existence-is-readable.md) and closes this.
      availability: "available",
      ...(bulk.description !== "" ? { description: bulk.description } : {}),
      // The bulk reply's wording is display wording when it differs from the
      // element's own word - exactly what localizedName is for (ADR-0045
      // clause 2). Carried, never substituted for the name.
      ...(bulk.name !== "" && bulk.name !== name ? { localizedName: bulk.name } : {}),
    });
  }

  const diagnostic: ActionDiagnostic = {};
  if (unnamed.length > 0) diagnostic["mastra-cc/action-name-unreadable"] = unnamed.join(" ");
  if (disagreements.length > 0) diagnostic["mastra-cc/action-name-disagreement"] = disagreements.join(" ");
  if (denied.length > 0) diagnostic["mastra-cc/action-name-platform-term"] = denied.join(" ");
  return { actions, ...(Object.keys(diagnostic).length > 0 ? { diagnostic } : {}) };
}
