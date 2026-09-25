import { AsyncLocalStorage } from "node:async_hooks";
import { LabelReader, type LabelBudget } from "./labels.js";
import type {
  ActivateElementParams,
  ActivateElementResult,
  AttestElementParams,
  AttestElementResult,
  Diagnostic,
  DiscoverElementsParams,
  DiscoverElementsResult,
  EditElementParams,
  EditElementResult,
  QueryElementsParams,
  QueryElementsResult,
  ReadElementContentParams,
  ReadElementContentResult,
  RevealElementParams,
  RevealElementResult,
  SendKeyChordParams,
  SendKeyChordResult,
  SemanticElement,
  SetElementCaretParams,
  SetElementCaretResult,
  SetElementTextParams,
  SetElementTextResult,
  TypeTextParams,
  TypeTextResult,
  ClearElementTextParams,
  CaptureElementParams,
  CaptureElementResult,
  ClickElementParams,
  ClickElementResult,
  ClearElementTextResult,
  ObservableContent,
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
  commitDescription,
  mintSubscriptionId,
  type RunningCensus,
  UnknownSubscriptionError,
  IncompleteObservationError,
  UnperformableElementError,
  UnwatchableElementError,
  WriteNotObservedError,
  KeyboardHeldElsewhereError,
  PointerBlockedError,
  WindowScopeAmbiguousError,
  ApplicationScopeAmbiguousError,
  ApplicationScopeUnmatchedError,
  WindowScopeUnmatchedError,
} from "../../backend.js";
import { desktopEntryDirectories, type InventoryEntry, scanInstalledApplications } from "../../inventory.js";
import {
  grabFocus,
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
import { capture } from "./capture.js";
import { emitChord, emitString } from "./rawinput/keys.js";
import { boundary, CancelledAtBoundaryError } from "../../cancellation.js";
import { emitClick, isPointerButton, POINTER_BUTTONS, screenRectangle } from "./rawinput/pointer.js";
import type { AtspiWatchAnchor } from "./signal-stream.js";
import { applicationName, nameMatches, normalise } from "./names.js";
import { aggregateDiscovery, type DiscoveryMetadata } from "../../discovery.js";
import { readPublishedActions } from "./actions.js";
import { readObservableContent } from "./content.js";
import { advertisesCollection, matchByRole, roleIsCollectable } from "./collection.js";
import { readPublishedOperations } from "./magnitudes.js";
import { claimsKeyboardActivation, stampVisibilityRoute, toNeutralRole, toNeutralStates } from "./roles.js";
import type { Classified } from "../../audit.js";
import { ELEMENT_MEMORY_CAP, ElementMemory } from "../element-memory.js";

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

// Walk budgets: a safety net against a runaway or cyclic tree, NOT a working
// limit. They are sized so that no real desk meets them; both are policy of
// this backend, recorded here, not part of the wire contract (ADR-0071).
//
// The range of real desks, measured rather than guessed: a KDE editor's whole
// application tree is 1030 nodes and 17 levels deep, with its visible document
// at depth 11, node 195. Chromium on a Wikipedia article: 3902 nodes, 48 deep,
// walked in 658 ms (measured 2026-09-02). The caps this backend first shipped
// with (24 deep, 4000 per application) were sized from the editor alone, and
// the article tripped the depth cap - which aborted the WHOLE query, so one
// deep application silenced every other application on the desk.
//
// Exhausting a budget raises IncompleteObservationError instead of breaking
// quietly, so a truncated walk can never be mistaken for a desktop that does
// not contain the element. The cost of sizing the net this wide is named
// plainly: the walk keeps no visited set, so a cyclic tree accumulates
// elements until the net fires, up to MAX_NODES_PER_APP of them.
const MAX_DEPTH = 10_000;
const MAX_NODES_PER_APP = 1_000_000;
const MAX_NODES_TOTAL = 5_000_000;

export interface TraversalLimits {
  maxDepth: number;
  maxNodesPerApp: number;
  maxNodesTotal: number;
}

export const TRAVERSAL_LIMITS = {
  maxDepth: MAX_DEPTH,
  maxNodesPerApp: MAX_NODES_PER_APP,
  maxNodesTotal: MAX_NODES_TOTAL,
} as const;

// One key per character, and never more than a field's worth of them
// (ADR-0076). The bound is the same 1024 typeText carries: the two methods are
// the two halves of writing a field, and a text longer than one call can type
// is a text this one will not press through either.
const CLEAR_MAX_PRESSES = 1024;

// How many counted deletion passes a clear will make before it refuses. Two
// would cover the address bar measured here; three leaves one spare pass for a
// field that refills twice, and a fourth pays for the one turnaround a stalled
// pass is allowed (backwards deletion defeated by a selected autocompletion is
// retried forwards). Every pass must shorten the text or the loop stops on its
// own, so this bounds patience, not correctness.
const CLEAR_MAX_PASSES = 4;

// The neutral roles whose whole purpose is to respond to a press, and which a
// toolkit therefore greys out when they must not be pressed. Everything else -
// a page's generic nodes, images, text - publishes enablement inconsistently or
// not at all, and is not held to it.
const PRESSABLE_CONTROL_ROLES: ReadonlySet<string> = new Set(["button", "checkbox"]);
// The published verbs that ACT. A grey control refuses these at both doors;
// everything else it publishes - taking the focus above all - still answers.
const ACTIVATING_ACTIONS: ReadonlySet<string> = new Set(["Press", "Click", "Activate", "DoDefault", "Toggle"]);

// Named once, so the refusal for an unknown button lists the vocabulary rather
// than leaving the caller to guess which three words this desk knows.
const POINTER_BUTTON_LIST = POINTER_BUTTONS.map((name) => JSON.stringify(name)).join(", ");

// How many characters this element says it is carrying, or `undefined` when it
// does not say. A protected or unpublished observation is a silence, and a
// silence is not a zero: an element that will not tell this daemon what is in
// it cannot be emptied by counting, and cannot be checked afterwards either.
function clearableLength(content: ObservableContent): number | undefined {
  if (content.kind === "text") return [...content.value].length;
  if (content.kind === "text-window") return content.totalLength;
  return undefined;
}

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
  // id -> native ref for the elements this backend has answered, bounded and
  // least-recently-used first (ADR-0116); attestation re-reads the element
  // live rather than replaying a cached snapshot. Forgetting an id forgets
  // every sibling fact keyed by it.
  private readonly answered: ElementMemory<NativeRef>;
  private readonly applicationRootOf = new Map<string, NativeRef>();
  private readonly labelBudget = new AsyncLocalStorage<LabelBudget>();
  private readonly labels: LabelReader;

  // How many times a press has been refused at each greyed-out control, so the
  // second refusal can say something the first one could not (ADR-0083).
  private readonly greyRefusals = new Map<string, number>();
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
  // The latest picture answered for each element: when it was taken and the
  // desk rectangle it was cropped from. A press that names a capturedAt is
  // checked against this before anything is sent (ADR-0107). Bounded by the
  // answered map - one entry per element, latest picture only.
  private readonly pictured = new Map<string, { capturedAt: number; rectangle: { x: number; y: number; width: number; height: number } }>();

  // The walk budgets. Only a test may pass its own: the seam exists so the
  // UNCHANGED comparisons below can be exercised at small numbers, because a
  // scripted channel cannot afford a million nodes. No CLI flag, environment
  // variable, configuration key or protocol field reaches this parameter.
  private readonly limits: TraversalLimits;

  constructor(channel: Channel, visibility: Visibility = new Set(), limits: TraversalLimits = TRAVERSAL_LIMITS, elementCap = ELEMENT_MEMORY_CAP) {
    this.channel = channel;
    this.answered = new ElementMemory<NativeRef>(elementCap, (id, ref) => {
      this.applicationRootOf.delete(id);
      this.applicationOf.delete(id);
      this.pictured.delete(id);
      this.greyRefusals.delete(id);
      const native = `${ref.busName}\0${ref.objectPath}`;
      if (this.byNative.get(native)?.id === id) this.byNative.delete(native);
    });
    this.labels = new LabelReader(channel);
    this.visibility = visibility;
    this.limits = limits;
  }

  get traversalLimits(): Readonly<TraversalLimits> {
    return this.limits;
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

  // The one edge a subtree-scoped watch needs and the walk does not record:
  // a node's parent. The walk descends, so it never has to ask - but a signal
  // arrives naming a node the walk may never have visited, and the only honest
  // way to decide whether that node lies under the watched root is to climb
  // from it. Returns undefined at the top of the tree (AT-SPI parks the root's
  // parent on the null path) and on any element that will not answer.
  // Does a window above this element hold the keyboard? Walks up, bounded by
  // the same depth budget the query walk uses, and reads the activation claim
  // the focus walk reads. A read that fails answers false: this witness may
  // only ever excuse a press, never cause one to be refused.
  protected async underActiveWindow(ref: NativeRef): Promise<boolean> {
    let here: NativeRef | undefined = ref;
    for (let step = 0; step < this.limits.maxDepth && here !== undefined; step += 1) {
      const [lower, upper] = await this.statesOf(here);
      if (claimsKeyboardActivation(lower, upper)) return true;
      here = await this.parentOf(here);
    }
    return false;
  }

  // Unlike parentOf, a failed call is a rejection here, not "no parent": the
  // caller is deciding whether to END a watch, and a peer that did not answer
  // has not said it left the tree.
  private async attachmentOf(ref: NativeRef): Promise<"attached" | "detached"> {
    const [raw] = await this.channel.call({
      destination: ref.busName,
      path: ref.objectPath,
      iface: "org.freedesktop.DBus.Properties",
      member: "Get",
      signature: "ss",
      body: [ACCESSIBLE, "Parent"],
    });
    const unwrapped = Array.isArray(raw) && typeof raw[0] === "string" && Array.isArray(raw[1]) ? raw[1][0] : raw;
    if (!Array.isArray(unwrapped)) return "detached";
    const busName = String(unwrapped[0] ?? "");
    const objectPath = String(unwrapped[1] ?? "");
    return busName === "" || objectPath === "" || objectPath === NULL_PATH ? "detached" : "attached";
  }

  private async parentOf(ref: NativeRef): Promise<NativeRef | undefined> {
    let raw: unknown;
    try {
      [raw] = await this.channel.call({
        destination: ref.busName,
        path: ref.objectPath,
        iface: "org.freedesktop.DBus.Properties",
        member: "Get",
        signature: "ss",
        body: [ACCESSIBLE, "Parent"],
      });
    } catch (error) {
      if (error instanceof UnrecordedExchangeError) throw error;
      return undefined;
    }
    // dbus-native hands the variant back unwrapped or as a [signature, [value]]
    // pair, and the value itself is an AT-SPI (bus name, object path) pair.
    const unwrapped = Array.isArray(raw) && typeof raw[0] === "string" && Array.isArray(raw[1]) ? raw[1][0] : raw;
    if (!Array.isArray(unwrapped)) return undefined;
    const busName = String(unwrapped[0] ?? "");
    const objectPath = String(unwrapped[1] ?? "");
    if (busName === "" || objectPath === "" || objectPath === NULL_PATH) return undefined;
    return { busName, objectPath };
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

  private async readDiscoveryMetadata(ref: NativeRef): Promise<DiscoveryMetadata> {
    const nativeRole = await this.nativeRoleOf(ref);
    const { role } = toNeutralRole(nativeRole);
    const published = await readPublishedActions(this.channel, ref);
    const magnitudes = await readPublishedOperations(this.channel, ref);
    return {
      role,
      name: normalise(await this.nameOf(ref)),
      actions: published.actions.map((action) => action.name),
      operations: magnitudes.operations.map((operation) => operation.operation),
    };
  }

  private async readElement(ref: NativeRef, application?: string, applicationRoot?: NativeRef): Promise<SemanticElement> {
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
    const content = await readObservableContent(this.channel, ref, nativeRole);
    const id = deriveId(role, ref.busName, ref.objectPath);
    const root = applicationRoot ?? this.applicationRootOf.get(id);
    const labelEvidence = nativeRole === "text" || nativeRole === "entry" || nativeRole === "textbox"
      ? await this.labels.readEnriched(ref, root, this.labelBudget.getStore() ?? { waited: 0 })
      : {};
    if (applicationRoot !== undefined) this.applicationRootOf.set(id, applicationRoot);
    this.answered.set(id, ref);
    this.byNative.set(`${ref.busName}\0${ref.objectPath}`, { id, role });
    if (application !== undefined) this.applicationOf.set(id, application);
    return {
      id,
      role,
      name,
      states: toNeutralStates(lower, upper),
      content,
      ...labelEvidence,
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

  // Returns the application's matching descendants when the fast instrument
  // can answer this question, and undefined when the walk must. A tape that
  // never recorded the fast instrument is not ignorance about the desktop -
  // the walk's own exchanges still answer it completely - so an off-tape
  // Collection read falls back rather than refusing.
  private async collectByRole(app: NativeRef, role: QueryElementsParams["role"]): Promise<NativeRef[] | undefined> {
    if (role === undefined || !roleIsCollectable(role)) return undefined;
    try {
      if (!(await advertisesCollection(this.channel, app))) return undefined;
      return await matchByRole(this.channel, app, role);
    } catch {
      // The fast instrument declining - off tape, or a toolkit that advertises
      // Collection and then refuses the rule - is not ignorance about the
      // desktop. The walk answers the same question completely, so the query
      // falls back to it rather than failing.
      return undefined;
    }
  }

  async queryElements(params: QueryElementsParams): Promise<QueryElementsResult> {
    if (!this.labelBudget.getStore()) return this.labelBudget.run({ waited: 0 }, () => this.queryElements(params));
    const elements: SemanticElement[] = [];
    let total = 0;

    const apps = await this.children({ busName: REGISTRY_DEST, objectPath: ROOT_PATH });
    const selected: Array<{ root: NativeRef; applicationRoot: NativeRef; applicationName: string }> = [];
    for (const app of apps) {
      let selectedApplicationName: string;
      try {
        selectedApplicationName = await this.nameOf(app);
        if (!isVisible(this.visibility, selectedApplicationName)) continue;
        if (params.application !== undefined && applicationName(selectedApplicationName) !== applicationName(params.application)) continue;
        let root = app;
        if (params.window !== undefined) {
          const windows: NativeRef[] = [];
          for (const candidate of await this.children(app)) {
            const role = toNeutralRole(await this.nativeRoleOf(candidate)).role;
            if (role !== "window" && role !== "dialog") continue;
            if (!nameMatches(await this.nameOf(candidate), params.window)) continue;
            const [lower, upper] = await this.statesOf(candidate);
            const states = toNeutralStates(lower, upper);
            if (!states.includes("visible") || states.includes("offscreen")) continue;
            windows.push(candidate);
          }
          // Nothing to scope to, or too much: both are refusals rather than an
          // empty answer, because the caller asked about a window and an empty
          // list would have described one instead of the search for it.
          if (windows.length === 0) throw new WindowScopeUnmatchedError(`no visible window named "${params.window}" in "${selectedApplicationName}"`);
          if (windows.length > 1) throw new WindowScopeAmbiguousError(`${windows.length} visible windows named "${params.window}" in "${selectedApplicationName}"`);
          root = windows[0] as NativeRef;
        }
        selected.push({ root, applicationRoot: app, applicationName: selectedApplicationName });
      } catch (error) {
        if (error instanceof UnrecordedExchangeError) throw error;
        if (error instanceof WindowScopeUnmatchedError || error instanceof WindowScopeAmbiguousError) throw error;
        if (error instanceof ApplicationScopeUnmatchedError || error instanceof ApplicationScopeAmbiguousError) throw error;
      }
    }
    if (params.application !== undefined && selected.length === 0)
      throw new ApplicationScopeUnmatchedError(
        `no application named "${params.application}" is on this desktop's accessibility bus - listApplications names what is`,
      );
    if (params.application !== undefined && selected.length > 1)
      throw new ApplicationScopeAmbiguousError(`${selected.length} applications named "${params.application}" are on this desktop's accessibility bus`);

    for (const { root, applicationRoot, applicationName } of selected) {
      // The fast instrument, when the application advertises it and the
      // question is one the bus's own role vocabulary can carry. One exchange
      // replaces the walk; the answer goes through the SAME readElement and
      // the SAME response shape, so a caller cannot tell which instrument
      // answered - only that the answer is complete.
      const collected = await this.collectByRole(root, params.role);
      // The fast instrument answers over the wire, and a wire question the bus
      // accepts but MEANS differently would answer confidently with the wrong
      // nodes - a failure no fallback-on-error can catch. So every match is
      // checked against the role that was asked for, and one disagreement
      // retires the fast answer entirely in favour of the walk.
      const fastAnswer: SemanticElement[] = [];
      // An EMPTY fast answer is never trusted. "No matches" and "this rule
      // did not work" arrive as the same successful empty reply, and the
      // cross-check below - which catches a fast answer holding the WRONG
      // nodes - has nothing to check when there are no nodes at all. A
      // malformed rule that matched nothing therefore reads exactly like a
      // desktop with no buttons on it, which is the failure ADR-0042 refuses
      // elsewhere. So emptiness costs a walk, and the walk is the answer.
      let fastAnswerTrusted = collected !== undefined && collected.length > 0;
      if (collected !== undefined && fastAnswerTrusted) {
        for (const ref of collected) {
          if (total >= this.limits.maxNodesTotal) {
            throw new IncompleteObservationError(
              `observation budget exhausted inside "${applicationName}" with matches still unread - this observation would be partial`,
            );
          }
          total += 1;
          try {
            const element = await this.readElement(ref, applicationName, applicationRoot);
            if (params.role !== undefined && element.role !== params.role) {
              fastAnswerTrusted = false;
              break;
            }
            if (params.name !== undefined && !queryNameMatches(element, params.name)) continue;
            fastAnswer.push(element);
          } catch (error) {
            if (error instanceof UnrecordedExchangeError) throw error;
            continue;
          }
        }
      }
      if (fastAnswerTrusted && collected !== undefined) {
        for (const element of fastAnswer) {
          elements.push(element);
          if (params.limit !== undefined && elements.length >= params.limit) return { elements };
        }
        continue;
      }
      // depth-first per application, in the order the bus lists them
      const stack: Array<{ ref: NativeRef; depth: number }> = [{ ref: root, depth: 0 }];
      let inThisApp = 0;
      while (stack.length > 0) {
        // Budget exhausted with tree still unwalked. Answering here would hand
        // back a short list that reads exactly like "the desktop does not
        // contain that element", so the walk refuses instead (ADR-0042).
        if (inThisApp >= this.limits.maxNodesPerApp || total >= this.limits.maxNodesTotal) {
          throw new IncompleteObservationError(
            `walk budget exhausted inside "${applicationName}" with its tree unfinished - this observation would be partial, and a partial tree cannot be told apart from a desktop that does not contain what was asked for`,
          );
        }
        const { ref, depth } = stack.shift() as { ref: NativeRef; depth: number };
        inThisApp += 1;
        total += 1;

        // A node that stops answering mid-walk is skipped, not fatal: live
        // trees contain dying processes and dead references, and one of them
        // must not take down the whole query.
        try {
          const element = await this.readElement(ref, applicationName, applicationRoot);
          const roleMatches = params.role === undefined || element.role === params.role;
          const nameMatched = params.name === undefined || queryNameMatches(element, params.name);
          if (roleMatches && nameMatched) {
            elements.push(element);
            if (params.limit !== undefined && elements.length >= params.limit) return { elements };
          }
          const kids = await this.children(ref);
          if (depth >= this.limits.maxDepth && kids.length > 0) {
            throw new IncompleteObservationError(
              `depth budget reached inside "${applicationName}" above a node that still has children - the subtree below it was never observed`,
            );
          }
          stack.unshift(...kids.map((kid) => ({ ref: kid, depth: depth + 1 })));
        } catch (error) {
          // ...but an off-tape read under replay is not a dying process, it is
          // ignorance, and ignorance surfaces as a refusal - never a skip.
          if (error instanceof UnrecordedExchangeError) throw error;
          if (error instanceof IncompleteObservationError) throw error;
          continue;
        }
      }
    }
    return { elements };
  }

  async discoverElements(params: DiscoverElementsParams): Promise<Classified<DiscoverElementsResult>> {
    const apps = await this.children({ busName: REGISTRY_DEST, objectPath: ROOT_PATH });
    const selected: Array<{ root: NativeRef; applicationName: string }> = [];
    for (const app of apps) {
      try {
        const application = await this.nameOf(app);
        if (!isVisible(this.visibility, application) || applicationName(application) !== applicationName(params.application)) continue;
        let root = app;
        if (params.window !== undefined) {
          const windows: NativeRef[] = [];
          for (const candidate of await this.children(app)) {
            const role = toNeutralRole(await this.nativeRoleOf(candidate)).role;
            if (role !== "window" && role !== "dialog") continue;
            if (!nameMatches(await this.nameOf(candidate), params.window)) continue;
            const [lower, upper] = await this.statesOf(candidate);
            const states = toNeutralStates(lower, upper);
            if (states.includes("visible") && !states.includes("offscreen")) windows.push(candidate);
          }
          // Same rule as the scoped query: a window scope that resolves to
          // nothing, or to several, is refused rather than answered empty.
          if (windows.length === 0) throw new WindowScopeUnmatchedError(`no visible window named "${params.window}" in "${application}"`);
          if (windows.length > 1) throw new WindowScopeAmbiguousError(`${windows.length} visible windows named "${params.window}" in "${application}"`);
          root = windows[0] as NativeRef;
        }
        selected.push({ root, applicationName: application });
      } catch (error) {
        if (error instanceof UnrecordedExchangeError) throw error;
        if (error instanceof WindowScopeUnmatchedError || error instanceof WindowScopeAmbiguousError) throw error;
        if (error instanceof ApplicationScopeUnmatchedError || error instanceof ApplicationScopeAmbiguousError) throw error;
      }
    }
    if (selected.length === 0)
      throw new ApplicationScopeUnmatchedError(
        `no application named "${params.application}" is on this desktop's accessibility bus - listApplications names what is`,
      );
    if (selected.length > 1)
      throw new ApplicationScopeAmbiguousError(`${selected.length} applications named "${params.application}" are on this desktop's accessibility bus`);

    const metadata: DiscoveryMetadata[] = [];
    let total = 0;
    const { root, applicationName: selectedApplication } = selected[0] as (typeof selected)[number];
    let inThisApp = 0;
    const stack: Array<{ ref: NativeRef; depth: number }> = [{ ref: root, depth: 0 }];
    while (stack.length > 0) {
      if (inThisApp >= this.limits.maxNodesPerApp || total >= this.limits.maxNodesTotal) {
        throw new IncompleteObservationError(
          `walk budget exhausted inside "${selectedApplication}" with its tree unfinished - this observation would be partial`,
        );
      }
      const { ref, depth } = stack.shift() as { ref: NativeRef; depth: number };
      inThisApp += 1;
      total += 1;
      try {
        const item = await this.readDiscoveryMetadata(ref);
        if (params.role === undefined || item.role === params.role) metadata.push(item);
        const kids = await this.children(ref);
        if (depth >= this.limits.maxDepth && kids.length > 0) {
          throw new IncompleteObservationError(
            `depth budget reached inside "${selectedApplication}" above a node that still has children - the subtree below it was never observed`,
          );
        }
        stack.unshift(...kids.map((kid) => ({ ref: kid, depth: depth + 1 })));
      } catch (error) {
        if (error instanceof UnrecordedExchangeError || error instanceof IncompleteObservationError) throw error;
        throw new IncompleteObservationError(
          `an element inside "${selectedApplication}" stopped answering before discovery completed`,
        );
      }
    }
    return { ...aggregateDiscovery(metadata, params.limit ?? 100), auditApplication: applicationName(selectedApplication) };
  }

  async attestElement(params: AttestElementParams): Promise<Classified<AttestElementResult>> {
    if (!this.labelBudget.getStore()) return this.labelBudget.run({ waited: 0 }, () => this.attestElement(params));
    const ref = this.answered.get(params.id);
    if (ref === undefined) {
      return { refusal: `no element with id "${params.id}" is known to this daemon (never answered, or forgotten after newer answers) - nothing to attest`, refusalClass: "UnknownElement" };
    }
    try {
      // Re-read live; the id re-derives from the same bus name + path, so a
      // still-present element attests under the id it was answered with.
      const element = await this.readElement(ref);
      return { element };
    } catch (error) {
      if (error instanceof UnrecordedExchangeError) throw error;
      return { refusal: `element "${params.id}" no longer answers on the accessibility bus - it is gone; look again`, refusalClass: "ElementGone" };
    }
  }

  async readElementContent(params: ReadElementContentParams): Promise<Classified<ReadElementContentResult>> {
    if (!Number.isSafeInteger(params.offset) || params.offset < 0 || !Number.isSafeInteger(params.limit) || params.limit <= 0) {
      return { refusal: "content window offset must be a non-negative integer and limit must be a positive integer", refusalClass: "MalformedParameter" };
    }
    const ref = this.answered.get(params.id);
    if (ref === undefined) {
      return { refusal: `no element with id "${params.id}" is known to this daemon (never answered, or forgotten after newer answers) - nothing to read`, refusalClass: "UnknownElement" };
    }
    try {
      return { content: await readObservableContent(this.channel, ref, await this.nativeRoleOf(ref), params.offset, params.limit) };
    } catch (error) {
      if (error instanceof UnrecordedExchangeError) throw error;
      return { refusal: `element "${params.id}" no longer answers on the accessibility bus - it is gone; look again`, refusalClass: "ElementGone" };
    }
  }

  // A watch is only ever established on an element this backend has already
  // answered. An id it never answered may name an element that does not exist
  // or one inside an application this session cannot see - the same refusal
  // covers both, deliberately (ADR-0036).
  async subscribeElement(id: string, sink: (change: BackendChange) => void): Promise<BackendSubscription> {
    const ref = this.answered.get(id);
    if (ref === undefined) {
      throw new UnwatchableElementError(`no element with id "${id}" is known to this daemon (never answered, or forgotten after newer answers) - nothing to watch`);
    }
    // The anchor: which bus connection owns the watched root (the sender
    // scope), and the walk's own book of answered nodes (so a change is
    // reported under the id the client already holds).
    const anchor: AtspiWatchAnchor = {
      busName: ref.busName,
      rootPath: ref.objectPath,
      known: (busName, objectPath) => this.byNative.get(`${busName}\0${objectPath}`),
      parentOf: (busName, objectPath) => this.parentOf({ busName, objectPath }),
      attachmentOf: (busName, objectPath) => this.attachmentOf({ busName, objectPath }),
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

  // Filled while walking, where the answering application is already known. An
  // id this backend never answered is absent, and absence is the answer.
  applicationOfElement(id: string): string | undefined {
    return this.applicationOf.get(id);
  }

  // What this machine has installed (ADR-0042). Read from the desktop entry
  // directories, which is the same catalogue the machine's own menu reads -
  // NOT from the accessibility bus. The bus answers what is RUNNING, and an
  // application that is installed and not running is exactly the case a person
  // asks about before starting it. Nothing here opens an application or reads
  // anything inside one.
  async installedApplications(): Promise<InventoryEntry[]> {
    return scanInstalledApplications(desktopEntryDirectories());
  }

  // WHAT IS ANSWERING RIGHT NOW (issue #53). The bus's own top level, which is
  // the census AT-SPI keeps by construction: an application appears there when
  // it registers and disappears when it stops answering. One GetChildren and a
  // name per child - no subtree is walked, no state inside any application is
  // read, so this stays as far outside the applications as
  // installedApplications() is.
  //
  // The horizon is "every-application" because this route enumerates the whole
  // desktop: a name absent from the bus's top level is genuinely not answering,
  // and saying so is a measurement rather than a shrug.
  //
  // VISIBILITY IS NOT APPLIED HERE, and that is deliberate. Filtering by the
  // grant set would report an ungranted application as not-running, which is
  // the false belief this three-state answer exists to prevent - the server
  // turns an ungranted name into cannot-tell before anything reaches a caller
  // (server.ts, listApplications). The names never leave the daemon.
  async runningApplications(): Promise<RunningCensus> {
    const observable = new Set<string>();
    let read = true;
    const apps = await this.children({ busName: REGISTRY_DEST, objectPath: ROOT_PATH });
    for (const app of apps) {
      try {
        observable.add(applicationName(await this.nameOf(app)));
      } catch (error) {
        // Same rule the walk uses: an off-tape read under replay is ignorance
        // and must surface.
        if (error instanceof UnrecordedExchangeError) throw error;
        // AN APPLICATION WHOSE NAME WOULD NOT READ IS NOT AN APPLICATION THAT
        // IS ABSENT. It answered the registry a moment ago; a name that times
        // out leaves this census holding a child it cannot identify. There is
        // no way to say WHICH name went unread - that is the thing that
        // failed - so the horizon shrinks to what was actually read, and every
        // other name becomes cannot-tell rather than a confident closed.
        read = false;
      }
    }
    return { observable, answersFor: read ? "every-application" : observable };
  }

  // WHAT HOLDS THE FOCUS (ADR-0044).
  //
  // THE FOCUSED ELEMENT INSIDE THE ACTIVE WINDOW - two readings intersected,
  // because on this platform neither one answers the question alone. This was
  // measured rather than reasoned, after an earlier implementation that read
  // "focused" alone reported a clean launch while the keyboard demonstrably
  // moved:
  //
  //   "focused" alone is per-application-local. Four nodes across three
  //   applications published it simultaneously, and a dialog kept publishing it
  //   after a launch took its keyboard away. Watching it, nothing ever moves.
  //
  //   the activation bit alone is not exclusive either. A background browser
  //   window claimed it while holding no focused descendant at all.
  //
  //   the intersection was exclusive in every census taken: exactly one focused
  //   element under an activated ancestor, and it MOVED when the keyboard did
  //   (a dialog's text field before a launch, the launched application's own
  //   node after).
  //
  // The ancestor test is deliberately role-agnostic. A GTK dialog carries the
  // activation on a frame, but qt6ct carries it on a "filler" - keying this to
  // a set of window-ish roles would be a role table deciding what an element is
  // (ADR-0045 clause 2), and it read as "nothing holds focus" when tried.
  //
  // This walks rather than reusing queryElements because the answer depends on
  // an ancestor's state, which a flat list of elements no longer knows. It
  // keeps the property that mattered about going through the query: the same
  // visibility gate, applied in the same place and the same way, so a focused
  // element inside an application this session cannot see is not reported -
  // reporting it would be a read of an ungranted application arriving through a
  // different door (ADR-0036).
  //
  // Undefined is a real answer, not a failure: a desktop where nothing holds
  // focus is an ordinary desktop, and saying so is different from saying the
  // question could not be asked - which is what FocusUnsupportedError is for.
  async focusedElement(): Promise<SemanticElement | undefined> {
    if (!this.labelBudget.getStore()) return this.labelBudget.run({ waited: 0 }, () => this.focusedElement());
    const apps = await this.children({ busName: REGISTRY_DEST, objectPath: ROOT_PATH });
    for (const app of apps) {
      // The visibility gate, exactly as queryElements applies it: the name is
      // the one permitted read of an ungranted application, taken before the
      // subtree is entered (ADR-0036).
      let applicationName: string;
      try {
        applicationName = await this.nameOf(app);
        if (!isVisible(this.visibility, applicationName)) continue;
      } catch (error) {
        if (error instanceof UnrecordedExchangeError) throw error;
        continue;
      }
      const stack: Array<{ ref: NativeRef; depth: number; activated: boolean }> = [
        { ref: app, depth: 0, activated: false },
      ];
      let inThisApp = 0;
      while (stack.length > 0) {
        // Same honesty as the query walk: "nothing here holds focus" and "I
        // ran out of budget before I got there" are different answers.
        if (inThisApp >= this.limits.maxNodesPerApp) {
          throw new IncompleteObservationError(
            `walk budget exhausted inside "${applicationName}" before the focus question was answered - an unfinished walk cannot report that nothing holds focus`,
          );
        }
        const { ref, depth, activated } = stack.shift() as { ref: NativeRef; depth: number; activated: boolean };
        inThisApp += 1;
        try {
          const [lower, upper] = await this.statesOf(ref);
          const underActivation = activated || claimsKeyboardActivation(lower, upper);
          if (underActivation && toNeutralStates(lower, upper).includes("focused")) {
            // Read in full only now, so the element is answered (and its id
            // recorded in the answered map) exactly as any other read would
            // answer it - restoreFocus resolves that same id afterwards.
            return await this.readElement(ref, applicationName, app);
          }
          const kids = await this.children(ref);
          if (depth >= this.limits.maxDepth && kids.length > 0) {
            throw new IncompleteObservationError(
              `depth budget reached inside "${applicationName}" above a node that still has children - the focus question was never asked of that subtree`,
            );
          }
          stack.unshift(...kids.map((kid) => ({ ref: kid, depth: depth + 1, activated: underActivation })));
        } catch (error) {
          if (error instanceof UnrecordedExchangeError) throw error;
          if (error instanceof IncompleteObservationError) throw error;
          continue;
        }
      }
    }
    return undefined;
  }

  // PUTTING THE FOCUS BACK.
  //
  // An effect, and therefore verified the way every effect on this seam is
  // verified: perform, then READ THE WORLD BACK and return what the world
  // said. The return is the focused element as the tree publishes it AFTER the
  // attempt - not the element that was asked for, and not a boolean. A route
  // that grabbed nothing answers with whatever actually holds focus, and the
  // caller compares. That comparison is the entire measurement ADR-0044 says
  // this milestone owes, and it is why nothing here reports success.
  async restoreFocus(id: string): Promise<SemanticElement | undefined> {
    const ref = this.answered.get(id);
    if (ref === undefined) {
      // Same refusal shape, same reason as the effect half: an id inside an
      // application this session cannot see must not be distinguishable from
      // one that was never real (ADR-0008 rule 6, ADR-0036).
      throw new UnperformableElementError(
        `no element with id "${id}" is known to this daemon (never answered, or forgotten after newer answers) - nothing to act on`,
      );
    }
    await grabFocus(this.channel, ref);
    return this.focusedElement();
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
  //
  // What changed in M2.7: the re-read is no longer ALSO the verification. Every
  // effect passed to this helper verifies itself before it returns - it
  // compares what it observed against what it intended and throws
  // WriteNotObservedError on disagreement (effects.ts). Reading back and
  // comparing are two different acts, and this helper only ever did the first:
  // it produced a fresh, honest-looking element after an operation that may
  // have done nothing. The element below is the ANSWER, not the evidence.
  private async performing<T>(id: string, effect: (ref: NativeRef) => Promise<void>): Promise<{ element: SemanticElement } & T> {
    if (!this.labelBudget.getStore()) return this.labelBudget.run({ waited: 0 }, () => this.performing<T>(id, effect));
    const ref = this.answered.get(id);
    if (ref === undefined) {
      // Byte-identical to the refusal for an element that does not exist: an id
      // inside an application this session cannot see must not be told apart
      // from one that was never real (ADR-0008 rule 6, ADR-0036).
      throw new UnperformableElementError(
        `no element with id "${id}" is known to this daemon (never answered, or forgotten after newer answers) - nothing to act on`,
      );
    }
    // Every effect's first boundary is before it: a driver that asked to stop
    // while this request waited its turn is answered without an emission.
    boundary(0, 1);
    await effect(ref);
    return { element: await this.readElement(ref) } as { element: SemanticElement } & T;
  }

  async editElement(params: EditElementParams): Promise<EditElementResult> {
    return this.performing(params.id, (ref) => setTextContents(this.channel, ref, params.value));
  }

  // FOCUS, EMIT, READ BACK. The order is the whole design and none of it is
  // optional: the emission is global (it goes to whatever holds focus), so the
  // grab is how the chord is aimed, and the re-read - which `performing` does
  // for every verb here - is the only thing that can say what became of it.
  //
  // Putting the PREVIOUS focus back is deliberately not done here. It is the
  // server's job, above this seam, for the same reason it is above the seam for
  // a launch (ADR-0044): the thing to restore was read before this call and the
  // failure to restore it has to be REPORTED to the caller, not swallowed by a
  // backend that has nowhere to put the sentence.
  //
  // Nothing in this method inspects why the caller wanted a key, and no other
  // method in this file calls it. There is no path from a refused action or a
  // failed setText into here (ADR-0046 clause 3) - a daemon that retried a
  // refused semantic verb as a keystroke would escalate its own authority at
  // precisely the moment it had just been told no.
  async sendKeyChord(params: SendKeyChordParams): Promise<SendKeyChordResult> {
    return this.aimedRawInput(params.id, "key", () => emitChord(this.channel, params.chord));
  }

  // The second raw-input method (ADR-0070). Identical aim, identical doubt,
  // identical read-back; the only difference is what is emitted once focus has
  // been grabbed. What may be in the text was decided in the server before this
  // was reached. Like the chord, nothing else in this file calls it.
  // Without a stable caret/selection witness, length changes cannot establish
  // an insertion postcondition. Preserve readback but do not prescribe replay
  // after input already emitted (ADR-0098).
  async typeText(params: TypeTextParams): Promise<TypeTextResult> {
    if (!this.labelBudget.getStore()) return this.labelBudget.run({ waited: 0 }, () => this.typeText(params));
    const typed = await this.aimedRawInput(params.id, "text", () => emitString(this.channel, params.text));
    if (typed.element === undefined) return typed;
    const note = "mastra-cc/typing-unverified: Input emission was attempted; delivery and the intended resulting value " +
      "are unverified. Caret, selection and publication timing are not established. " +
      "Observe before deciding whether to retry; do not automatically resend or clear text.";
    const diagnostic = { ...typed.element.diagnostic, "mastra-cc/typing-unverified": note };
    return { ...typed, element: { ...typed.element, diagnostic } };
  }

  // The third raw-input method (ADR-0076). Typing is an APPEND: a field that
  // publishes a value and no way to set it can be typed into and never
  // replaced, and this contract has no held-modifier chord to select with -
  // the platform's synthesis taps a modifier rather than holding it, so there
  // is no select-all to press (ADR-0067). What is left is deleting one
  // character at a time, and the only way to do that honestly is to COUNT
  // first: the element's own published text says how many characters are
  // there, and the presses are bounded by that reading rather than by a guess
  // at how long a field might be.
  //
  // Three refusals, all before or instead of a claim of success:
  //   - text this daemon cannot read: refused, because a blind clear is an
  //     unbounded number of destructive presses aimed at a window it cannot
  //     see. Emptiness that cannot be verified is not emptiness.
  //   - more text than this method will press through: refused by length,
  //     because a thousand keystrokes to empty a document is not a field entry
  //     and this is a field-entry verb.
  //   - not empty afterwards: refused, not returned. Unlike every other
  //     raw-input method here, this one HAS something to compare against - the
  //     intended state is "empty" - so the read-back is evidence the seam can
  //     judge instead of handing the caller an element and a shrug.
  async clearElementText(params: ClearElementTextParams): Promise<ClearElementTextResult> {
    if (!this.labelBudget.getStore()) return this.labelBudget.run({ waited: 0 }, () => this.clearElementText(params));
    const ref = this.answered.get(params.id);
    if (ref === undefined) {
      throw new UnperformableElementError(
        `no element with id "${params.id}" is known to this daemon (never answered, or forgotten after newer answers) - nothing to act on`,
      );
    }
    const before = await this.readElement(ref);
    const length = clearableLength(before.content);
    if (length === undefined) {
      throw new UnperformableElementError(
        `this element does not publish text this daemon can read, so there is no count to press through and no way to ` +
          `see whether it emptied - clearing it would be an unknown number of destructive keys aimed at a window this ` +
          `daemon cannot check`,
      );
    }
    if (length > CLEAR_MAX_PRESSES) {
      throw new UnperformableElementError(
        `this element publishes ${length} characters and this contract clears at most ${CLEAR_MAX_PRESSES} by keystroke - ` +
          `clearing is one key per character, and a text this long is a document rather than a field`,
      );
    }
    if (length === 0) {
      return this.performing(params.id, async (target) => {
        await grabFocus(this.channel, target);
      });
    }
    // Passes, not one pass. Measured on this desk, Chromium's address bar
    // autocompletes a suffix back in while the deletions are landing, so one
    // counted pass ends short of empty through no fault of the keys. A pass
    // that made no progress is not tried again: the field is being refilled at
    // least as fast as it is emptied, or the keys are landing elsewhere, and
    // either way pressing on is guessing. The total stays inside the same
    // press budget the length check above refuses past.
    //
    // TWO DIRECTIONS, because one of them is what the refill defeats. Chromium's
    // address bar autocompletes a suffix and leaves it SELECTED, and a Backspace
    // aimed at a selection eats the selection rather than a character, so a
    // backwards pass can spend a key per character and arrive back where it
    // started (measured 2026-09-05: 78 characters left after 999 deletions).
    // Forward deletion from the front of the field has no selection to eat and
    // nothing to autocomplete ahead of it, so when a backwards pass stalls the
    // next one is turned around. This is not a second contract - the count, the
    // budget and the read-back are the same - it is the same deletion pressed
    // from the other end.
    let remaining: number | undefined = length;
    let spent = 0;
    let stalled = false;
    for (let pass = 0; pass < CLEAR_MAX_PASSES; pass += 1) {
      const toDelete = remaining as number;
      if (spent + toDelete > CLEAR_MAX_PRESSES) break;
      spent += toDelete;
      const forwards = stalled;
      const attempt = await this.performing(params.id, async (target) => {
        await grabFocus(this.channel, target);
        // End before backwards deletions, so the caret is behind the last
        // character wherever the application left it; Home before forwards ones,
        // so it is in front of the first. Then one key per character that was
        // read. Neither press is aimed - raw input never is - which is exactly
        // why the comparison below exists.
        await emitChord(this.channel, forwards ? "Home" : "End");
        const key = forwards ? "Delete" : "Backspace";
        // One key per iteration and nothing in flight between two of them:
        // this is the daemon's supported boundary, the only place a driver's
        // cancellation can stop an effect without leaving a half-sent key.
        for (let pressed = 0; pressed < toDelete; pressed += 1) {
          boundary(pressed, toDelete);
          await emitChord(this.channel, key);
        }
      });
      const after = clearableLength(attempt.element.content);
      if (after === 0) return attempt;
      if (after === undefined) {
        remaining = after;
        break;
      }
      const progressed = after < toDelete;
      remaining = after;
      // A stalled pass is worth turning around exactly once. A second stall in
      // the other direction is a field being refilled faster than it can be
      // emptied, or keys landing in another window, and pressing on is guessing.
      if (!progressed) {
        if (stalled) break;
        stalled = true;
      }
    }
    let sentence =
      `this element read back with ${remaining === undefined ? "text this daemon can no longer read" : `${remaining} characters still in it`} after ` +
      `${spent} deletions - the keys were sent, and either they landed somewhere else or the application put text back. ` +
      `Nothing here claims the element is empty when it does not read empty`;
    // A field that lost NOT ONE character took none of the keys: asking for the
    // focus succeeded and the keys still went elsewhere, which on this desk is a
    // window that was not front. A press lands where it is aimed, so say so -
    // the caller cannot see which window holds the keyboard.
    if (remaining === length) {
      sentence +=
        `. Not one character went, so the keys are landing in another window - raise this element's window by pressing ` +
        `its application's button on the desktop shell's task bar with "activateElement", then clear it again`;
    }
    throw new WriteNotObservedError(sentence);
  }

  // A press aimed from a picture is only as good as the picture. The caller
  // names the picture by its capturedAt; this checks it is the LATEST picture
  // this daemon answered for the element, and that the element still sits in
  // the rectangle that picture was cropped from. Each refusal names which of
  // the two it was, so the caller knows to look again rather than aim again
  // (ADR-0107). A capturedAt this daemon never answered is refused as well: a
  // claim it cannot check is not a claim. Nothing is sent on any of these.
  private refuseStalePicture(id: string, capturedAt: number, fresh: { x: number; y: number; width: number; height: number }): void {
    if (!Number.isFinite(capturedAt)) {
      throw new UnperformableElementError("capturedAt must be a finite number - nothing was sent");
    }
    const picture = this.pictured.get(id);
    if (picture === undefined) {
      throw new PointerBlockedError(
        `no picture of element "${id}" was answered by this daemon, so a press aimed from one cannot be checked - nothing was sent`,
      );
    }
    if (picture.capturedAt !== capturedAt) {
      throw new PointerBlockedError(
        `the picture taken at ${capturedAt} is not the latest picture of this element (taken at ${picture.capturedAt}) - ` +
          `it has been re-photographed since; look at the newer picture and aim from that. Nothing was sent`,
      );
    }
    const was = picture.rectangle;
    if (was.x !== fresh.x || was.y !== fresh.y || was.width !== fresh.width || was.height !== fresh.height) {
      throw new PointerBlockedError(
        `the picture taken at ${capturedAt} was cropped from ${was.width}x${was.height} at (${was.x},${was.y}) but the element now ` +
          `sits at ${fresh.width}x${fresh.height} at (${fresh.x},${fresh.y}) - the desk has moved under the picture; ` +
          `look again and aim again. Nothing was sent`,
      );
    }
  }

  // Aim from fresh semantic geometry; read-back is observation, not recipient proof.
  async clickElement(params: ClickElementParams): Promise<ClickElementResult> {
    if (!this.labelBudget.getStore()) return this.labelBudget.run({ waited: 0 }, () => this.clickElement(params));
    const button = (params.button ?? "left") as string;
    if (!isPointerButton(button)) {
      throw new UnperformableElementError(
        `this contract has no pointer button named ${JSON.stringify(button)} - it has ${POINTER_BUTTON_LIST}`,
      );
    }
    const ref = this.answered.get(params.id);
    if (ref === undefined) {
      throw new UnperformableElementError(
        `no element with id "${params.id}" is known to this daemon (never answered, or forgotten after newer answers) - nothing to act on`,
      );
    }
    const count = params.count ?? 1;
    const fractionX = params.x ?? 0.5;
    const fractionY = params.y ?? 0.5;
    if (count !== 1 && count !== 2) throw new UnperformableElementError("a pointer press performs 1 or 2 clicks");
    if ([fractionX, fractionY].some((fraction) => !Number.isFinite(fraction) || fraction < 0 || fraction > 1)) {
      throw new UnperformableElementError("pointer fractions must be finite numbers from 0 through 1");
    }
    const before = await this.readElement(ref);
    await this.refuseGreyControl(params.id, ref);
    const initial = await screenRectangle(this.channel, ref);
    if (initial === undefined || initial.width <= 0 || initial.height <= 0) {
      throw new UnperformableElementError("this element publishes no usable rectangle on this desk - nothing was sent");
    }
    if (before.states?.includes("offscreen") || initial.x < 0 || initial.y < 0) {
      await scrollIntoView(this.channel, ref);
    }
    // A non-focusable image can still take a pointer press. Focus failure is
    // not recipient evidence either way; retain the uncertainty in the answer.
    await grabFocus(this.channel, ref).catch(() => false);
    await this.readElement(ref);
    await this.refuseGreyControl(params.id, ref);
    const rectangle = await screenRectangle(this.channel, ref);
    if (rectangle === undefined || rectangle.width <= 0 || rectangle.height <= 0) {
      throw new UnperformableElementError("this element publishes no usable rectangle on this desk - nothing was sent");
    }
    // As in scrollIntoView, fresh geometry can contradict Chromium's stale
    // offscreen flag. Keep the geometric guard rather than vetoing that witness.
    if (rectangle.x < 0 || rectangle.y < 0) {
      throw new PointerBlockedError("this element's rectangle sits off the screen - nothing was sent");
    }
    if (params.capturedAt !== undefined) this.refuseStalePicture(params.id, params.capturedAt, rectangle);
    // Fractions at 1 select the last pixel INSIDE the rectangle, not a neighbour.
    const point = {
      x: Math.min(Math.round(rectangle.x + rectangle.width * fractionX), Math.ceil(rectangle.x + rectangle.width) - 1),
      y: Math.min(Math.round(rectangle.y + rectangle.height * fractionY), Math.ceil(rectangle.y + rectangle.height) - 1),
    };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < rectangle.x || point.y < rectangle.y) {
      throw new PointerBlockedError("this element publishes no usable pointer point - nothing was sent");
    }
    const performed = await this.performing(params.id, () => emitClick(this.channel, point, button, count));
    const diagnostic = {
      ...performed.element.diagnostic,
      "mastra-cc/pointer-aim": "The pointer was sent at this element's freshly read rectangle. Focus and geometry do not prove the input recipient; compare the read-back with the intended result. Overlays or concurrent window changes can redirect a press.",
    };
    return { ...performed, element: { ...performed.element, diagnostic } };
  }

  private async aimedRawInput(id: string, sent: "key" | "text", emit: () => Promise<void>): Promise<SendKeyChordResult> {
    let doubt: string | undefined;
    const performed = await this.performing(id, async (ref) => {
      // Focus is grabbed, and then the key is sent WITHOUT a pre-flight claim
      // that the focus arrived - because on this desk no such claim can be made
      // honestly. Two candidate predicates were measured against a Kate
      // document that provably takes the key:
      //
      //   the grab's own boolean  - answers false while the key lands perfectly
      //   the tree's focus state  - names an unrelated listitem as focused
      //
      // Refusing on either one refuses a working press, which is a worse lie
      // than the one it was meant to prevent. So the guarantee lives where this
      // file already puts every other guarantee: the caller re-reads the desk
      // afterwards and compares (ADR-0067 clauses 5 and 6). A key that landed
      // in another window shows up as an element that did not change - for a
      // chord that changes it. Eleven of the fourteen leave the element reading
      // identically when they SUCCEED, so read-back alone cannot separate those
      // from a key that went to the wrong window. What both predicates are still
      // good for is DOUBT: neither can refuse, but together they can say "this
      // one may not have arrived", which is the diagnostic below. See
      // docs/proofs/04-a-key-addressed-to-one-element-spike.txt.
      const taken = await grabFocus(this.channel, ref);
      // Read defensively: this observation exists only to DOUBT, so a desktop
      // that cannot be read for it must not take the key down with it. A throw
      // here would let the weaker of the two signals stop a press, which is the
      // exact thing the paragraph above refuses to let it do.
      // `null` is the read that FAILED; `undefined` is the read that succeeded
      // and found nothing focused. Collapsing them would tell a reader something
      // was learned when nothing was.
      const focused = await this.focusedElement().catch(() => null);
      // THE ONE READING THAT IS GOOD ENOUGH TO REFUSE ON. Everything above is
      // about the focus read being unreliable INSIDE an application. Across
      // applications it is not: the walk only reports a focused element under
      // an ancestor the bus marks active, so a focused element belonging to
      // another application means the keyboard is in another application's
      // window. A key sent now lands there - a wallpaper path typed into a
      // browser's search box, and answered "performed". So it is refused, and
      // refused BEFORE the emit, because the damage is the sending.
      // ONE MORE WITNESS BEFORE ACCUSING ANOTHER APPLICATION. The focus walk
      // above returns the FIRST focused element it finds in registry order, and
      // more than one application can carry a stale "active" claim at once -
      // measured 2026-09-05, where a raised settings dialog was told the
      // keyboard belonged to a Chromium behind it, over and over, and a whole
      // errand died on a refusal that was wrong. So ask the target's own
      // ancestry: if a window above this element claims keyboard activation,
      // the key lands here and there is nothing to refuse.
      const raised = await this.underActiveWindow(ref).catch(() => false);
      const mine = raised ? undefined : this.applicationOfElement(id);
      const theirs = focused === null || focused === undefined ? undefined : this.applicationOfElement(focused.id);
      if (mine !== undefined && theirs !== undefined && theirs !== mine) {
        throw new KeyboardHeldElsewhereError(
          `the keyboard belongs to ${JSON.stringify(theirs)} right now, and this element is inside ` +
            `${JSON.stringify(mine)} - a ${sent} is not addressed to an element, it goes to whichever window the desk ` +
            `has given the keyboard to, so this one would have landed in ${JSON.stringify(theirs)}. Nothing was sent. ` +
            `Bring ${JSON.stringify(mine)} to the front the way a person does - the desktop shell publishes a button ` +
            `for each running application on its task bar, and pressing that button with 'activateElement' raises the ` +
            `window and hands it the keyboard - then send the ${sent} again. Pressing inside the window itself does not ` +
            `raise it: the press lands on whatever is stacked on top of that rectangle.`,
        );
      }
      if (!taken || focused === null || focused?.id !== id) {
        doubt =
          `this element was not confirmed to hold the focus when the ${sent} was sent` +
          (focused === null
            ? ", and the desk could not be read to say what did"
            : focused === undefined
              ? ", and nothing on the desk claimed it"
              : `, and ${JSON.stringify(focused.name)} claimed it instead`) +
          `. A ${sent} reaches an element only while that element's window is the front one, and this daemon does not ` +
          "raise windows. Neither signal is reliable enough to refuse on - both have been observed reading wrong for " +
          `a key that arrived - so the ${sent} WAS sent. Compare the element above against what you expected before ` +
          "believing it landed here.";
      }
      // The last point with nothing in flight: the aim is done, the one
      // emission has not begun. A driver that asked during the aim stops here.
      boundary(0, 1);
      await emit();
    });

    if (doubt === undefined) return performed;
    return {
      ...performed,
      element: { ...performed.element, diagnostic: keyAimNote(performed.element.diagnostic, doubt) },
    };
  }

  // The action's own reply is evidence in exactly one direction (effects.ts):
  // a `true` is worth nothing, a `false` is the platform declining in its own
  // words before anything happened. Submit has always checked it; activate
  // dropped it on the floor and answered with a freshly re-read element, which
  // told the caller "performed" for an action the application refused. There is
  // no state to compare here - an action is a bare verb and the element does
  // not publish what it was supposed to change - so the decline is the only
  // reading there is, and discarding it left this verb with none.

  // The same check stands at both doors that press a control: the pointer
  // one and the element's own published verb (ADR-0081).
  private async refuseGreyControl(id: string, ref: NativeRef): Promise<void> {
    // A DISABLED CONTROL IS NOT A PLACE TO SPEND A PRESS. A toolkit control
    // that answers neither the bus's ENABLED bit nor its SENSITIVE one is
    // greyed out: a person clicking it gets nothing, and so does this daemon.
    // Pressing anyway produces a press that "succeeded" over a dead button,
    // which reads back unchanged and invites a caller to report work it never
    // did (measured 2026-09-05: the wallpaper page's Apply button published
    // ["visible"] while every live button beside it published "enabled", and a
    // press on it left the desktop configuration without a wallpaper key).
    // Only CONTROL roles are held to this - a web page's generic nodes publish
    // no enablement at all and are pressed every day.
    const nativeRole = await this.nativeRoleOf(ref);
    const { role } = toNeutralRole(nativeRole);
    if (PRESSABLE_CONTROL_ROLES.has(role)) {
      const [lower, upper] = await this.statesOf(ref);
      if (!toNeutralStates(lower, upper).includes("enabled")) {
        // A SECOND REFUSAL AT THE SAME CONTROL IS A DIFFERENT SENTENCE. The
        // first one is advice - go and do the step this control is waiting on.
        // Repeated, the advice is wrong: measured 2026-09-05, Plasma's wallpaper
        // Apply never gains "enabled" no matter what is pressed beside it, under
        // this daemon's pointer or a real one, and a caller told the same
        // hopeful thing three times read the grey as "already done" and reported
        // a wallpaper the desk never received. So the count is kept, and after
        // the first the refusal says the road is closed and claims nothing.
        const refusals = (this.greyRefusals.get(id) ?? 0) + 1;
        this.greyRefusals.set(id, refusals);
        let refusal =
          `this ${role} publishes no "enabled" state, so this desk reads it as disabled - a press there would land on a ` +
          `control that cannot answer it. Whatever must happen first to wake it has not happened yet`;
        if (refusals > 1) {
          refusal +=
            `. This is refusal ${refusals} at this same control, and nothing you have done has woken it: NOTHING HAS BEEN ` +
            `APPLIED, and a control that stays grey is not a control that acted quietly. This road is closed - finish the ` +
            `errand another way`;
        }
        throw new UnperformableElementError(refusal);
      }
    }
  }

  async activateElement(params: ActivateElementParams): Promise<ActivateElementResult> {
    return this.performing(params.id, async (ref) => {
      // THE SAME GREY, THROUGH THE OTHER DOOR (ADR-0081). A control the desk
      // greys out cannot act, and it makes no difference whether the press
      // arrives as a pointer or as the element's own published verb: measured
      // 2026-09-05, a run that had been refused at Plasma's `Apply` by
      // `clickElement` simply performed `Press` on it instead, got a bare
      // success back, and reported a wallpaper the desk never received. So the
      // enablement check lives at both doors. Actions that do not activate -
      // taking the focus, above all - are untouched: they are exactly what a
      // caller does to a form BEFORE the control it feeds ever wakes.
      if (ACTIVATING_ACTIONS.has(params.action)) await this.refuseGreyControl(params.id, ref);
      const performed = await performAction(this.channel, ref, params.action);
      if (!performed) {
        throw new WriteNotObservedError(
          `the application declined to perform ${JSON.stringify(params.action)} - nothing was done`,
        );
      }
    });
  }

  // Submit commits by performing the element's own single published verb, and
  // only after the daemon has written its OWN description of what that commit
  // does. The description is derived here, from the element as it stands right
  // now, because that is the only place it can be honest: the walk's remembered
  // list could name a verb the application has since withdrawn, and a
  // description assembled from an id would be a sentence about nothing.
  //
  // Two elements cannot be described, and both refuse rather than commit:
  // one that publishes no verb at all (there is nothing to say would happen),
  // and one that publishes several (which of them fires is a guess, and a guess
  // is what a reviewer would be asked to approve). The caller's attestation is
  // carried through untouched - it is their restatement, not a claim the daemon
  // can check - and the daemon's own description is what makes the commit
  // reviewable (ADR-0008 rule 2, ADR-0021).
  async submitElement(params: SubmitElementParams): Promise<SubmitElementResult> {
    if (!this.labelBudget.getStore()) return this.labelBudget.run({ waited: 0 }, () => this.submitElement(params));
    const ref = this.answered.get(params.id);
    if (ref === undefined) {
      // Byte-identical to every other unperformable id (ADR-0008 rule 6).
      throw new UnperformableElementError(
        `no element with id "${params.id}" is known to this daemon (never answered, or forgotten after newer answers) - nothing to act on`,
      );
    }
    const element = await this.readElement(ref);
    // Throws AttestationFailedError when the daemon cannot write the sentence.
    // Asked BEFORE the commit, because a description produced afterwards would
    // describe something that has already happened.
    commitDescription(element);
    const performed = await performAction(this.channel, ref, element.actions[0]!.name);
    if (!performed) {
      // The platform declined, in its own words, before anything happened. This
      // is the one place a return value is evidence, and only in this
      // direction: the tolerated omission below cannot tell a commit that
      // landed and closed the window from a commit that was refused and left
      // the world untouched. Without this, a decline followed by any unrelated
      // read failure would be answered as a commit.
      throw new WriteNotObservedError(
        `the application declined to perform "${element.actions[0]!.name}" on ${JSON.stringify(element.name)} - nothing was committed`,
      );
    }

    // A commit is the one verb whose success can REMOVE the thing it acted on,
    // and the afterwards-read is then asking a window that has already closed.
    // Measured on this session: DoAction on a dialog's OK button is answered in
    // about a millisecond, and the very next read of the same element fails
    // with NoReply because the application disconnected from the bus.
    //
    // So the read failing here is not the same event as the read failing for
    // edit or activate, where the element is expected to survive. Letting it
    // throw would send "the desktop could not be read by this session's
    // backend" for a commit that demonstrably landed - a refusal, for something
    // that already happened and cannot be taken back. That is the single worst
    // direction for this daemon to be wrong in: a caller reading a refusal will
    // reasonably conclude nothing was committed, and commit again.
    //
    // The element is therefore OMITTED rather than invented, which the wire
    // already allows (submitElement's element field is not required). What is
    // never done is echoing back the pre-commit element as though it were the
    // afterwards read: that would be a return value wearing the evidence's
    // clothes, which is the mistake the whole seam exists to refuse.
    try {
      return { element: await this.readElement(ref) };
    } catch {
      return {};
    }
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

  // Crop the visible desktop at the element's freshly read rectangle. The
  // caller names an element, not coordinates; overlapping windows may supply
  // the visible pixels. This is not proof those pixels belong to that element.
  async captureElement(params: CaptureElementParams): Promise<CaptureElementResult> {
    const ref = this.answered.get(params.id);
    if (ref === undefined) {
      throw new UnperformableElementError(`no element with id "${params.id}" is known to this daemon (never answered, or forgotten after newer answers) - nothing to look at`);
    }
    const rectangle = await screenRectangle(this.channel, ref);
    if (rectangle === undefined || rectangle.width <= 0 || rectangle.height <= 0) {
      throw new UnperformableElementError(
        `this element publishes no rectangle on this desk, so there is no part of the screen that is it - ` +
          `nothing here could be photographed and truthfully called this element`,
      );
    }
    try {
      const image = await capture(rectangle);
      // Remember what the picture was cropped from, so a press aimed from it
      // can be checked against the desk at press time (ADR-0107). One entry per
      // answered element: a newer picture replaces the older one, which is the
      // point - the older one is then stale.
      this.pictured.set(params.id, { capturedAt: image.capturedAt, rectangle });
      return { image };
    } catch (failure) {
      // The driver asked to stop and the grab was stopped: not a fact about
      // the desk, and the server logs it as the acknowledgement it is.
      if (failure instanceof CancelledAtBoundaryError) throw failure;
      // A grab that failed is a fact about this desk, not about the element:
      // said plainly so a caller stops asking rather than retrying forever.
      throw new UnperformableElementError(failure instanceof Error ? failure.message : String(failure));
    }
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
    this.labels.close();
    // Closing the reader closes what it was watching: a watch outliving its
    // backend would be fed by a channel that is gone.
    for (const watch of this.watches.values()) await watch.close();
    this.watches.clear();
    await this.channel.close();
  }
}

/**
 * Records, in the debugging subtree, that a key was sent into an aim this
 * daemon could not confirm. It is a NOTE and never a refusal: both signals it
 * summarises have been measured answering wrong for a key that arrived, so
 * refusing on them would refuse working presses (ADR-0067, amended). The
 * diagnostic subtree is the one place the neutral-vocabulary rule is relaxed,
 * and it is not load-bearing for agent logic - the sentence tells a human what
 * to compare, exactly as the focus-preservation note does.
 *
 * Its ABSENCE says both signals agreed that this element held the focus. That is
 * a real statement and it is the safe direction - every measured failure of these
 * signals was a false negative, never a false positive - but it is not proof, and
 * a caller reading silence as certainty is reading further than the desk said.
 */
/**
 * Whether an element answers to the name a query asked for. Element names are
 * compared exactly - "OK" and "ok" on a screen are two different labels - with
 * ONE exception, which is the exception names.ts already documents: an
 * application's name is the same name in any case. Chromium registers on the
 * bus as "Chromium" while the operator's permit, the catalog key and every
 * caller say "chromium" (measured 2026-09-05: a launched browser was refused as
 * unreadable for thirty seconds while its application node sat there under a
 * capital C).
 */
function queryNameMatches(element: { role: string; name: string }, name: string): boolean {
  return element.role === "application"
    ? applicationName(element.name) === applicationName(name)
    : nameMatches(element.name, name);
}

function keyAimNote(diagnostic: Diagnostic | undefined, note: string): Diagnostic & { "mastra-cc/key-aim": string } {
  return { ...(diagnostic ?? {}), "mastra-cc/key-aim": note };
}
