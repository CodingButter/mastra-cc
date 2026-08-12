import type {
  AttestElementParams,
  AttestElementResult,
  QueryElementsParams,
  QueryElementsResult,
  SemanticElement,
} from "@mastra-cc/protocol-types";
import {
  type Backend,
  type BackendChange,
  type BackendSubscription,
  type ChannelWatch,
  mintSubscriptionId,
  UnknownSubscriptionError,
  UnwatchableElementError,
} from "../../backend.js";
import { isVisible, type Visibility } from "../../grants.js";
import { deriveId } from "../atspi/identity.js";
import { nameMatches } from "../atspi/names.js";
import { type CdpChannel, replayCdpChannel } from "./channel.js";
import { actionsForRole, toNeutralRole, toNeutralStates } from "./roles.js";

// The browser backend: reads the page's own semantic tree over the browser's
// debugging protocol, through the CdpChannel seam - every exchange it performs
// is observable there, which is what makes capture and replay possible.
//
// Route asymmetry, recorded on purpose: this backend sees ONLY the browser at
// its endpoint. A user's own Chrome has no debug port and is invisible to it -
// which is the deny-by-default posture, not a limitation to engineer around.

// Walk budgets: policy of this backend, recorded here, not part of the wire
// contract - the same posture as the atspi backend's caps.
const MAX_NODES_PER_TARGET = 500;
const MAX_NODES_TOTAL = 2500;

interface VersionReply {
  readonly Browser?: string;
  readonly webSocketDebuggerUrl?: string;
}

interface ListedTarget {
  readonly id?: string;
  readonly type?: string;
}

interface AxNode {
  readonly nodeId?: string;
  readonly ignored?: boolean;
  readonly role?: { readonly value?: unknown };
  readonly name?: { readonly value?: unknown };
  readonly properties?: ReadonlyArray<{ readonly name?: string; readonly value?: { readonly value?: unknown } }>;
  readonly backendDOMNodeId?: number;
}

type NativeRef =
  | { readonly kind: "browser" }
  | { readonly kind: "node"; readonly targetId: string; readonly backendDOMNodeId?: number; readonly nodeId?: string };

// The application element's name is DERIVED from the version reply's Browser
// product token: the part before "/", lowercased ("Chrome/150..." -> "chrome").
// Documented because the launch poll finds the launched application by NFKC
// name match - the recipe key and this derivation must agree.
function productName(version: VersionReply): string {
  return String(version.Browser ?? "").split("/")[0].toLowerCase();
}

export class CdpBackend implements Backend {
  readonly name: string = "cdp";
  protected readonly channel: CdpChannel;
  // The observe-visibility set (M2.3, ADR-0036). Deny-by-default is this
  // backend's own posture: when no visibility is given, nothing is.
  private readonly visibility: Visibility;
  // id -> native ref for every element this backend has answered; attestation
  // re-reads the element live rather than replaying a cached snapshot.
  private readonly answered = new Map<string, NativeRef>();
  // subscription id -> the channel watch feeding it. Per backend, closed when
  // the backend closes.
  private readonly watches = new Map<string, ChannelWatch>();

  constructor(channel: CdpChannel, visibility: Visibility = new Set()) {
    this.channel = channel;
    this.visibility = visibility;
  }

  private async version(): Promise<VersionReply> {
    return (await this.channel.exchange({ kind: "version" })) as VersionReply;
  }

  private async pageTargets(): Promise<string[]> {
    const reply = await this.channel.exchange({ kind: "list" });
    if (!Array.isArray(reply)) return [];
    // Only page-shaped targets carry a user-visible tree; extension targets
    // (background pages, service workers) are proven present and excluded.
    return (reply as ListedTarget[])
      .filter((t) => t.type === "page" || t.type === "iframe")
      .map((t) => String(t.id ?? ""))
      .filter((id) => id !== "");
  }

  private async axTree(targetId: string): Promise<AxNode[]> {
    await this.channel.exchange({ kind: "call", targetId, method: "Accessibility.enable", params: {} });
    const reply = (await this.channel.exchange({
      kind: "call",
      targetId,
      method: "Accessibility.getFullAXTree",
      params: {},
    })) as { result?: { nodes?: AxNode[] } };
    return reply.result?.nodes ?? [];
  }

  private applicationElement(version: VersionReply): SemanticElement {
    const id = deriveId("application", "browser", String(version.webSocketDebuggerUrl ?? ""));
    this.answered.set(id, { kind: "browser" });
    return {
      id,
      role: "application",
      name: productName(version),
      states: ["enabled", "visible"],
      actions: [],
    };
  }

  private nodeElement(targetId: string, node: AxNode): SemanticElement {
    const nativeRole = String(node.role?.value ?? "");
    const { role, diagnostic } = toNeutralRole(nativeRole);
    const id = deriveId(role, targetId, String(node.backendDOMNodeId ?? node.nodeId));
    this.answered.set(id, {
      kind: "node",
      targetId,
      backendDOMNodeId: node.backendDOMNodeId,
      nodeId: node.nodeId,
    });
    return {
      id,
      role,
      name: String(node.name?.value ?? ""),
      states: toNeutralStates(node.properties ?? []),
      actions: actionsForRole(role),
      ...(diagnostic !== undefined
        ? { diagnostic: { ...diagnostic, nativeId: `${targetId}/${node.backendDOMNodeId ?? node.nodeId}` } }
        : {}),
    };
  }

  async queryElements(params: QueryElementsParams): Promise<QueryElementsResult> {
    const elements: SemanticElement[] = [];
    let total = 0;

    const matches = (element: SemanticElement) =>
      (params.role === undefined || element.role === params.role) &&
      (params.name === undefined || nameMatches(element.name, params.name));

    // The visibility gate (ADR-0036), the symmetric analog of the atspi name
    // read: the version exchange is the ONE permitted read - the application's
    // name derives from it - and an ungranted browser answers empty having
    // issued only that exchange: never list, never a target dial, never
    // Accessibility.*. Nothing was registered as answered, so attestation
    // naturally refuses too.
    const version = await this.version();
    if (!isVisible(this.visibility, productName(version))) {
      return { elements: [] };
    }

    const application = this.applicationElement(version);
    if (matches(application)) {
      elements.push(application);
      if (params.limit !== undefined && elements.length >= params.limit) return { elements };
    }

    for (const targetId of await this.pageTargets()) {
      let inThisTarget = 0;
      for (const node of await this.axTree(targetId)) {
        if (inThisTarget >= MAX_NODES_PER_TARGET || total >= MAX_NODES_TOTAL) break;
        if (node.ignored === true) continue;
        inThisTarget += 1;
        total += 1;
        const element = this.nodeElement(targetId, node);
        if (matches(element)) {
          elements.push(element);
          if (params.limit !== undefined && elements.length >= params.limit) return { elements };
        }
      }
    }
    return { elements };
  }

  // Attestation re-reads live. INVARIANT, load-bearing for the replay lane:
  // the re-read may issue only exchanges the query walk also issues
  // (version / list / Accessibility.enable / Accessibility.getFullAXTree).
  // The tape is captured via a query, so an attest-only exchange (e.g.
  // DOM.describeNode) would throw UnrecordedCdpExchangeError in offline
  // conformance - do not add one.
  async attestElement(params: AttestElementParams): Promise<AttestElementResult> {
    const ref = this.answered.get(params.id);
    if (ref === undefined) {
      return { refusal: `no element with id "${params.id}" was ever answered by this daemon - nothing to attest` };
    }
    if (ref.kind === "browser") {
      return { element: this.applicationElement(await this.version()) };
    }
    for (const targetId of await this.pageTargets()) {
      if (targetId !== ref.targetId) continue;
      for (const node of await this.axTree(targetId)) {
        if (node.ignored === true) continue;
        // match by backendDOMNodeId first (stable across tree rebuilds),
        // nodeId as the fallback for nodes the tree never gave a DOM id
        const hit =
          ref.backendDOMNodeId !== undefined
            ? node.backendDOMNodeId === ref.backendDOMNodeId
            : node.nodeId === ref.nodeId;
        if (hit) return { element: this.nodeElement(targetId, node) };
      }
    }
    return { refusal: `element "${params.id}" no longer answers at the browser's debugging endpoint - it is gone; look again` };
  }

  // A watch is only ever established on an element this backend has already
  // answered. An id it never answered may name a node that does not exist or
  // one in a browser this session cannot see - the same refusal covers both,
  // deliberately (ADR-0036).
  async subscribeElement(id: string, sink: (change: BackendChange) => void): Promise<BackendSubscription> {
    if (!this.answered.has(id)) {
      throw new UnwatchableElementError(`no element with id "${id}" was ever answered by this daemon - nothing to watch`);
    }
    const watch = await this.channel.watch(id, sink);
    const subscriptionId = mintSubscriptionId();
    this.watches.set(subscriptionId, watch);
    return {
      subscriptionId,
      // Every element this backend answers is read out of the browser at its
      // endpoint, so the application a watched node belongs to is the browser
      // itself, under the name the version reply derives.
      application: productName(await this.version()),
      close: async () => {
        this.watches.delete(subscriptionId);
        await watch.close();
      },
    };
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

// The replay flavour: the SAME reader over a recorded channel - only the
// channel differs (the wrapper pattern of daemon/src/backends/replay/index.ts).
// Nothing here invents tree data; the offline lane exercises a recording of a
// real browser, not a hand-authored guess.
export class CdpReplayBackend extends CdpBackend {
  override readonly name: string = "cdp-replay";

  constructor(fixture: string, visibility?: Visibility) {
    super(replayCdpChannel(fixture), visibility);
  }
}
