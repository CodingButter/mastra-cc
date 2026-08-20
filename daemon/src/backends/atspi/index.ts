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
  commitDescription,
  mintSubscriptionId,
  UnknownSubscriptionError,
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
import type { AtspiWatchAnchor } from "./signal-stream.js";
import { nameMatches } from "./names.js";
import { readPublishedActions } from "./actions.js";
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
        if (inThisApp >= MAX_NODES_PER_APP) break;
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
          if (depth < MAX_DEPTH) {
            const kids = await this.children(ref);
            stack.unshift(...kids.map((kid) => ({ ref: kid, depth: depth + 1, activated: underActivation })));
          }
        } catch (error) {
          if (error instanceof UnrecordedExchangeError) throw error;
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
