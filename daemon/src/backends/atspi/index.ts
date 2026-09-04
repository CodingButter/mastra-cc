import type {
  ActivateElementParams,
  ActivateElementResult,
  AttestElementParams,
  AttestElementResult,
  Diagnostic,
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
import { emitChord, emitString } from "./rawinput/keys.js";
import type { AtspiWatchAnchor } from "./signal-stream.js";
import { applicationName, nameMatches } from "./names.js";
import { readPublishedActions } from "./actions.js";
import { readObservableContent } from "./content.js";
import { advertisesCollection, matchByRole, roleIsCollectable } from "./collection.js";
import { readPublishedOperations } from "./magnitudes.js";
import { claimsKeyboardActivation, stampVisibilityRoute, toNeutralRole, toNeutralStates } from "./roles.js";
import type { Classified } from "../../audit.js";

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

  // The walk budgets. Only a test may pass its own: the seam exists so the
  // UNCHANGED comparisons below can be exercised at small numbers, because a
  // scripted channel cannot afford a million nodes. No CLI flag, environment
  // variable, configuration key or protocol field reaches this parameter.
  private readonly limits: TraversalLimits;

  constructor(channel: Channel, visibility: Visibility = new Set(), limits: TraversalLimits = TRAVERSAL_LIMITS) {
    this.channel = channel;
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
    const content = await readObservableContent(this.channel, ref, nativeRole);
    const id = deriveId(role, ref.busName, ref.objectPath);
    this.answered.set(id, ref);
    this.byNative.set(`${ref.busName}\0${ref.objectPath}`, { id, role });
    if (application !== undefined) this.applicationOf.set(id, application);
    return {
      id,
      role,
      name,
      states: toNeutralStates(lower, upper),
      content,
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
    const elements: SemanticElement[] = [];
    let total = 0;

    // The scope (ADR-0073). When the caller names an application, the answer is
    // restricted to the one whose name matches, compared with the SAME
    // NFKC+case-fold normaliser grants use (a scope names an application the way
    // a grant does). Normalised once here; the per-application name is
    // normalised again at the gate below. The scope filter runs AFTER the
    // visibility gate, so naming an ungranted application yields an empty answer
    // - absent, never "blocked" (ADR-0036).
    const scope = params.application === undefined ? undefined : applicationName(params.application);

    const apps = await this.children({ busName: REGISTRY_DEST, objectPath: ROOT_PATH });
    for (const app of apps) {
      // The visibility gate (ADR-0036). The application's NAME is the one
      // permitted read of an ungranted application - you cannot decide
      // visibility without it - and it is read BEFORE readElement, so an
      // ungranted application's subtree is never walked, its states never
      // read, its element never answered.
      let appName: string;
      try {
        appName = await this.nameOf(app);
        if (!isVisible(this.visibility, appName)) continue;
        if (scope !== undefined && applicationName(appName) !== scope) continue;
      } catch (error) {
        // an off-tape read under replay is ignorance, and ignorance surfaces
        // as a refusal - never a skip; a dying app that cannot state its name
        // cannot be granted, so it is skipped like any dying node
        if (error instanceof UnrecordedExchangeError) throw error;
        continue;
      }
      // The fast instrument, when the application advertises it and the
      // question is one the bus's own role vocabulary can carry. One exchange
      // replaces the walk; the answer goes through the SAME readElement and
      // the SAME response shape, so a caller cannot tell which instrument
      // answered - only that the answer is complete.
      const collected = await this.collectByRole(app, params.role);
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
              `observation budget exhausted inside "${appName}" with matches still unread - this observation would be partial`,
            );
          }
          total += 1;
          try {
            const element = await this.readElement(ref, appName);
            if (params.role !== undefined && element.role !== params.role) {
              fastAnswerTrusted = false;
              break;
            }
            if (params.name !== undefined && !nameMatches(element.name, params.name)) continue;
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
      const stack: Array<{ ref: NativeRef; depth: number }> = [{ ref: app, depth: 0 }];
      let inThisApp = 0;
      while (stack.length > 0) {
        // Budget exhausted with tree still unwalked. Answering here would hand
        // back a short list that reads exactly like "the desktop does not
        // contain that element", so the walk refuses instead (ADR-0042).
        if (inThisApp >= this.limits.maxNodesPerApp || total >= this.limits.maxNodesTotal) {
          throw new IncompleteObservationError(
            `walk budget exhausted inside "${appName}" with its tree unfinished - this observation would be partial, and a partial tree cannot be told apart from a desktop that does not contain what was asked for`,
          );
        }
        const { ref, depth } = stack.shift() as { ref: NativeRef; depth: number };
        inThisApp += 1;
        total += 1;

        // A node that stops answering mid-walk is skipped, not fatal: live
        // trees contain dying processes and dead references, and one of them
        // must not take down the whole query.
        try {
          const element = await this.readElement(ref, appName);
          const roleMatches = params.role === undefined || element.role === params.role;
          const queryNameMatches = params.name === undefined || nameMatches(element.name, params.name);
          if (roleMatches && queryNameMatches) {
            elements.push(element);
            if (params.limit !== undefined && elements.length >= params.limit) return { elements };
          }
          const kids = await this.children(ref);
          if (depth >= this.limits.maxDepth && kids.length > 0) {
            throw new IncompleteObservationError(
              `depth budget reached inside "${appName}" above a node that still has children - the subtree below it was never observed`,
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

  async attestElement(params: AttestElementParams): Promise<Classified<AttestElementResult>> {
    const ref = this.answered.get(params.id);
    if (ref === undefined) {
      return { refusal: `no element with id "${params.id}" was ever answered by this daemon - nothing to attest`, refusalClass: "UnknownElement" };
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
      return { refusal: `no element with id "${params.id}" was ever answered by this daemon - nothing to read`, refusalClass: "UnknownElement" };
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
      throw new UnwatchableElementError(`no element with id "${id}" was ever answered by this daemon - nothing to watch`);
    }
    // The anchor: which bus connection owns the watched root (the sender
    // scope), and the walk's own book of answered nodes (so a change is
    // reported under the id the client already holds).
    const anchor: AtspiWatchAnchor = {
      busName: ref.busName,
      rootPath: ref.objectPath,
      known: (busName, objectPath) => this.byNative.get(`${busName}\0${objectPath}`),
      parentOf: (busName, objectPath) => this.parentOf({ busName, objectPath }),
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
            return await this.readElement(ref, applicationName);
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
        `no element with id "${id}" was ever answered by this daemon - nothing to act on`,
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
  async typeText(params: TypeTextParams): Promise<TypeTextResult> {
    return this.aimedRawInput(params.id, "text", () => emitString(this.channel, params.text));
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
  async activateElement(params: ActivateElementParams): Promise<ActivateElementResult> {
    return this.performing(params.id, async (ref) => {
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
    const ref = this.answered.get(params.id);
    if (ref === undefined) {
      // Byte-identical to every other unperformable id (ADR-0008 rule 6).
      throw new UnperformableElementError(
        `no element with id "${params.id}" was ever answered by this daemon - nothing to act on`,
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
function keyAimNote(diagnostic: Diagnostic | undefined, note: string): Diagnostic & { "mastra-cc/key-aim": string } {
  return { ...(diagnostic ?? {}), "mastra-cc/key-aim": note };
}
