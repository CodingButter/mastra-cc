import type {
  ActivateElementParams,
  ActivateElementResult,
  AttestElementParams,
  AttestElementResult,
  EditElementParams,
  EditElementResult,
  QueryElementsParams,
  QueryElementsResult,
  RevealElementParams,
  RevealElementResult,
  SemanticElement,
  SetElementCaretParams,
  SetElementCaretResult,
  SetElementTextParams,
  SetElementTextResult,
  SetElementValueParams,
  SetElementValueResult,
  SubmitElementParams,
  SubmitElementResult,
} from "@mastra-cc/protocol-types";
import {
  type Backend,
  type BackendChange,
  type BackendSubscription,
  type ChannelWatch,
  EffectUnsupportedError,
  mintSubscriptionId,
  UnknownSubscriptionError,
  UnperformableElementError,
  UnwatchableElementError,
} from "../../backend.js";
import {
  insertText,
  performAction,
  scrollIntoView,
  setCaretOffset,
  setTextContents,
  setValue,
} from "./effects.js";
import { isVisible, type Visibility } from "../../grants.js";
import { type Channel, UnrecordedExchangeError } from "./channel.js";
import { deriveId } from "./identity.js";
import type { AtspiWatchAnchor } from "./signal-stream.js";
import { nameMatches } from "./names.js";
import { readPublishedActions } from "./actions.js";
import { readPublishedOperations } from "./magnitudes.js";
import { stampVisibilityRoute, toNeutralRole, toNeutralStates } from "./roles.js";

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
  // id -> the name of the application whose subtree the element was read from.
  // A tree fact, recorded while the walk already knows it (the application's
  // name is read before its subtree is entered); the server needs it to decide
  // attribution and cannot derive it from an id.
  private readonly applicationOf = new Map<string, string>();
  // (busName, objectPath) -> the id and role the walk answered for it, so a
  // signal about an element the client has actually seen is reported under
  // the SAME id the walk gave it - never a second identity for the same node.
  private readonly byNative = new Map<string, { id: string; role: SemanticElement["role"] }>();
  // Live watches by subscription id. The channel is what feeds them.
  private readonly watches = new Map<string, ChannelWatch>();

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

  private async readElement(ref: NativeRef, application?: string): Promise<SemanticElement> {
    const nativeRole = await this.nativeRoleOf(ref);
    const name = await this.nameOf(ref);
    const [lower, upper] = await this.statesOf(ref);
    const { role, diagnostic } = toNeutralRole(nativeRole);
    // ADR-0043: the element publishes its own verbs. Asked here, through the
    // same call() seam as every other exchange, so capture records the action
    // reads and replay answers them from the tape.
    const published = await readPublishedActions(this.channel, ref);
    // ADR-0045 clause 4: the magnitudes an element carries are read the same
    // way, off the element, in the element's own units. An element that
    // publishes no range gets none here, and nothing downstream computes one.
    const magnitudes = await readPublishedOperations(this.channel, ref);
    const id = deriveId(role, ref.busName, ref.objectPath);
    this.answered.set(id, ref);
    this.byNative.set(`${ref.busName}\0${ref.objectPath}`, { id, role });
    if (application !== undefined) this.applicationOf.set(id, application);
    return {
      id,
      role,
      name,
      states: toNeutralStates(lower, upper),
      actions: published.actions,
      operations: magnitudes.operations,
      // ADR-0040: every answer names its instrument; the unmapped-role
      // diagnostic (ADR-0018 clause 3) and the action and magnitude readers'
      // own measurements merge in when present.
      diagnostic: stampVisibilityRoute({
        ...diagnostic,
        ...published.diagnostic,
        ...magnitudes.diagnostic,
        ...(diagnostic !== undefined ? { nativeId: `${ref.busName}${ref.objectPath}` } : {}),
      }),
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
      let applicationName: string;
      try {
        applicationName = await this.nameOf(app);
        if (!isVisible(this.visibility, applicationName)) continue;
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
          const element = await this.readElement(ref, applicationName);
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

  // A watch is only ever established on an element this backend has already
  // answered. An id it never answered may name an element that does not exist
  // or one inside an application this session cannot see - the same refusal
  // covers both, deliberately (ADR-0036).
  async subscribeElement(id: string, sink: (change: BackendChange) => void): Promise<BackendSubscription> {
    const ref = this.answered.get(id);
    if (ref === undefined) {
      throw new UnwatchableElementError(`no element with id "${id}" was ever answered by this daemon - nothing to watch`);
    }
    // The anchor: which bus connection owns the watched root (the sender
    // scope), and the walk's own book of answered nodes (so a change is
    // reported under the id the client already holds).
    const anchor: AtspiWatchAnchor = {
      busName: ref.busName,
      known: (busName, objectPath) => this.byNative.get(`${busName}\0${objectPath}`),
    };
    const watch = await this.channel.watch(id, sink, anchor);
    const subscriptionId = mintSubscriptionId();
    this.watches.set(subscriptionId, watch);
    return {
      subscriptionId,
      application: this.applicationOf.get(id) ?? "",
      close: async () => {
        this.watches.delete(subscriptionId);
        await watch.close();
      },
    };
  }

  // THE EFFECT HALF.
  //
  // Every verb below runs the same three steps in the same order, and the order
  // is the point: resolve the element this backend actually answered, perform
  // through an interface the element itself publishes, then RE-READ. The third
  // step is not politeness. Measured on this machine, the platform clamps an
  // out-of-bounds write, performs it somewhere else, and returns true; a window
  // move returns true and moves nothing. The return value is a claim. The
  // re-read is the evidence.
  private async performing<T>(id: string, effect: (ref: NativeRef) => Promise<void>): Promise<{ element: SemanticElement } & T> {
    const ref = this.answered.get(id);
    if (ref === undefined) {
      // Byte-identical to the refusal for an element that does not exist: an id
      // inside an application this session cannot see must not be told apart
      // from one that was never real (ADR-0008 rule 6, ADR-0036).
      throw new UnperformableElementError(
        `no element with id "${id}" was ever answered by this daemon - nothing to act on`,
      );
    }
    await effect(ref);
    return { element: await this.readElement(ref) } as { element: SemanticElement } & T;
  }

  async editElement(params: EditElementParams): Promise<EditElementResult> {
    return this.performing(params.id, (ref) => setTextContents(this.channel, ref, params.value));
  }

  async activateElement(params: ActivateElementParams): Promise<ActivateElementResult> {
    return this.performing(params.id, (ref) => performAction(this.channel, ref, params.action));
  }

  // Submit is the one verb this phase does not perform. The seam carries it so
  // no route is left abstract, and it refuses BY NAME rather than quietly
  // returning an unchanged element - a commit that silently did nothing and
  // then reported the world it failed to change is the worst possible answer.
  // The attestation half arrives with the phase that builds it.
  // The id is deliberately NOT looked up first. A verb that refuses one way for
  // an element it knows and another way for one it does not is an existence
  // oracle wearing an error class (ADR-0008 rule 6): the route-level refusal
  // comes first, so every caller hears the same sentence.
  async submitElement(_params: SubmitElementParams): Promise<SubmitElementResult> {
    throw new EffectUnsupportedError(
      "this route does not commit yet - the attestation this verb requires is not built, and committing without it is what the contract forbids",
    );
  }

  async setElementValue(params: SetElementValueParams): Promise<SetElementValueResult> {
    return this.performing(params.id, (ref) => setValue(this.channel, ref, params.value));
  }

  async setElementText(params: SetElementTextParams): Promise<SetElementTextResult> {
    return this.performing(params.id, (ref) =>
      params.offset === undefined
        ? setTextContents(this.channel, ref, params.text)
        : insertText(this.channel, ref, params.text, params.offset),
    );
  }

  async setElementCaret(params: SetElementCaretParams): Promise<SetElementCaretResult> {
    return this.performing(params.id, (ref) => setCaretOffset(this.channel, ref, params.offset));
  }

  async revealElement(params: RevealElementParams): Promise<RevealElementResult> {
    return this.performing(params.id, (ref) => scrollIntoView(this.channel, ref));
  }

  async unsubscribeElement(subscriptionId: string): Promise<void> {
    const watch = this.watches.get(subscriptionId);
    if (watch === undefined) {
      throw new UnknownSubscriptionError(`no watch on this backend is named "${subscriptionId}" - nothing to end`);
    }
    this.watches.delete(subscriptionId);
    await watch.close();
  }

  async close(): Promise<void> {
    // Closing the reader closes what it was watching: a watch outliving its
    // backend would be fed by a channel that is gone.
    for (const watch of this.watches.values()) await watch.close();
    this.watches.clear();
    await this.channel.close();
  }
}
