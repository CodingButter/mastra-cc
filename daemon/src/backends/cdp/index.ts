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
  Role,
  SemanticElement,
  SetElementCaretParams,
  SetElementCaretResult,
  SetElementTextParams,
  SetElementTextResult,
  SetElementValueParams,
  SetElementValueResult,
  Range,
  SubmitElementParams,
  SubmitElementResult,
} from "@mastra-cc/protocol-types";
import {
  type Backend,
  type BackendChange,
  type BackendSubscription,
  type ChannelWatch,
  commitDescription,
  EffectUnsupportedError,
  MagnitudeOutOfRangeError,
  mintSubscriptionId,
  OperationNotExposedError,
  RecordingNotPerformableError,
  TextOffsetOutOfRangeError,
  UnknownSubscriptionError,
  UnperformableElementError,
  UnwatchableElementError,
  WriteNotObservedError,
} from "../../backend.js";
import { isVisible, type Visibility } from "../../grants.js";
import { deriveId } from "../atspi/identity.js";
import { nameMatches } from "../atspi/names.js";
import { deriveActions, NO_NODE_TO_DERIVE_FROM } from "./actions.js";
import {
  contentLength,
  contentOf,
  type NodeRef,
  performDerivedAction,
  revealIn,
  setCaretOf,
  setMagnitudeOf,
  setValueOf,
} from "./effects.js";
import { NOTHING_TO_OPERATE_ON, readPublishedOperations } from "./magnitudes.js";
import { type CdpChannel, replayCdpChannel } from "./channel.js";
import { stampVisibilityRoute, toNeutralRole, toNeutralStates } from "./roles.js";

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
  // The role this backend gave each id, and the reverse lookup a watch needs:
  // target/backend-node-id -> the id and role the walk already minted. Both
  // are filled while walking, where the answer is already known.
  private readonly roleOf = new Map<string, Role>();
  private readonly mintedByNode = new Map<string, { id: string; role: Role }>();
  // id -> the application every answered element lives in. On this route that
  // is one name for the whole tree - the browser's own product name, the same
  // one a watch reports (ADR-0038: the browser reports its product name
  // whichever profile it opened). Filled where the version reply is already in
  // hand, so answering costs no extra exchange.
  private readonly applicationOf = new Map<string, string>();
  // subscription id -> the channel watch feeding it. Per backend, closed when
  // the backend closes.
  private readonly watches = new Map<string, ChannelWatch>();

  constructor(channel: CdpChannel, visibility: Visibility = new Set()) {
    this.channel = channel;
    this.visibility = visibility;
  }

  // The product name most recently answered by the version exchange. Every
  // path that mints an id passes through here first (the walk asks version
  // before the visibility gate), so the name is in hand by the time an element
  // is recorded - and remembering it costs no exchange the walk did not
  // already make.
  private lastProductName: string | undefined;

  private async version(): Promise<VersionReply> {
    const reply = (await this.channel.exchange({ kind: "version" })) as VersionReply;
    this.lastProductName = productName(reply);
    return reply;
  }

  // The application every element on this route lives in: one browser, one
  // name. Undefined for an id never answered, and undefined before any version
  // reply - never a guessed name (ADR-0039).
  applicationOfElement(id: string): string | undefined {
    return this.applicationOf.get(id);
  }

  private recordApplication(id: string): void {
    if (this.lastProductName !== undefined) this.applicationOf.set(id, this.lastProductName);
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
    this.recordApplication(id);
    return {
      id,
      role: "application",
      name: productName(version),
      states: ["enabled", "visible"],
      // The browser itself is not a node in any page's tree, so there is no
      // node to derive from and nothing publishes a verb for it. That is a
      // measured absence, and it says so - the empty list this replaced was
      // the third invented answer this milestone exists to remove, because it
      // read the same as "asked, and nothing grounded a verb".
      actions: [],
      // The browser is not a node either, so it backs none of the four
      // operations. Reported in full and not-exposed rather than omitted, for
      // the same reason the action list above is a measured absence: an
      // operation missing from the list would read as "never asked".
      operations: NOTHING_TO_OPERATE_ON,
      // ADR-0040: the application answer names its instrument too.
      diagnostic: stampVisibilityRoute(NO_NODE_TO_DERIVE_FROM),
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
    this.roleOf.set(id, role);
    this.recordApplication(id);
    if (node.backendDOMNodeId !== undefined) {
      this.mintedByNode.set(`${targetId}/${node.backendDOMNodeId}`, { id, role });
    }
    // ADR-0043: the verbs come from what this node published, never from its
    // role. A disabled input and an enabled one share the role and differ in
    // what they publish, so the role could never have told them apart.
    const derived = deriveActions(node.properties ?? []);
    return {
      id,
      role,
      name: String(node.name?.value ?? ""),
      states: toNeutralStates(node.properties ?? []),
      actions: derived.actions,
      // ADR-0045 clause 4: the bounds come from what this node published, in
      // its own units. Read from properties here where the desktop route reads
      // interfaces - different instrument, same neutral answer.
      operations: readPublishedOperations(node.properties ?? []),
      // ADR-0040: every answer names its instrument; the unmapped-role
      // diagnostic (ADR-0018 clause 3) and the derivation's own grounding
      // merge in when present.
      diagnostic: stampVisibilityRoute({
        ...derived.diagnostic,
        ...(diagnostic !== undefined
          ? { ...diagnostic, nativeId: `${targetId}/${node.backendDOMNodeId ?? node.nodeId}` }
          : {}),
      }),
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
    const ref = this.answered.get(id);
    if (ref === undefined) {
      throw new UnwatchableElementError(`no element with id "${id}" was ever answered by this daemon - nothing to watch`);
    }
    const watch = await this.channel.watch(id, sink, {
      targetId: ref.kind === "node" ? ref.targetId : "",
      ...(ref.kind === "node"
        ? { backendDOMNodeId: ref.backendDOMNodeId, nodeId: ref.nodeId }
        : {}),
      role: this.roleOf.get(id) ?? "generic",
      // A change to an element the walk already named is reported under THAT
      // id: a pointer the client cannot attest would be no pointer at all.
      known: (backendNodeId) => this.mintedByNode.get(`${ref.kind === "node" ? ref.targetId : ""}/${backendNodeId}`),
    });
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

  // THE EFFECT HALF, on this route.
  //
  // The accessibility domain reads and does not act, so every verb below
  // resolves the element through the tree it was answered from and calls a
  // function on that object (effects.ts). Element-addressed throughout: no
  // coordinate, no synthesised key, no selector guessed at.
  //
  // Then it RE-READS. The return value is a claim; the re-read is the evidence,
  // exactly as on the desktop route. What differs is where the evidence lives:
  // an AX textbox node publishes no value, so the tree cannot show what a field
  // holds. The write is confirmed against the element's own value in effects.ts,
  // and the element returned here is what the tree publishes afterwards. The
  // difference is stated, never smoothed into false parity (ADR-0040).
  protected refuseToPerform(verb: string): never {
    throw new EffectUnsupportedError(
      `the browser route cannot ${verb}: it reads the page's accessibility tree and does not act on it`,
    );
  }

  // Asked at the TOP of every verb, before the id is resolved or anything is
  // read. The live route can perform, so this is a no-op here; the replay
  // flavour overrides it to refuse. The ordering is load-bearing: a tape must
  // refuse as a tape, not as an element it happens not to hold. Refusing on the
  // id first would make the answer depend on which element was asked for, which
  // is the existence-oracle shape (ADR-0008 rule 6).
  protected assertPerformable(_verb: string): void {}

  // Resolve the element this backend actually answered. An id it never answered
  // is refused identically whether it never existed or was never answered - the
  // refusal must not become an existence oracle (ADR-0008 rule 6, ADR-0036).
  private nodeRefFor(id: string): NodeRef {
    const ref = this.answered.get(id);
    if (ref === undefined || ref.kind !== "node") {
      throw new UnperformableElementError(
        `no element with id "${id}" was ever answered by this daemon - nothing to act on`,
      );
    }
    return { targetId: ref.targetId, backendDOMNodeId: ref.backendDOMNodeId, nodeId: ref.nodeId };
  }

  // The re-read after every effect. Finds the element as the tree publishes it
  // NOW, rather than returning the element as it was known before the write.
  private async reread(id: string): Promise<SemanticElement> {
    const attested = await this.attestElement({ id });
    if (attested.element !== undefined) return attested.element;
    throw new WriteNotObservedError(
      `the effect was performed but the element could not be read back afterwards: ${attested.refusal}`,
    );
  }

  async editElement(params: EditElementParams): Promise<EditElementResult> {
    this.assertPerformable("edit an element");
    const ref = this.nodeRefFor(params.id);
    await setValueOf(this.channel, ref, params.value);
    return { element: await this.reread(params.id) };
  }

  async activateElement(params: ActivateElementParams): Promise<ActivateElementResult> {
    this.assertPerformable("perform an action");
    const ref = this.nodeRefFor(params.id);
    // The action must be one the READER derived for this node, read fresh from
    // the tree rather than from anything remembered - matched verbatim, never
    // to the nearest name.
    await performDerivedAction(this.channel, ref, params.action, await this.publishedActionsOf(params.id));
    return { element: await this.reread(params.id) };
  }

  // The names this node publishes right now. Read through attestation so the
  // list is the reader's own answer for the CURRENT tree - an action list
  // remembered from the walk could name a verb the page has since withdrawn.
  private async publishedActionsOf(id: string): Promise<string[]> {
    const attested = await this.attestElement({ id });
    return (attested.element?.actions ?? []).map((action) => action.name);
  }

  // Submit on this route, same contract as the desktop's: the daemon writes its
  // own description of the commit first, from the node as the CURRENT tree
  // answers it, and refuses when it cannot (ADR-0008 rule 2). The route
  // difference the stamp already makes visible is in what gets described, never
  // in whether describing is required - a commit reviewable on one route and
  // unreviewable on the other would make the check a property of the instrument.
  async submitElement(params: SubmitElementParams): Promise<SubmitElementResult> {
    // Asked as a tape before anything is resolved: a recording refuses as a
    // recording, not as an element it happens not to hold.
    this.assertPerformable("commit");
    const ref = this.nodeRefFor(params.id);
    const element = await this.reread(params.id);
    commitDescription(element);
    await performDerivedAction(this.channel, ref, element.actions[0]!.name, [element.actions[0]!.name]);
    // The desktop route's reasoning applies here for the same reason, arrived
    // at through different machinery: a commit that submits a form navigates
    // the page, and the node the commit acted on stops existing. Omitting the
    // element says "it committed, and there is nothing left to read"; throwing
    // would say "the desktop could not be read", which a caller would read as
    // "it did not commit" and act on by committing again.
    try {
      return { element: await this.reread(params.id) };
    } catch {
      return {};
    }
  }

  async setElementValue(params: SetElementValueParams): Promise<SetElementValueResult> {
    this.assertPerformable("set a value");
    const ref = this.nodeRefFor(params.id);
    // The bounds come from the element, every time, immediately before the
    // write. Refused BEFORE the call: a page clamps a range input silently and
    // then reports success, so a check afterwards would be a report about a
    // value the element never held (ADR-0045 clause 4).
    const published = await this.publishedRangeOf(params.id);
    if (published !== undefined && (params.value < published.minimum || params.value > published.maximum)) {
      throw new MagnitudeOutOfRangeError(
        `${params.value} is outside the range this element published (${published.minimum} to ${published.maximum}) - refused rather than clamped into a lie`,
      );
    }
    if (published === undefined) {
      // No range published means no bounds to check against, and inventing one
      // here is exactly what clause 4 forbids. The operation is not offered.
      throw new OperationNotExposedError(
        `this element publishes no range for its own magnitude, so there is nothing to set a value against - never offered, rather than turned off`,
      );
    }
    await setMagnitudeOf(this.channel, ref, params.value);
    return { element: await this.reread(params.id) };
  }

  private async publishedRangeOf(id: string): Promise<Range | undefined> {
    const attested = await this.attestElement({ id });
    for (const operation of attested.element?.operations ?? []) {
      if (operation.operation === "setValue") return operation.range;
    }
    return undefined;
  }

  async setElementText(params: SetElementTextParams): Promise<SetElementTextResult> {
    this.assertPerformable("set text");
    const ref = this.nodeRefFor(params.id);
    if (params.offset === undefined) {
      await setValueOf(this.channel, ref, params.text);
      return { element: await this.reread(params.id) };
    }
    // An insert at an offset past the end is refused rather than moved to the
    // end. Measured on the other route and true here for the same reason: a
    // write that lands somewhere other than where it was aimed is a wrong write
    // that returned success.
    const length = await contentLength(this.channel, ref);
    if (params.offset < 0 || params.offset > length) {
      throw new TextOffsetOutOfRangeError(
        `offset ${params.offset} is outside this element's text, which holds ${length} characters - refused rather than moved to the end`,
      );
    }
    const before = await contentOf(this.channel, ref);
    await setValueOf(this.channel, ref, before.slice(0, params.offset) + params.text + before.slice(params.offset));
    return { element: await this.reread(params.id) };
  }

  async setElementCaret(params: SetElementCaretParams): Promise<SetElementCaretResult> {
    this.assertPerformable("place the caret");
    const ref = this.nodeRefFor(params.id);
    if (params.offset !== undefined) {
      const length = await contentLength(this.channel, ref);
      if (params.offset < 0 || params.offset > length) {
        throw new TextOffsetOutOfRangeError(
          `offset ${params.offset} is outside this element's text, which holds ${length} characters - refused rather than moved to the end`,
        );
      }
    }
    await setCaretOf(this.channel, ref, params.offset);
    return { element: await this.reread(params.id) };
  }

  async revealElement(params: RevealElementParams): Promise<RevealElementResult> {
    this.assertPerformable("reveal an element");
    const ref = this.nodeRefFor(params.id);
    await revealIn(this.channel, ref);
    return { element: await this.reread(params.id) };
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

  // Both things are true of this route - the browser route does not perform,
  // and this flavour is a tape - and the narrower fact is the one a caller can
  // do something with, so it is the one stated. Narrower first is the same
  // ordering the observe half uses when it reports a deaf watch ahead of an
  // unsupported one; RecordingNotPerformableError extends the route's own
  // EffectUnsupportedError, so nothing that catches the wider case stops
  // catching it.
  protected override refuseToPerform(verb: string): never {
    throw new RecordingNotPerformableError(
      `the replay route cannot ${verb}: it answers from a recording, and a recording cannot be acted upon`,
    );
  }

  // The reader half is inherited wholesale; the performing half must not be.
  // The live route's verbs are real now, so without this the tape would run
  // them - resolving ids, reading nodes, and refusing (if at all) for the wrong
  // reason. It refuses first, by name.
  protected override assertPerformable(verb: string): void {
    this.refuseToPerform(verb);
  }
}
