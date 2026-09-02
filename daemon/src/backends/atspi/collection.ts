import type { Role } from "@mastra-cc/protocol-types";

// The backend-selected search path (ADR-0042 amendment): one query tool, one
// response shape, two instruments underneath. When an application advertises
// the accessibility bus's Collection interface, a role-shaped question is
// asked in ONE exchange instead of walked node by node. When it does not -
// Qt/KDE applications observably do not - the bounded walk answers instead.
// Nothing about which instrument answered crosses the wire.

const COLLECTION = "org.a11y.atspi.Collection";
const ACCESSIBLE = "org.a11y.atspi.Accessible";

interface CollectionChannel {
  call(exchange: { destination: string; path: string; iface: string; member: string; signature?: string; body?: unknown[] }): Promise<unknown[]>;
}

export interface CollectionRef {
  busName: string;
  objectPath: string;
}

// The bus's role enum, owned here as DATA the same way the native-to-neutral
// role names are (B10). Read off the platform's own Atspi.Role enum on a live
// bus; platform vocabulary stops at this file.
const NATIVE_ROLE_IDS: Readonly<Record<Role, readonly number[]>> = {
  // The application root is the node Collection searches FROM, and GetMatches
  // answers with descendants only - so asking Collection for "application"
  // would omit the very node the walk returns. No fast path; take the walk.
  application: [],
  window: [23, 69],
  dialog: [16, 2, 19],
  button: [43, 62],
  checkbox: [7],
  label: [29],
  link: [88],
  list: [31, 98],
  listitem: [32],
  // Roles this backend's native-role table never produces have no native ids
  // to ask for, so they take the walk like "generic" does.
  grid: [],
  row: [],
  gridcell: [],
  menu: [33, 34],
  menuitem: [35],
  text: [61, 116],
  textbox: [79, 40],
  image: [27, 26],
  // "generic" is where every UNMAPPED native role lands, and a role id list
  // cannot express "anything this table does not name" - so a generic query
  // has no fast path and must be walked.
  generic: [],
};

// Whether a role question can be asked of Collection at all.
export function roleIsCollectable(role: Role): boolean {
  return NATIVE_ROLE_IDS[role].length > 0;
}

export async function advertisesCollection(channel: CollectionChannel, ref: CollectionRef): Promise<boolean> {
  const [interfaces] = await channel.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: ACCESSIBLE,
    member: "GetInterfaces",
  });
  return Array.isArray(interfaces) && interfaces.map(String).includes(COLLECTION);
}

// The bus does not carry a match rule's roles as a LIST of role ids; it
// carries them as a bitfield, one bit per role id, packed into 32-bit words -
// the same shape the platform's own match-rule constructor builds. Sending the
// ids themselves would silently ask for whatever roles those NUMBERS select as
// bit positions, which is a different question that still answers successfully.
export function roleBitfield(ids: readonly number[]): number[] {
  const words: number[] = [];
  for (const id of ids) {
    const word = Math.floor(id / 32);
    while (words.length <= word) words.push(0);
    // eslint-disable-next-line no-bitwise
    words[word] = (words[word] as number) | (1 << id % 32);
  }
  while (words.length < 4) words.push(0);
  return words;
}

// One exchange, every descendant of this application carrying ANY of the
// role's native ids (MATCH_ANY=2; MATCH_ALL would demand one node hold every
// id at once and answer nothing). The state, attribute and interface clauses
// are left EMPTY, and an empty clause is matched with MATCH_ALL=1 - matching
// all of nothing is vacuously true, so the clause constrains nothing. Zero is
// not that value: it is the enum's own INVALID member, which the matcher
// rejects, and a rule carrying it answers NO node for any role. Measured on a
// live bus, each of these four positions is independently fatal that way -
// including the sort order, CANONICAL=1, whose INVALID answers nothing too.
// Uncapped, traversing into embedded documents.
export async function matchByRole(channel: CollectionChannel, ref: CollectionRef, role: Role): Promise<CollectionRef[]> {
  const rule = [[0, 0], 1, [], 1, roleBitfield(NATIVE_ROLE_IDS[role]), 2, [], 1, false];
  const [matches] = await channel.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: COLLECTION,
    member: "GetMatches",
    signature: "(aiia{ss}iaiiasib)uib",
    body: [rule, 1, 0, true],
  });
  if (!Array.isArray(matches)) return [];
  return matches.flatMap((match) => {
    if (!Array.isArray(match)) return [];
    const busName = String(match[0] ?? "");
    const objectPath = String(match[1] ?? "");
    if (busName === "" || objectPath === "") return [];
    return [{ busName, objectPath }];
  });
}
