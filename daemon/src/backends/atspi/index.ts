import type {
  AttestElementParams,
  AttestElementResult,
  QueryElementsParams,
  QueryElementsResult,
  SemanticElement,
} from "@mastra-cc/protocol-types";
import type { Backend } from "../../backend.js";
import { isVisible, type Visibility } from "../../grants.js";
import { type Channel, UnrecordedExchangeError } from "./channel.js";
import { deriveId } from "./identity.js";
import { nameMatches } from "./names.js";
import { actionsForRole, toNeutralRole, toNeutralStates } from "./roles.js";

// The real Linux accessibility backend. Reads the desktop's accessibility
// tree over plain D-Bus through the Channel seam - every exchange it performs
// is observable there, which is what makes capture (and Phase 5's replay)
// possible. All access is serialised by the daemon's server; this class never
// assumes concurrency.

const ACCESSIBLE = "org.a11y.atspi.Accessible";
const REGISTRY_DEST = "org.a11y.atspi.Registry";
const ROOT_PATH = "/org/a11y/atspi/accessible/root";
// The bus's "no such child" sentinel: live trees hand these out (a chat app
// on this machine listed one), and method calls on them fail. Not an element.
const NULL_PATH = "/org/a11y/atspi/null";

// Walk budgets: a live desktop hands over ~20 applications, some with very
// large trees. Per-application and global caps keep one query finite; both
// are policy of this backend, recorded here, not part of the wire contract.
const MAX_DEPTH = 10;
const MAX_NODES_PER_APP = 150;
const MAX_NODES_TOTAL = 2500;

interface NativeRef {
  busName: string;
  objectPath: string;
}

export class AtspiBackend implements Backend {
  readonly name = "atspi";
  private readonly channel: Channel;
  // The observe-visibility set (M2.3, ADR-0036): applications not in it are
  // ABSENT from every answer - their subtrees are never read. Deny-by-default
  // is this backend's own posture: when no visibility is given, nothing is.
  private readonly visibility: Visibility;
  // id -> native ref for every element this backend has answered; attestation
  // re-reads the element live rather than replaying a cached snapshot.
  private readonly answered = new Map<string, NativeRef>();

  constructor(channel: Channel, visibility: Visibility = new Set()) {
    this.channel = channel;
    this.visibility = visibility;
  }

  private async children(ref: NativeRef): Promise<NativeRef[]> {
    const [kids] = await this.channel.call({
      destination: ref.busName,
      path: ref.objectPath,
      iface: ACCESSIBLE,
      member: "GetChildren",
    });
    if (!Array.isArray(kids)) return [];
    return kids
      .map((kid) => {
        const pair = kid as [string, string];
        return { busName: String(pair[0]), objectPath: String(pair[1]) };
      })
      .filter((kid) => kid.objectPath !== NULL_PATH);
  }

  private async nameOf(ref: NativeRef): Promise<string> {
    const [raw] = await this.channel.call({
      destination: ref.busName,
      path: ref.objectPath,
      iface: "org.freedesktop.DBus.Properties",
      member: "Get",
      signature: "ss",
      body: [ACCESSIBLE, "Name"],
    });
    // dbus-native returns the variant either unwrapped (observed live on this
    // machine) or as a [signature, [value]] pair; accept both.
    if (Array.isArray(raw)) {
      const inner = raw[1];
      return Array.isArray(inner) ? String(inner[0] ?? "") : String(inner ?? "");
    }
    return String(raw ?? "");
  }

  private async nativeRoleOf(ref: NativeRef): Promise<string> {
    const [role] = await this.channel.call({
      destination: ref.busName,
      path: ref.objectPath,
      iface: ACCESSIBLE,
      member: "GetRoleName",
    });
    return String(role ?? "");
  }

  private async statesOf(ref: NativeRef): Promise<[number, number]> {
    const [states] = await this.channel.call({
      destination: ref.busName,
      path: ref.objectPath,
      iface: ACCESSIBLE,
      member: "GetState",
    });
    if (Array.isArray(states)) return [Number(states[0] ?? 0), Number(states[1] ?? 0)];
    return [0, 0];
  }

  private async readElement(ref: NativeRef): Promise<SemanticElement> {
    const nativeRole = await this.nativeRoleOf(ref);
    const name = await this.nameOf(ref);
    const [lower, upper] = await this.statesOf(ref);
    const { role, diagnostic } = toNeutralRole(nativeRole);
    const id = deriveId(role, ref.busName, ref.objectPath);
    this.answered.set(id, ref);
    return {
      id,
      role,
      name,
      states: toNeutralStates(lower, upper),
      actions: actionsForRole(role),
      ...(diagnostic !== undefined
        ? { diagnostic: { ...diagnostic, nativeId: `${ref.busName}${ref.objectPath}` } }
        : {}),
    };
  }

  async queryElements(params: QueryElementsParams): Promise<QueryElementsResult> {
    const elements: SemanticElement[] = [];
    let total = 0;

    const apps = await this.children({ busName: REGISTRY_DEST, objectPath: ROOT_PATH });
    for (const app of apps) {
      // The visibility gate (ADR-0036). The application's NAME is the one
      // permitted read of an ungranted application - you cannot decide
      // visibility without it - and it is read BEFORE readElement, so an
      // ungranted application's subtree is never walked, its states never
      // read, its element never answered.
      try {
        if (!isVisible(this.visibility, await this.nameOf(app))) continue;
      } catch (error) {
        // an off-tape read under replay is ignorance, and ignorance surfaces
        // as a refusal - never a skip; a dying app that cannot state its name
        // cannot be granted, so it is skipped like any dying node
        if (error instanceof UnrecordedExchangeError) throw error;
        continue;
      }
      // depth-first per application, in the order the bus lists them
      const stack: Array<{ ref: NativeRef; depth: number }> = [{ ref: app, depth: 0 }];
      let inThisApp = 0;
      while (stack.length > 0) {
        if (inThisApp >= MAX_NODES_PER_APP || total >= MAX_NODES_TOTAL) break;
        const { ref, depth } = stack.shift() as { ref: NativeRef; depth: number };
        inThisApp += 1;
        total += 1;

        // A node that stops answering mid-walk is skipped, not fatal: live
        // trees contain dying processes and dead references, and one of them
        // must not take down the whole query.
        try {
          const element = await this.readElement(ref);
          const roleMatches = params.role === undefined || element.role === params.role;
          const queryNameMatches = params.name === undefined || nameMatches(element.name, params.name);
          if (roleMatches && queryNameMatches) {
            elements.push(element);
            if (params.limit !== undefined && elements.length >= params.limit) return { elements };
          }
          if (depth < MAX_DEPTH) {
            const kids = await this.children(ref);
            stack.unshift(...kids.map((kid) => ({ ref: kid, depth: depth + 1 })));
          }
        } catch (error) {
          // ...but an off-tape read under replay is not a dying process, it is
          // ignorance, and ignorance surfaces as a refusal - never a skip.
          if (error instanceof UnrecordedExchangeError) throw error;
          continue;
        }
      }
    }
    return { elements };
  }

  async attestElement(params: AttestElementParams): Promise<AttestElementResult> {
    const ref = this.answered.get(params.id);
    if (ref === undefined) {
      return { refusal: `no element with id "${params.id}" was ever answered by this daemon - nothing to attest` };
    }
    try {
      // Re-read live; the id re-derives from the same bus name + path, so a
      // still-present element attests under the id it was answered with.
      const element = await this.readElement(ref);
      return { element };
    } catch (error) {
      if (error instanceof UnrecordedExchangeError) throw error;
      return { refusal: `element "${params.id}" no longer answers on the accessibility bus - it is gone; look again` };
    }
  }

  async close(): Promise<void> {
    await this.channel.close();
  }
}
