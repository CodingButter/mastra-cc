import { mkdirSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
// Type-only here; the value is reached through a dynamic import inside
// startWebSocketServer, so a daemon nobody asked for a port never pays to load
// the library. Laziness is not what makes it resolvable, though: the installed
// tree copies dist/ without node_modules, so `ws` is force-bundled by
// daemon/tsdown.config.ts the way dbus-native is.
import type { WebSocket } from "ws";
import {
  CAPABILITY_NAMES,
  SCHEMA_DIGEST,
  PRIORITIES,
  PROTOCOL_VERSION,
  type Attribution,
  type Capability,
  type CapabilityName,
  type ListApplicationsResult,
  type ChangeEvent,
  type Diagnostic,
  type OpenApplicationResult,
  type Priority,
  type SemanticElement,
  type SubscribeElementResult,
  type UnsubscribeElementResult,
} from "@mastra-cc/protocol-types";
import {
  type Backend,
  type RunningCensus,
  type RunningState,
  type BackendChange,
  type BackendSubscription,
  AttestationFailedError,
  IncompleteObservationError,
  InventoryUnsupportedError,
  DeafWatchError,
  EffectUnsupportedError,
  MagnitudeOutOfRangeError,
  OperationNotExposedError,
  TextOffsetOutOfRangeError,
  UnknownSubscriptionError,
  UnperformableElementError,
  UnpublishedActionError,
  UnwatchableElementError,
  WatchUnsupportedError,
  WriteNotObservedError,
  runningStateOf,
} from "./backend.js";
import {
  FAILED,
  PERFORMED,
  READ,
  recordAudit,
  refused,
  withoutInternals,
  type AuditCause,
  type AuditSubject,
  type Classified,
  type RefusalClass,
} from "./audit.js";
import { ACQUIRE_SETTING, type AccessibilityLayer, type AccessibilityReport } from "./accessibility/index.js";
import { normalise } from "./backends/atspi/names.js";
import {
  OBSERVE_SETTING,
  withheldBy,
  WITHHOLDS_NOTHING,
  type CapabilityConfiguration,
} from "./capabilities.js";
import { isVisible, type Visibility } from "./grants.js";
import { CATALOG, contendsForBrowserEndpoint, type LaunchCatalog } from "./launch/recipes.js";
import { findRecipe, launchApplication, NO_RECIPE_REFUSAL } from "./launch/spawn.js";
import { OwnershipTable } from "./launch/table.js";

// The daemon's socket server: newline-delimited JSON, digest handshake first,
// then requests dispatched through the effect-class gate. Accessibility access
// is serialised regardless of what Phase 6 measures - serialising is what
// makes an audit record attributable (docs/07-ROADMAP.md:92), and that reason
// is independent of whether concurrency is safe.

// Everything the launch path needs beyond the backend. The permit set is the
// AUTHORITY half (session-scoped, from --permit); the catalog is the
// CAPABILITY half (ADR-0019: different questions, different parties). The
// default context carries no permits, so a server started without them
// refuses every launch.
export interface LaunchContext {
  permits: ReadonlySet<string>;
  catalog: LaunchCatalog;
  table: OwnershipTable;
  /** bounded poll for the launched application to appear in the tree */
  pollBudgetMs?: number;
  pollIntervalMs?: number;
  /**
   * The effect classes this session may exercise on an element, composed once
   * at boot from --allow, exactly as permits are composed from --permit
   * (ADR-0034: session-scoped, dies with the process). Absent means the empty
   * set, so a daemon started without it performs nothing - deny by default, the
   * same posture the grants file takes.
   *
   * THE SESSION HALF OF THE ANSWER. Capability configuration is
   * per-application and durable and lives in `capabilities` below; this is
   * per-session and class-wide. Widening --permit to mean this was considered
   * and rejected: a launch permit is authority to START an application, and
   * ADR-0038 forbids an observe-side join widening authority.
   */
  allows?: ReadonlySet<string>;
  /**
   * The USER's half of the answer (ADR-0043 clause 4, ADR-0042): the durable,
   * per-application capability configuration, composed once at boot from the
   * capabilities file exactly as permits and grants are. Absent means the
   * configuration withholds nothing - the session gates above are the ones
   * that deny by default, and a second silent denial here would leave an
   * operator who granted a class with nothing and no setting to name as the
   * reason (capabilities.ts).
   */
  capabilities?: CapabilityConfiguration;
  /**
   * The observe set composed at boot (ADR-0036), carried here so the listing
   * can report the observe capability from the SAME set that filters events
   * and hides subtrees. startServer fills it from its own visibility option, so
   * there is one composed set and not two that could drift.
   */
  visibility?: Visibility;
  /**
   * The platform adapter that answers whether this machine can be heard, and
   * can be asked to switch it on. Selected once at boot from the platform this
   * daemon runs on, never from anything a caller sends (accessibility/select.ts).
   * Absent means a daemon assembled without one, which reports cannot-tell.
   */
  accessibility?: AccessibilityLayer;
  /**
   * Whether the OPERATOR permitted acquiring - composed once at boot from the
   * launch flag, exactly as permits and allows are, and absent by default. No
   * request an agent can make sets it: a session cannot grant itself authority
   * to reconfigure the machine it is running on (ADR-0064 clause 3).
   */
  mayAcquireAccessibility?: boolean;
}

const NO_PERMITS: LaunchContext = { permits: new Set(), catalog: CATALOG, table: new OwnershipTable() };

// The authority question, asked before the backend is ever touched: does THIS
// SESSION hold the class at all. Class-wide by construction - a session is
// started with --allow edit, not with --allow edit for one application - so it
// takes no application. The per-application answer is the user's, is durable,
// and is asked separately below, because the two questions have different
// owners and different remedies: this one is answered by restarting the daemon
// differently, that one by changing a setting (ADR-0019, ADR-0043 clause 4).
export function holdsEffectAuthority(launch: LaunchContext, effectClass: string): boolean {
  return (launch.allows ?? new Set()).has(effectClass);
}

// A capability the user's configuration turns off is refused BEFORE the call,
// like every other effect-class refusal (pin B11), and the sentence names the
// setting that withholds it. Naming it is the whole difference ADR-0042 makes:
// a refusal a person cannot act on is a wall, and an agent told a capability is
// impossible when it is merely switched off forms exactly the false belief this
// milestone exists to prevent. The state this corresponds to on the wire is
// `disabled-by-configuration`, whose disabledBy carries this same setting -
// never `not-exposed`, which would claim no setting could change the answer.
export function configurationWithholding(
  launch: LaunchContext,
  capability: CapabilityName,
  application?: string,
): string | undefined {
  return withheldBy(launch.capabilities ?? WITHHOLDS_NOTHING, capability, application);
}

export function withheldRefusal(method: string, capability: CapabilityName, setting: string): string {
  return `refused by the capability configuration: "${method}" is ${capability}-class and this machine's owner turned it off - the setting ${setting} withholds it, and changing that setting is what would allow it`;
}

// Which capability each operation is performed under. The same table the
// dispatch entries encode, read from the other direction: what a caller is
// told about an operation must be the same fact the gate would enforce on it,
// or the listing and the enforcement disagree (ADR-0043 clause 4).
const OPERATION_CLASS: Record<string, CapabilityName> = {
  setValue: "edit",
  setText: "edit",
  setCaret: "edit",
  reveal: "activate",
};

// THE REPORTING HALF, and the reason the three availability states exist
// (ADR-0045, ADR-0042). An element publishes a verb; the user's configuration
// turns the class off; the honest report is `disabled-by-configuration` NAMING
// the setting - not `not-exposed`, which would claim the application never
// offered it and no setting could change the answer. Collapsing the two is the
// false belief this milestone exists to prevent, one scale smaller: an agent
// would report a capability limit that is really a settings toggle.
//
// This runs at result time, which is legitimate here and nowhere else: these
// are observe-class reads, so nothing has been performed and there is nothing
// to un-perform. What it never does is invent availability upward - an
// operation the element never offered stays `not-exposed`, because a setting
// cannot grant what the application does not back.
function withConfiguration(element: SemanticElement, launch: LaunchContext, application?: string): SemanticElement {
  const actionSetting = configurationWithholding(launch, "activate", application);
  const operationSetting = (operation: string) => {
    const capability = OPERATION_CLASS[operation];
    return capability === undefined ? undefined : configurationWithholding(launch, capability, application);
  };
  const actions = element.actions.map((action) =>
    action.availability === "available" && actionSetting !== undefined
      ? { ...action, availability: "disabled-by-configuration" as const, disabledBy: actionSetting }
      : action,
  );
  const operations = element.operations?.map((operation) => {
    const setting = operationSetting(operation.operation);
    return operation.availability === "available" && setting !== undefined
      ? { ...operation, availability: "disabled-by-configuration" as const, disabledBy: setting }
      : operation;
  });
  return operations === undefined ? { ...element, actions } : { ...element, actions, operations };
}

function observedWithConfiguration<T extends { elements?: SemanticElement[]; element?: SemanticElement }>(
  result: T,
  backend: Backend,
  launch: LaunchContext,
): T {
  const stamp = (element: SemanticElement) => withConfiguration(element, launch, backend.applicationOfElement(element.id));
  const stamped: T = { ...result };
  if (stamped.elements !== undefined) stamped.elements = stamped.elements.map(stamp);
  if (stamped.element !== undefined) stamped.element = stamp(stamped.element);
  return stamped;
}

// ONE constant for both the unknown name and the unpermitted name, still: the
// two answers remain byte-identical, because the refusal itself is not where
// existence is readable. THAT is what ADR-0042 changes - the listing says what
// this machine has and which setting withholds each capability, so a caller
// asking the right question gets the whole truth, and a caller guessing names
// at the launch method learns nothing from the guess.
//
// Rewritten from "no application by that name is available to this session"
// (M2, docs/proofs/an-unpermitted-application-is-invisible.md, which stays on
// disk as the accurate record of what M2 shipped). The sentence now names the
// capability and the place the answer lives, and still names nothing about
// this machine's contents: no path, no command, no installed-or-not.
// One sentence that is TRUE of both cases rather than a euphemism for one of
// them: no application of that name is one this session may launch, which is
// exactly as true of a name that does not exist as of one that does.
export const UNAVAILABLE_REFUSAL =
  "refused by the launch gate: no application by that name is one this session may launch - listApplications names every application this machine has, each capability's state, and the setting behind every refusal";

export const ALREADY_RUNNING_REFUSAL =
  "that application is already running and was not opened by this daemon - launching a second copy is refused; the running copy must be closed first";

// Two browser identities cannot run at once through this daemon: the browser
// backend dials ONE debugging endpoint (backends/cdp/channel.ts), so a second
// profile would fight the first for it. ALREADY_RUNNING_REFUSAL cannot serve
// here - it says "was not opened by this daemon", which would be a lie about a
// browser this daemon launched itself (ADR-0038). Nothing is killed to make
// room (ADR-0027). Keep this on ONE line: a byte-comparison test copies it.
export const ONE_BROWSER_IDENTITY_REFUSAL = "refused by the launch gate: another browser identity opened by this daemon is already using the browser's debugging endpoint - one browser identity at a time; close it before opening another";

// A spawn that fails after authority and catalog both passed. The constant
// names nothing about the command or the filesystem - a raw spawn error would
// leak argv[0], which is platform vocabulary the wire must never carry (B10).
export const COULD_NOT_START_REFUSAL = "the application could not be started";

// A backend that throws while serving a method becomes THIS constant on the
// wire - never the raw error (the M2.1 lesson, commit 98ac7fd: a system error
// leaks transport and platform vocabulary). For the browser backend this is
// the everyday case, not the exotic one: an unreachable debugging endpoint is
// a browser this session cannot read.
export const BACKEND_UNREADABLE_REFUSAL = "the desktop could not be read by this session's backend";

// The scope gate (ADR-0037). Schema 1.2.0 defines the edit, activate and
// submit classes' element methods so a client can ask about them and hear a
// refusal that names itself - "not a method of the schema" cannot distinguish
// "not built yet" from "hidden". Each constant names the check that ran, the
// method's class, and what would change the answer.
//
// These are no longer pure refusals. The seam behind them performs, and the
// authority surface exists (--allow, session-scoped, ADR-0034), so the gate now
// decides rather than always refusing. What did not change is WHEN it decides:
// before the call, never after the result, because filtering a response does
// not unsend the email. A session that was not given the class hears the
// constant below, byte-for-byte, and the backend is never touched to produce it.
//
// Authority is checked before capability (ADR-0019) and, for submit,
// before the attestation is ever examined (ADR-0021: waiving the attestation is
// inexpressible on the wire, and refusing for want of authority says nothing
// about whether the attestation was any good).
export const EDIT_SCOPE_REFUSAL =
  'refused by the scope gate: "editElement" is edit-class and this session holds no edit authority for any application - this session was started without that class, and only a session started with it can perform this method';

export const ACTIVATE_SCOPE_REFUSAL =
  'refused by the scope gate: "activateElement" is activate-class and this session holds no activate authority for any element - this session was started without that class, and only a session started with it can perform this method';

export const SUBMIT_SCOPE_REFUSAL =
  'refused by the scope gate: "submitElement" is submit-class and this session holds no submit authority for any application - authority is checked before the attestation is ever examined, this session was started without that class, and only a session started with it can perform this method';

// The four operations (schema version 1.4.0, ADR-0045 and ADR-0047). Each
// names the operation's own class: moving a magnitude, placing text and placing
// a caret change what an element holds, and revealing one causes the surface to
// do something visible and trivially reversible.
//
// These four used to refuse for a different reason than the three verbs above:
// the seam performed, but no wire method routed to it, so no authority check
// ran and the answer was the same for a session started with the class and one
// started without it. That is no longer true - the wire serves what the seam
// performs - so they now stand beside the three verbs and are decided by the
// same gate, at the same moment, on the same authority.
//
// The history is worth keeping: an earlier version of these constants claimed
// the seam carried no operation and that the session held no authority. Both
// became false the day the seam grew the operations, and nothing failed,
// because nothing pinned the words. A refusal names the check that actually ran
// AND the method it ran for (ADR-0008 clause 5) - a session refused for want of
// edit authority on setElementValue must not be handed a sentence about
// editElement, which is why these are four sentences rather than one shared by
// class.
export const SET_VALUE_SCOPE_REFUSAL =
  'refused by the scope gate: "setElementValue" is edit-class and this session holds no edit authority for any application - this session was started without that class, and only a session started with it can perform this method';

export const SET_TEXT_SCOPE_REFUSAL =
  'refused by the scope gate: "setElementText" is edit-class and this session holds no edit authority for any application - this session was started without that class, and only a session started with it can perform this method';

export const SET_CARET_SCOPE_REFUSAL =
  'refused by the scope gate: "setElementCaret" is edit-class and this session holds no edit authority for any application - this session was started without that class, and only a session started with it can perform this method';

export const REVEAL_SCOPE_REFUSAL =
  'refused by the scope gate: "revealElement" is activate-class and this session holds no activate authority for any element - this session was started without that class, and only a session started with it can perform this method';

// The application listing (schema version 1.4.0, ADR-0042). Observe-class: it
// reads the fence around an application and never anything behind it. The
// method is routed; this refusal fires only when the session's backend cannot
// enumerate what the machine has (InventoryUnsupportedError), and it names the
// route rather than the application, so it says nothing about what this
// machine has - which is the property ADR-0042 changes, not one it keeps.
export const LIST_APPLICATIONS_REFUSAL =
  'refused by the inventory gate: "listApplications" is observe-class and this session\'s backend cannot enumerate what this machine has installed - the answer would have to be an empty list, which would say the machine has nothing rather than that this route cannot look';

// THE ONE SOURCE OF TRUTH FOR WHAT MAY BE DONE WITH AN APPLICATION.
//
// The listing and the enforcement are the same function, asked at two
// different moments. This is the requirement the agreement test pins: two
// hand-maintained lists that happen to match today are a divergence waiting to
// ship, and the divergence is worse than either error alone - a listing that
// promises what the gate refuses teaches a caller a capability it does not
// have, and a listing that withholds what the gate would allow teaches a limit
// that is not real.
//
// The order below is the enforcement order, and it has to be: session
// authority first (ADR-0019 - what this daemon was started with), the user's
// configuration second (ADR-0043 clause 4 - what the machine's owner turned
// off), and the daemon's own reach last. Each answers with a different remedy,
// which is why the states are not collapsed: a capability withheld by
// configuration NAMES its setting and a capability this daemon has no path to
// says so, because no setting would grant it.
export function capabilityStateFor(
  launch: LaunchContext,
  capability: CapabilityName,
  application: string,
): Capability {
  // What this daemon can do AT ALL for this application, before any question
  // of permission. Launch needs a recipe; the element verbs need an element,
  // which is a question about a running application rather than about this
  // one, so they are reported on their own terms below.
  if (capability === "launch" && findRecipe(application, launch.catalog) === undefined) {
    return { capability, availability: "not-exposed" };
  }
  // Observe is the grants file's, and it is the one capability whose session
  // answer is a NAME set rather than a class: an application this session may
  // not read is still listed (that is the reversal), with observe off.
  const held =
    capability === "observe"
      ? // Deny by default when nothing was composed (ADR-0036, the grants
        // file's own posture): a context with no observe set has been granted
        // nothing, and reporting "all" here would advertise a read the reader
        // would then refuse. startServer always passes the set it composed, so
        // this fallback answers for a context built without a server at all.
        isVisible(launch.visibility ?? new Set(), application)
      : capability === "launch"
        ? launch.permits.has(normalise(application))
        : holdsEffectAuthority(launch, capability);
  if (!held) {
    return {
      capability,
      availability: "disabled-by-configuration",
      disabledBy: capability === "observe" ? OBSERVE_SETTING : sessionSettingFor(capability),
    };
  }
  const withheld = configurationWithholding(launch, capability, application);
  if (withheld !== undefined) {
    return { capability, availability: "disabled-by-configuration", disabledBy: withheld };
  }
  return { capability, availability: "available" };
}

// The session flag that would change a session-scoped answer. It is a setting
// like any other from the caller's side - the difference is that changing it
// means restarting the daemon rather than editing a file, and saying which
// flag is what makes that actionable.
function sessionSettingFor(capability: CapabilityName): string {
  return capability === "launch" ? "the session flag --permit <application>" : `the session flag --allow ${capability}`;
}

// WHETHER ONE APPLICATION IS ANSWERING, decided here and not in the backend
// (ADR-0063).
//
// The grant is checked FIRST and short-circuits the census entirely. That
// order is the whole point: a session with no observe grant for an application
// is not permitted to know, and reporting the census's answer to it would leak
// the desk through a field that is not gated. Reporting "not-answering"
// instead would be worse - a false statement about the desktop manufactured
// out of a fact about permission - so the answer is cannot-tell, naming the
// grants file, which genuinely is the setting a person would change to be told.
//
// isVisible is the same reader the observe capability uses six lines up, on the
// same deny-by-default fallback, so the field and the capability beside it can
// never disagree about what this session may see.
function runningFieldsFor(
  launch: LaunchContext,
  census: RunningCensus,
  entry: { name: string; diagnostic?: Record<string, string> },
  claims: ReadonlyMap<string, number>,
): { running: RunningState; runningUnknownBy?: string } {
  if (!isVisible(launch.visibility ?? new Set(), entry.name)) {
    return { running: "cannot-tell", runningUnknownBy: OBSERVE_SETTING };
  }
  // A cannot-tell from the census is a DIFFERENT ignorance: this session may
  // look, and the route that answered has no view of that name. No setting
  // changes that, so none is named - offering the grants file here would send
  // a person to edit a file that cannot help. The bare cannot-tell is the
  // honest answer, and the schema says so.
  const names = censusNamesOf(entry, launch.catalog);
  const answering = [...names].filter((name) => census.observable.has(name));
  // AN AMBIGUOUS MATCH IS NOT A MEASUREMENT. Two entries can offer the same
  // runtime name (`org.kde.dolphin` and a second packaging of it both answer
  // to `dolphin`), and the bus publishes one name, not which entry started it.
  // Naming one of them the running one would be a coin flip reported as a
  // reading, so both are told the truth: something answers to that name and
  // this daemon cannot say which of you it is.
  if (answering.some((name) => (claims.get(name) ?? 0) > 1)) return { running: "cannot-tell" };
  if (answering.length > 0) return { running: "answering" };
  // Absence is only a measurement if EVERY name this entry could answer to was
  // within the horizon. Otherwise the route never had a view of it.
  const states = [...names].map((name) => runningStateOf(census, name));
  return { running: states.every((state) => state === "not-answering") ? "not-answering" : "cannot-tell" };
}

// THE NAMES ONE INSTALLED ENTRY COULD BE ANSWERING TO.
//
// The census keys on RUNTIME names - what the desk calls the process - and an
// entry is named by its desktop-entry id. `org.kde.kate` runs as `kate`, so
// asking the census under the id alone gets not-answering for an editor
// sitting open on screen. The catalog's appears-as join already owns this
// translation for applications this daemon has a recipe for; the majority that
// have no recipe need the same join from what the ENTRY ITSELF said.
//
// Every candidate is read off the entry - the id, its final dot-segment, and
// the `Name=` the machine put in the file - never guessed from a table of
// known applications, which is the ACTIONS_BY_ROLE mistake in another costume.
// The residual is real and recorded: an application whose bus name matches
// none of these is reported not-answering while open. That is narrower than
// the alternative of reporting every recipe-less application cannot-tell, and
// it is why an ambiguous positive degrades rather than picks.
function censusNamesOf(entry: { name: string; diagnostic?: Record<string, string> }, catalog: LaunchCatalog): Set<string> {
  const names = new Set<string>([normalise(entry.name), treeNameOf(entry.name, catalog)]);
  const segment = entry.name.slice(entry.name.lastIndexOf(".") + 1);
  if (segment.length > 0) names.add(normalise(segment));
  const displayed = entry.diagnostic?.["mastra-cc/display-name"];
  if (displayed !== undefined) names.add(normalise(displayed));
  return names;
}


// CAN THIS MACHINE BE HEARD AT ALL (ADR-0064). Observation of the daemon's own
// instrument rather than of any desktop behind it: it names no application,
// answers no element, and needs no grant, because there is nothing here an
// application published. A daemon assembled without an adapter says so in the
// only honest way - cannot-tell with a reason - rather than reporting the
// machine's layer off on the strength of its own incompleteness.
const NO_ADAPTER: AccessibilityReport = {
  state: "cannot-tell",
  reason: "this daemon was assembled without a way to look at the accessibility layer",
};

async function describeAccessibility(launch: LaunchContext): Promise<{ accessibility: AccessibilityReport }> {
  const layer = launch.accessibility;
  return { accessibility: layer === undefined ? NO_ADAPTER : await layer.report() };
}

// ACQUIRING IT, in the order the two refusals must be asked. The operator's
// flag first, because a daemon the operator did not arm must not report the
// platform's shape as its reason - and a machine whose layer this build cannot
// touch must not be told to go and change a setting that would not help. Both
// sentences use the wire's standing vocabulary (protocol/schema.json:236,241).
const ACQUIRE_WITHHELD_REFUSAL =
  `refused before acting: switching this machine's accessibility layer on is disabled-by-configuration, ` +
  `withheld by ${ACQUIRE_SETTING} - an operator arms it at startup, and no request can`;
const ACQUIRE_NOT_EXPOSED_REFUSAL =
  "refused before acting: switching this machine's accessibility layer on is not-exposed on this platform - " +
  "this build has no adapter that could, and no setting would change that";
const ACQUIRE_FAILED_REFUSAL =
  "refused after acting: this machine's accessibility layer did not accept being switched on";

async function acquireAccessibility(launch: LaunchContext): Promise<Classified<{ accessibility?: AccessibilityReport; refusal?: string }>> {
  if (launch.mayAcquireAccessibility !== true) {
    return { refusal: ACQUIRE_WITHHELD_REFUSAL, refusalClass: "DisabledByConfiguration" };
  }
  const layer = launch.accessibility;
  if (layer === undefined || !layer.acquirable) {
    return { refusal: ACQUIRE_NOT_EXPOSED_REFUSAL, refusalClass: "AccessibilityNotAcquirable" };
  }
  try {
    await layer.acquire();
  } catch {
    return { refusal: ACQUIRE_FAILED_REFUSAL, refusalClass: "AccessibilityNotAcquired" };
  }
  // RE-READ, never report the intention. The state that goes back is measured
  // after the attempt, so a write that was accepted and changed nothing is
  // visible as what it is rather than as success (ADR-0064 clause 6).
  return { accessibility: await layer.report() };
}

// The listing (ADR-0042). Existence and permission are readable; nothing from
// inside an application is. The backend answers WHAT EXISTS and this function
// answers WHAT MAY BE DONE - the second half from the same tables the gates
// enforce, never from a list written beside them.
async function listApplications(backend: Backend, launch: LaunchContext): Promise<Classified<ListApplicationsResult>> {
  let installed;
  try {
    installed = await backend.installedApplications();
  } catch (error) {
    // A route that cannot enumerate refuses by name rather than answering
    // emptily. Any other failure is the daemon's usual opaque backstop.
    if (error instanceof InventoryUnsupportedError) return { refusal: LIST_APPLICATIONS_REFUSAL, refusalClass: "InventoryUnsupported" };
    throw error;
  }
  // THE LISTING IS A UNION, not the desktop-entry scan alone.
  //
  // What a machine offers is not the same set as what ships a .desktop file.
  // This daemon has recipes for applications that ship none - a dialog tool, a
  // browser started with particular arguments - and it will launch any of them
  // on request. A listing built from the scan alone answered "no" about an
  // application the very next call would start, which is the false belief
  // ADR-0042 exists to prevent, arriving through the other door. Found by the
  // live proof leg; the offline fixture had quietly granted every launchable
  // application an entry of its own.
  //
  // Installed entries come first and keep their diagnostic: a recipe adds a
  // name the scan could not see, and never overwrites what the machine itself
  // said about an application it does have.
  const byName = new Map(installed.map((entry) => [normalise(entry.name), entry]));
  for (const key of Object.keys(launch.catalog)) {
    if (!byName.has(normalise(key))) byName.set(normalise(key), { name: key });
  }
  // WHAT IS ANSWERING (ADR-0063), asked once for the whole listing rather than
  // once per application.
  //
  // A route that cannot see a name says so IN the census - an empty horizon
  // makes every entry cannot-tell - so there is nothing to catch here. A throw
  // means the instrument itself failed, and it travels like any other backend
  // failure rather than being flattened into "nothing is running".
  let census: RunningCensus;
  try {
    census = await backend.runningApplications();
  } catch {
    // THE INSTRUMENT FAILED, WHICH IS NOT NEWS ABOUT THE DESKTOP. Before this
    // field existed the listing was a filesystem scan and answered on a machine
    // with no accessibility bus at all; letting the census's throw take the
    // whole listing down would have made "what is installed" depend on whether
    // the desk is listening. An empty census with an empty horizon says the
    // honest thing instead - cannot-tell for every entry, no setting named,
    // because none would help.
    census = { observable: new Set(), answersFor: new Set() };
  }
  // Which runtime names more than one entry could answer to, counted once for
  // the listing so an ambiguous match can be told from a certain one.
  const claims = new Map<string, number>();
  for (const entry of byName.values()) {
    for (const name of censusNamesOf(entry, launch.catalog)) claims.set(name, (claims.get(name) ?? 0) + 1);
  }
  return {
    applications: [...byName.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({
        name: entry.name,
        capabilities: CAPABILITY_NAMES.map((capability) => capabilityStateFor(launch, capability, entry.name)),
        // A statement about this daemon's own recipes, never about permission:
        // an application can be installed and honestly not launchable.
        launchable: findRecipe(entry.name, launch.catalog) !== undefined,
        ...runningFieldsFor(launch, census, entry, claims),
        ...(entry.diagnostic === undefined ? {} : { diagnostic: entry.diagnostic }),
      })),
  };
}

// The change stream (ADR-0039). Both subscription methods are observe-class:
// a watch reads and cannot cause anything. They are on the wire before either
// route can serve them, on ADR-0037's reasoning - the contract is the thing
// being frozen, and a method that does not exist cannot be refused honestly.
// Until a backend can watch a subtree, these name the check that ran and what
// would change the answer; the behaviour arrives route by route, and the
// refusal for a route that will never serve it stays exactly here.
// A watch on an id this session's backend never answered. ONE constant for
// "no such element" and "an element inside an application this session cannot
// see": the byte-equality is the security property (ADR-0008 rule 6,
// ADR-0036), exactly as it is for an unavailable application.
export const SUBSCRIBE_UNKNOWN_REFUSAL =
  'refused by the change stream: no element with that id was ever answered by this daemon - a watch is established on something this session has read, and nothing else';

// A watch is per-connection state: the connection that asked is the one that
// is fed, and the watch dies with it. A subscribe arriving outside a
// connection has nowhere to be delivered, and an event with no listener is a
// watch that says nothing.
export const SUBSCRIBE_NO_CONNECTION_REFUSAL =
  'refused by the change stream: "subscribeElement" was called outside a connection - a watch is per-connection state, and there is nowhere to deliver its events';

export const SUBSCRIBE_PRIORITY_REFUSAL =
  `refused by the change stream: "priority" must be one of ${PRIORITIES.join(", ")} - the daemon carries the label back unread, but it will not carry one the schema does not define`;

export const SUBSCRIBE_UNSUPPORTED_REFUSAL =
  'refused by the change stream: "subscribeElement" is defined by the schema but this session\'s backend cannot yet watch an element for changes - the watch would be accepted and then say nothing, which is indistinguishable from a quiet desktop, so it is refused instead';

// The route is built and DEAF RIGHT NOW: it registered for its signals,
// caused one of its own as a probe, and the probe never arrived. Distinct
// from "not built yet" above because the remedy is different, and the
// distinction must be legible in the transcript - a deaf daemon must never
// run as if it could hear (the M0.5 spike: a missing registration fails
// silently and looks identical to a calm desktop).
export const SUBSCRIBE_DEAF_REFUSAL =
  "refused by the change stream: the accessibility route registered for its signals, caused one of its own, and never heard it come back - a watch handed back deaf is indistinguishable from a quiet desktop, so no watch was established";

export const UNSUBSCRIBE_UNKNOWN_REFUSAL =
  'refused by the change stream: "unsubscribeElement" was given a subscription this connection does not hold - a watch is per-connection state, and ending one that was never established would report a change of state that did not happen';

// ---------------------------------------------------------------------------
// The change stream's server half (ADR-0039).
//
// A backend reports SHAPES - which element, what role, what kind of change -
// and states which application the watched root lives in. It cannot know what
// verb the daemon has in flight, so it never states an attribution. The server
// can know, because every backend call goes through the serialised chain
// below: at most one verb is open at a time.

interface Cause {
  causeId: string;
  /** the application the verb names, once the verb is allowed to name one */
  application?: string;
}

// The verb currently open in the serialised chain, or undefined for a quiet
// daemon. Observe-class methods never set it: reading causes nothing, so a
// change that arrives during a read was not caused by the read.
let inFlight: Cause | undefined;

function mintCauseId(): string {
  return `cause-${randomBytes(6).toString("hex")}`;
}

// A verb names its target once it is allowed to: openApplication does so only
// after the permit check has passed, because resolving a name against the
// catalog before authority would be the capability probe ADR-0019 forbids.
// Until a verb names one, every concurrent change is unattributed - the daemon
// abstains rather than guessing.
function causeNames(application: string): void {
  if (inFlight !== undefined) inFlight = { causeId: inFlight.causeId, application };
}

export interface AttributionStamp {
  attribution: Attribution;
  causeId?: string;
}

// The whole attribution rule, in one place. Three answers, and the third one
// is the point (ADR-0039, ADR-0032 clause 4).
export function attribute(changeApplication: string, cause: Cause | undefined = inFlight): AttributionStamp {
  if (cause !== undefined) {
    if (cause.application !== undefined && normalise(cause.application) === normalise(changeApplication)) {
      return { attribution: "self", causeId: cause.causeId };
    }
    // ADR-0039: a verb is open, but nothing binds THIS change to it - it
    // happened somewhere the verb does not reach. The honest answer is that we
    // do not know which it was, and the daemon says so instead of picking the
    // likelier story. Never external (that claims we know it was not us),
    // never self (that claims it was).
    return { attribution: "unattributed" };
  }
  // Nothing was in flight, so nothing of ours caused it. That is news, not an
  // alarm: it is recorded and never flagged.
  return { attribution: "external" };
}

interface OpenSubscription {
  readonly id: string;
  readonly priority: Priority;
  readonly application: string;
  readonly backendSubscription: BackendSubscription;
  /** false once the root vanished and the watch ended itself */
  alive: boolean;
}

// One connection's watches. The book belongs to the socket: it is created when
// the connection is accepted and emptied when it closes, and no watch outlives
// the client that asked for it.
export class SubscriptionBook {
  private readonly open = new Map<string, OpenSubscription>();
  constructor(
    private readonly emit: (event: ChangeEvent) => void,
    // Visibility is re-checked where events are STAMPED, not only where
    // subscriptions are created: a grant is a statement about now, and an
    // application that has left the visible set must stop being narrated
    // mid-watch (ADR-0036).
    private readonly visibility: Visibility = "all",
  ) {}

  async subscribe(backend: Backend, id: string, priority: Priority): Promise<string> {
    // The sink is installed before the subscription id exists, so it captures
    // the id by closure once it does. A change arriving in that window is
    // delivered, not dropped: the client asked to watch, and the daemon does
    // not decide the first change was less real than the rest.
    let subscriptionId = "";
    const backendSubscription = await backend.subscribeElement(id, (change: BackendChange) => {
      if (subscriptionId === "") return;
      this.deliver(subscriptionId, change);
    });
    subscriptionId = backendSubscription.subscriptionId;
    this.open.set(subscriptionId, {
      id,
      priority,
      application: backendSubscription.application,
      backendSubscription,
      alive: true,
    });
    return subscriptionId;
  }

  private deliver(subscriptionId: string, change: BackendChange): void {
    const entry = this.open.get(subscriptionId);
    if (entry === undefined || !entry.alive) return;
    // An application outside the visible set is ABSENT, not filtered-with-a-
    // notice: nothing is emitted at all, which is byte-identical to the quiet
    // desktop an ungranted application is supposed to look like.
    if (!isVisible(this.visibility, entry.application)) return;
    const stamp = attribute(entry.application);
    this.emit({
      subscriptionId,
      id: change.id,
      role: change.role,
      kind: change.kind,
      attribution: stamp.attribution,
      ...(stamp.causeId === undefined ? {} : { causeId: stamp.causeId }),
      priority: entry.priority,
      at: Date.now(),
    });
    if (change.kind === "watchEnded") {
      // The root is gone. The watch ends here and says which element it was
      // watching; it is NEVER re-anchored by name onto whatever took the
      // element's place (ADR-0038's lesson, ADR-0039).
      entry.alive = false;
      void entry.backendSubscription.close();
    }
  }

  async end(subscriptionId: string): Promise<boolean> {
    const entry = this.open.get(subscriptionId);
    if (entry === undefined) throw new UnknownSubscriptionError(subscriptionId);
    this.open.delete(subscriptionId);
    // Ending a watch that already ended itself is not an error: the answer
    // says the watch is not running, which is the state the caller wanted
    // either way.
    if (!entry.alive) return false;
    await entry.backendSubscription.close();
    return true;
  }

  async closeAll(): Promise<void> {
    for (const entry of this.open.values()) {
      if (entry.alive) await entry.backendSubscription.close();
    }
    this.open.clear();
  }

  get size(): number {
    return this.open.size;
  }

  // Which element a watch is on. The record names the element a subscription
  // was established on and the one it ended on, and it can only ask before the
  // book forgets - the answer is read here rather than reconstructed after.
  watchedElement(subscriptionId: string): string | undefined {
    return this.open.get(subscriptionId)?.id;
  }
}

async function subscribeElement(
  params: { id?: unknown; priority?: unknown },
  backend: Backend,
  book: SubscriptionBook | undefined,
): Promise<Classified<SubscribeElementResult>> {
  if (book === undefined) return { refusal: SUBSCRIBE_NO_CONNECTION_REFUSAL, refusalClass: "NoConnection" };
  const id = typeof params.id === "string" ? params.id : "";
  const priority = params.priority;
  if (typeof priority !== "string" || !(PRIORITIES as readonly string[]).includes(priority)) {
    return { refusal: SUBSCRIBE_PRIORITY_REFUSAL, refusalClass: "MalformedParameter" };
  }
  try {
    const subscriptionId = await book.subscribe(backend, id, priority as Priority);
    // The id is echoed so a client holding several watches can bind this
    // answer to the request that asked for it without keeping its own book.
    // A watch is a standing read, so the receipt names the element it was
    // established ON - the changes it goes on to deliver do not each write an
    // entry of their own, because the access the record is about is the one
    // granted here.
    return { subscription: { subscriptionId, id, priority: priority as Priority }, auditElement: [{ id }] };
  } catch (error) {
    if (error instanceof UnwatchableElementError) return { refusal: SUBSCRIBE_UNKNOWN_REFUSAL, refusalClass: "WatchUnknownElement" };
    // Deaf before unsupported: DeafWatchError is the narrower promise-keeping
    // (built, and cannot hear right now) and must not be reported as "not
    // built yet".
    if (error instanceof DeafWatchError) return { refusal: SUBSCRIBE_DEAF_REFUSAL, refusalClass: "WatchDeaf" };
    if (error instanceof WatchUnsupportedError) return { refusal: SUBSCRIBE_UNSUPPORTED_REFUSAL, refusalClass: "WatchUnsupported" };
    throw error;
  }
}

async function unsubscribeElement(
  params: { subscriptionId?: unknown },
  book: SubscriptionBook | undefined,
): Promise<Classified<UnsubscribeElementResult>> {
  const subscriptionId = typeof params.subscriptionId === "string" ? params.subscriptionId : "";
  if (book === undefined) return { refusal: UNSUBSCRIBE_UNKNOWN_REFUSAL, refusalClass: "UnknownSubscription" };
  // Asked before the book forgets: ending a watch is the close of a standing
  // read, and the receipt says which element stopped being watched.
  const watched = book.watchedElement(subscriptionId);
  try {
    return { ended: await book.end(subscriptionId), ...(watched === undefined ? {} : { auditElement: [{ id: watched }] }) };
  } catch (error) {
    if (error instanceof UnknownSubscriptionError) return { refusal: UNSUBSCRIBE_UNKNOWN_REFUSAL, refusalClass: "UnknownSubscription" };
    throw error;
  }
}

// The three element verbs, each refused BEFORE the backend is reached when this
// session does not hold the class. Written as named functions rather than inline
// in the table because the table's entries must each stay on one line - and
// because the ordering inside them is the property the timing test pins: the
// authority question is asked first, and every path that answers it "no" returns
// without an await against the backend.
//
// The backend's own error vocabulary is translated to refusals here, at the one
// place that knows both sides. Each translation keeps the backend's sentence
// intact: the seam already names the check that ran and what would change the
// answer, and rewording it here would put the daemon's voice over the
// application's measurement.
//
// Naming the target is what makes the change self-attributed, and it happens
// here for the same reason openApplication does it after its permit check: the
// name is asked for only once the call is allowed to proceed. The backend
// answers from what it already recorded while walking, so this costs no
// exchange - and an id the backend never answered names nothing, which leaves
// every concurrent change unattributed rather than guessed (ADR-0039).
async function performEffect(
  effectClass: CapabilityName,
  method: string,
  refusal: string,
  launch: LaunchContext,
  backend: Backend,
  id: string,
  // The closure may answer with a refusal of its own rather than an element -
  // that is how a malformed parameter is refused AFTER both gates have run.
  // Deciding it here, inside the closure, is ADR-0021's ordering applied one
  // rung down: refusing for want of authority says nothing about whether the
  // parameters were any good, and a session that lacks the class must not be
  // handed a critique of the value it sent instead of the sentence about the
  // class it does not hold.
  perform: () => Promise<Classified<{ element?: SemanticElement; refusal?: string }>>,
  // The attestation the caller carried, where the method takes one. The audit
  // module hashes it into an identifier; the words never reach the record.
  attestation?: string,
): Promise<Classified<{ element?: SemanticElement; refusal?: string }>> {
  // THE FIRST OF THE THREE AUDIT CALL SITES (ADR-0026). Every element effect
  // this daemon performs or refuses passes through the decision below, and the
  // receipt is written once, here, after it - never inside the branches, which
  // is how an effect ends up with a path that leaves no receipt.
  //
  // The application is read from the same value the gates were handed, and the
  // cause from the attribution machinery that already exists (attribute(), one
  // implementation): a second one written for the record could disagree with
  // the one the change stream states, and two attributions of one effect is
  // worse than none.
  let application: string | undefined;
  const decide = async (): Promise<Classified<{ element?: SemanticElement; refusal?: string }>> => {
    // Refused for want of authority, and the application is deliberately not
    // asked for: ADR-0019's ordering says an unheld class is answered before
    // anything names a target, and the receipt records what the daemon knew,
    // not what it could have gone and looked up to fill a field in.
    if (!holdsEffectAuthority(launch, effectClass)) return { refusal, refusalClass: "EffectClassGate" };
    // Authority first, configuration second (ADR-0019's order, one rung down):
    // the session-wide answer needs no application, so asking it first means an
    // id this daemon never answered is refused without the configuration ever
    // being consulted about a name nobody can supply. Both run BEFORE the call.
    application = backend.applicationOfElement(id);
    const withheld = configurationWithholding(launch, effectClass, application);
    if (withheld !== undefined) {
      return { refusal: withheldRefusal(method, effectClass, withheld), refusalClass: "DisabledByConfiguration" };
    }
    if (application !== undefined) causeNames(application);
    try {
      return await perform();
    } catch (error) {
      // Every one of these is a refusal the caller can act on, and each carries
      // the sentence the seam wrote. AttestationFailedError is the daemon's own
      // inability to describe a commit (ADR-0008 rule 2) and is deliberately in
      // the same list: it refuses the call, it does not fail it.
      if (
        error instanceof AttestationFailedError ||
        error instanceof UnperformableElementError ||
        error instanceof UnpublishedActionError ||
        error instanceof OperationNotExposedError ||
        error instanceof MagnitudeOutOfRangeError ||
        error instanceof TextOffsetOutOfRangeError ||
        error instanceof WriteNotObservedError ||
        error instanceof EffectUnsupportedError
      ) {
        return { refusal: error.message, refusalClass: error.constructor.name as RefusalClass };
      }
      throw error;
    }
  };
  let answer: Classified<{ element?: SemanticElement; refusal?: string }>;
  try {
    answer = await decide();
  } catch (error) {
    // The route threw something that is not a refusal. The caller gets the
    // opaque backstop as it always has; the record says an effect was attempted
    // on this element and did not finish, which is a fact about access and is
    // exactly what an access record loses by only writing down the tidy cases.
    recordAudit({ application, element: [{ id }], scope: effectClass, cause: causeOf(application), attestation, outcome: FAILED });
    throw error;
  }
  recordAudit({ application, element: [elementOf(id, answer.element)], scope: effectClass, cause: causeOf(application), attestation, outcome: outcomeOf(answer) });
  return answer;
}

// Identity, and the role only where the daemon actually answered one: a
// refused effect answers no element, and inventing a role for it would put a
// guess in the record beside facts.
function elementOf(id: string, element: SemanticElement | undefined): AuditSubject {
  return element === undefined ? { id } : element;
}

// The record's own reading of what happened, in the closed vocabulary. A
// refusal is named by its class; the sentence goes to the caller, as it always
// has, and it does not go to disk.
function outcomeOf(answer: Classified<{ refusal?: string }>): string {
  return answer.refusal === undefined ? PERFORMED : refused(answer.refusalClass);
}

// The cause, from the machinery that already answers this question. An effect
// that named its application is self-attributed under the id minted for it;
// one that named nothing is unattributed, and that honest third answer is
// recorded rather than smoothed into a guess (ADR-0039).
function causeOf(application: string | undefined): AuditCause {
  return attribute(application ?? "");
}

function editElement(params: { id?: unknown; value?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const value = typeof params.value === "string" ? params.value : "";
  return performEffect("edit", "editElement", EDIT_SCOPE_REFUSAL, launch, backend, id, () => backend.editElement({ id, value }) as Promise<{ element: SemanticElement }>);
}

function activateElement(params: { id?: unknown; action?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const action = typeof params.action === "string" ? params.action : "";
  return performEffect("activate", "activateElement", ACTIVATE_SCOPE_REFUSAL, launch, backend, id, () => backend.activateElement({ id, action }) as Promise<{ element: SemanticElement }>);
}

// The attestation is carried and never validated. The daemon cannot check
// whether the caller's restatement is TRUE - two honest restatements of one
// commit differ - so the check that means something is the daemon's own, made
// on the seam against the element as it stands (AttestationFailedError above).
function submitElement(params: { id?: unknown; attestation?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const attestation = typeof params.attestation === "string" ? params.attestation : "";
  return performEffect("submit", "submitElement", SUBMIT_SCOPE_REFUSAL, launch, backend, id, () => backend.submitElement({ id, attestation }) as Promise<{ element: SemanticElement }>, attestation);
}

// A number that arrives as something other than a number is refused here, by
// name, and this is the one place these four handlers hold a rule of their own.
//
// The string-valued fields need no such rule: an absent or wrong-typed string
// becomes "", and "" is a thing an element can honestly be asked to hold. A
// number has no such empty value. Zero is a magnitude the element may well
// accept, and NaN passes every range check written against it - `NaN < minimum`
// and `NaN > maximum` are both false - so coercing would send the platform a
// value nobody asked for and then report the write as performed. An absent
// optional offset means "the whole content" or "the end of the text", so
// treating a malformed one as absent would invent exactly the default the wire
// is forbidden to invent.
//
// The check runs INSIDE the perform closure, which puts it after both gates.
// That ordering is ADR-0021's, one rung down: a session that does not hold the
// class must hear about the class, not about the value it sent, because
// refusing for want of authority says nothing about whether the parameters were
// any good. It is still before the call - the backend is never touched to
// produce this refusal.
//
// The sentence names the method, the field, and what would change the answer
// (ADR-0008 clause 5), in the shape the change stream's priority refusal
// already uses for a malformed parameter.
function malformedNumberRefusal(method: string, field: string): string {
  return `refused before the call: "${method}" was given a ${JSON.stringify(field)} that is not a number - the operation is expressed in numbers the element itself published, and there is no value this daemon could substitute that the caller actually asked for`;
}

function setElementValue(params: { id?: unknown; value?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const value = params.value;
  return performEffect("edit", "setElementValue", SET_VALUE_SCOPE_REFUSAL, launch, backend, id, async () => {
    if (typeof value !== "number" || !Number.isFinite(value)) return { refusal: malformedNumberRefusal("setElementValue", "value"), refusalClass: "MalformedParameter" as const };
    return backend.setElementValue({ id, value });
  });
}

// An absent offset is meaningful on both methods that take one - "replace the
// whole content", "place the caret at the end" - so absent is passed through as
// absent and only a PRESENT malformed one is refused.
function offsetOf(offset: unknown): number | undefined | "malformed" {
  if (offset === undefined) return undefined;
  if (typeof offset !== "number" || !Number.isFinite(offset)) return "malformed";
  return offset;
}

function setElementText(params: { id?: unknown; text?: unknown; offset?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const text = typeof params.text === "string" ? params.text : "";
  const offset = offsetOf(params.offset);
  return performEffect("edit", "setElementText", SET_TEXT_SCOPE_REFUSAL, launch, backend, id, async () => {
    if (offset === "malformed") return { refusal: malformedNumberRefusal("setElementText", "offset"), refusalClass: "MalformedParameter" as const };
    return backend.setElementText({ id, text, offset });
  });
}

function setElementCaret(params: { id?: unknown; offset?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  const offset = offsetOf(params.offset);
  return performEffect("edit", "setElementCaret", SET_CARET_SCOPE_REFUSAL, launch, backend, id, async () => {
    if (offset === "malformed") return { refusal: malformedNumberRefusal("setElementCaret", "offset"), refusalClass: "MalformedParameter" as const };
    return backend.setElementCaret({ id, offset });
  });
}

function revealElement(params: { id?: unknown }, backend: Backend, launch: LaunchContext) {
  const id = typeof params.id === "string" ? params.id : "";
  return performEffect("activate", "revealElement", REVEAL_SCOPE_REFUSAL, launch, backend, id, () => backend.revealElement({ id }));
}

// The dispatch table names every method the daemon serves, its effect class,
// and WHEN its enforcement runs. B11 (tools/pins/b11.mjs, wired in this same
// commit) reads this table from source and asserts every non-observe entry is
// marked "before-call" - result-time enforcement is legitimate only for
// observe, because filtering a response does not unsend the email. The
// enforcement TIMING itself is pinned by the ordering test in
// __tests__/launch-authority.test.ts; the pin and the test together are B11.
// Keep each entry on ONE line: b11.mjs parses entries line-by-line, and a
// multi-line entry would silently escape its scrutiny.
type Handler = (params: unknown, backend: Backend, launch: LaunchContext, book?: SubscriptionBook) => Promise<unknown>;
const DISPATCH: Record<string, { effectClass: string; enforcement: string; handler: Handler }> = {
  queryElements: { effectClass: "observe", enforcement: "at-result", handler: async (p, b, l) => observedWithConfiguration(await b.queryElements((p ?? {}) as never), b, l) },
  attestElement: { effectClass: "observe", enforcement: "at-result", handler: async (p, b, l) => observedWithConfiguration(await b.attestElement((p ?? {}) as never), b, l) },
  readElementContent: { effectClass: "observe", enforcement: "at-result", handler: async (p, b) => b.readElementContent((p ?? {}) as never) },
  subscribeElement: { effectClass: "observe", enforcement: "at-result", handler: (p, b, _l, k) => subscribeElement((p ?? {}) as never, b, k) },
  unsubscribeElement: { effectClass: "observe", enforcement: "at-result", handler: (p, _b, _l, k) => unsubscribeElement((p ?? {}) as never, k) },
  openApplication: { effectClass: "activate", enforcement: "before-call", handler: (p, b, l) => openApplication((p ?? {}) as { name?: string }, b, l) },
  editElement: { effectClass: "edit", enforcement: "before-call", handler: (p, b, l) => editElement((p ?? {}) as { id?: unknown; value?: unknown }, b, l) },
  activateElement: { effectClass: "activate", enforcement: "before-call", handler: (p, b, l) => activateElement((p ?? {}) as { id?: unknown; action?: unknown }, b, l) },
  submitElement: { effectClass: "submit", enforcement: "before-call", handler: (p, b, l) => submitElement((p ?? {}) as { id?: unknown; attestation?: unknown }, b, l) },
  setElementValue: { effectClass: "edit", enforcement: "before-call", handler: (p, b, l) => setElementValue((p ?? {}) as { id?: unknown; value?: unknown }, b, l) },
  setElementText: { effectClass: "edit", enforcement: "before-call", handler: (p, b, l) => setElementText((p ?? {}) as { id?: unknown; text?: unknown; offset?: unknown }, b, l) },
  setElementCaret: { effectClass: "edit", enforcement: "before-call", handler: (p, b, l) => setElementCaret((p ?? {}) as { id?: unknown; offset?: unknown }, b, l) },
  revealElement: { effectClass: "activate", enforcement: "before-call", handler: (p, b, l) => revealElement((p ?? {}) as { id?: unknown }, b, l) },
  listApplications: { effectClass: "observe", enforcement: "at-result", handler: (_p, b, l) => listApplications(b, l) },
  describeAccessibility: { effectClass: "observe", enforcement: "at-result", handler: (_p, _b, l) => describeAccessibility(l) },
  // Its own effect class, not one of the five capability names, because it is
  // not a capability: it is machine-scoped, and the capability list is
  // per-application and exhaustive (ADR-0064 clause 4). The class still gates
  // it before the call, which is what B11 is about.
  acquireAccessibility: { effectClass: "acquire", enforcement: "before-call", handler: (_p, _b, l) => auditedAcquire(l) },
};

// The acquire route writes its own record, like every other effect route and
// unlike the observe ones: a change to the OPERATOR'S MACHINE is the least
// deniable thing this daemon can do, so it is attributable whether it was
// performed, refused, or failed. No application and no element - there is
// neither - which is precisely the case `application: null` was defined for.
async function auditedAcquire(launch: LaunchContext): Promise<Classified<{ accessibility?: AccessibilityReport; refusal?: string }>> {
  const answer = await acquireAccessibility(launch);
  recordAudit({
    application: undefined,
    element: [],
    scope: "acquire",
    cause: causeOf(undefined),
    outcome: answer.refusal === undefined ? PERFORMED : refused(answer.refusalClass),
  });
  return answer;
}

const POLL_BUDGET_MS = 10_000; // how long a launched app gets to become readable
const POLL_INTERVAL_MS = 250;

// The appears-as join (ADR-0038). A composed profile identity launches a
// browser that still calls itself "chrome" in the semantic tree, because the
// browser reports its own product name whichever profile it opened
// (backends/cdp/index.ts). So the tree is queried under the name the recipe
// says it will answer to, never the catalog key.
function treeNameOf(name: string, catalog: LaunchCatalog): string {
  return normalise(findRecipe(name, catalog)?.appearsAs ?? name);
}

// A backend read that throws here means "no daemon-visible application by
// that name" - not a refusal. For the CDP backend that is literally true: a
// browser without its debug port is invisible to this backend, so unreachable
// and not-running are the same observation. This tolerance covers BOTH call
// sites (the pre-spawn already-running check and the post-spawn poll, where a
// per-tick exception is "not ready yet" within the poll budget) - without it,
// opening the browser while the browser is down would refuse instead of
// launching.
async function findApplication(backend: Backend, name: string): Promise<SemanticElement | undefined> {
  try {
    const { elements } = await backend.queryElements({ role: "application", name });
    return elements.find((el) => el.role === "application" && normalise(el.name) === normalise(name));
  } catch (error) {
    // An observation that ran out of budget did not establish that the
    // application is absent - it established that the daemon does not know.
    // Swallowing it here would turn "I could not see the whole desktop" into
    // "that application is not running", which is the exact false absence the
    // walk was taught to refuse (ADR-0042).
    if (error instanceof IncompleteObservationError) throw error;
    return undefined;
  }
}

// FOCUS PRESERVATION (ADR-0044). A launch is a request to start an
// application; it is not a request to be interrupted, so the daemon puts back
// what it found. Three shapes, because they are three different answers and
// collapsing them would hide the one that matters: an element held focus, or
// nothing did, or this route cannot answer the question at all.
type FocusHeld =
  | { kind: "held"; element: SemanticElement }
  | { kind: "none" }
  | { kind: "unreadable" };

// Read immediately before the spawn. A throw of any kind is "unreadable" and
// is REPORTED rather than swallowed - a route that cannot read focus cannot
// promise it protected it, and clause 4 is explicit that a silent best-effort
// is worse than none.
async function focusBeforeLaunch(backend: Backend): Promise<FocusHeld> {
  try {
    const element = await backend.focusedElement();
    return element === undefined ? { kind: "none" } : { kind: "held", element };
  } catch {
    return { kind: "unreadable" };
  }
}

const FOCUS_UNREADABLE_NOTE =
  "the focus was not protected across this launch: this session's backend cannot read or restore what holds focus, " +
  "so whether this launch took the keyboard is unmeasured - only a route that can read focus back would answer differently";

function focusNotRestored(before: SemanticElement, now: SemanticElement | undefined): string {
  const holder = now === undefined ? "nothing holds it now" : `${JSON.stringify(now.name)} holds it now`;
  return (
    `the focus was not restored after this launch: ${JSON.stringify(before.name)} held it before the launch and ${holder} - ` +
    "this is not a clean launch, and the keyboard is somewhere the caller did not ask for"
  );
}

// Put focus back where it was, and answer with what is WRONG rather than with
// what worked: undefined means the focus this launch found is the focus it
// left behind, and a sentence means it is not. The verification is a read of
// the world, never a return code - restoreFocus answers with the element that
// holds focus AFTER the attempt, and this compares that answer against what it
// asked for. A route whose grab returned true and moved nothing is caught here
// (ADR-0047), which is the measurement ADR-0044 said this milestone owes.
//
// Focus that never moved is left alone deliberately: putting back what was
// never taken would itself be a focus change nobody asked for, which is the
// thing this whole path exists to prevent (clause 5).
async function restoreFocusAfterLaunch(backend: Backend, held: FocusHeld): Promise<string | undefined> {
  if (held.kind === "none") return undefined;
  if (held.kind === "unreadable") return FOCUS_UNREADABLE_NOTE;
  let after: SemanticElement | undefined;
  try {
    after = await backend.focusedElement();
  } catch {
    return FOCUS_UNREADABLE_NOTE;
  }
  if (after !== undefined && after.id === held.element.id) return undefined;
  let regained: SemanticElement | undefined;
  try {
    regained = await backend.restoreFocus(held.element.id);
  } catch {
    return focusNotRestored(held.element, after);
  }
  if (regained !== undefined && regained.id === held.element.id) return undefined;
  return focusNotRestored(held.element, regained);
}

// Where the report goes. The launch result has two shapes and the note reaches
// a reader in both: stamped into the element's diagnostic when the launch
// otherwise succeeded, and carried in the refusal when it did not. Diagnostic
// because it is debug-only by the wire's own contract and never load-bearing
// for agent logic - the schema is not changed to carry it; no field is added
// to a frozen version for a debug-only note.
function withFocusNote(element: SemanticElement, note: string | undefined): SemanticElement {
  if (note === undefined) return element;
  const diagnostic: Diagnostic & { "mastra-cc/focus-preservation": string } = {
    ...element.diagnostic,
    "mastra-cc/focus-preservation": note,
  };
  return { ...element, diagnostic };
}

// The launch handler. Order is the contract (ADR-0019): AUTHORITY first -
// the permit set is consulted before the catalog, the tree, or anything else,
// and an unpermitted name never reaches a capability probe, because the probe
// itself would leak that the application exists. Runs inside the serialised
// chain like every other operation.
async function openApplication(
  params: { name?: string },
  backend: Backend,
  launch: LaunchContext,
): Promise<OpenApplicationResult> {
  // THE SECOND AUDIT CALL SITE. A launch is an effect on the machine that no
  // element verb passes through, so a receipt written only in performEffect
  // would leave the one effect that starts a program keeping no record at all.
  //
  // The application is read back OFF the answer, never resolved here. Resolving
  // it up front means reading the catalog before the permit check, which is the
  // capability probe ADR-0019 forbids - and which the launch-authority spies
  // catch, as they did when this call site was first written.
  //
  // So the field is recorded at the fidelity the daemon actually had. Past both
  // gates a launch has resolved the name the tree answers to, and that is what
  // appears. Before them it has only the name the CALLER said, which costs no
  // catalog read because the caller supplied it - and a refused launch recorded
  // with no name at all would tell an auditor that something was refused
  // without saying what was asked for.
  const name = typeof params.name === "string" ? params.name : "";
  let answer: Classified<OpenApplicationResult>;
  try {
    answer = await decideOpenApplication(params, backend, launch);
  } catch (error) {
    // Symmetric with performEffect's FAILED path, and for the same reason: a
    // throw nobody classified reaches the caller as the opaque backstop, and a
    // launch that left no entry at all would be the one route where an
    // unexplained failure is also an unrecorded one. The name is the caller's
    // own word - past no gate, nothing has been resolved.
    recordAudit({ application: normalise(name), element: [], scope: "launch", cause: causeOf(undefined), outcome: FAILED });
    throw error;
  }
  const application = answer.auditApplication ?? normalise(name);
  recordAudit({
    application,
    element: answer.application === undefined ? [] : [answer.application],
    scope: "launch",
    cause: causeOf(application),
    outcome: outcomeOf(answer),
  });
  return withoutInternals(answer);
}

async function decideOpenApplication(
  params: { name?: string },
  backend: Backend,
  launch: LaunchContext,
): Promise<Classified<OpenApplicationResult>> {
  const name = typeof params.name === "string" ? params.name : "";
  if (!launch.permits.has(normalise(name))) {
    return { refusal: UNAVAILABLE_REFUSAL, refusalClass: "LaunchUnavailable" };
  }
  // The user's configuration, asked after the session's authority and before
  // anything is spawned or probed. A name that got this far is one this session
  // was permitted to launch, so naming the setting here tells the caller
  // nothing it did not already know - and it is the difference between "you
  // cannot" and "it is switched off, here is the switch" (ADR-0042).
  const withheld = configurationWithholding(launch, "launch", name);
  if (withheld !== undefined) return { refusal: withheldRefusal("openApplication", "launch", withheld), refusalClass: "DisabledByConfiguration" };
  const budget = launch.pollBudgetMs ?? POLL_BUDGET_MS;
  const interval = launch.pollIntervalMs ?? POLL_INTERVAL_MS;
  //
  // The catalog is read HERE, after BOTH gates, and every answer from this
  // point on can say which application it was about (auditApplication). The two
  // refusals above cannot, and do not pretend to: a name this session may not
  // launch, or one the owner switched off, is recorded as the refusal it was.
  const treeName = treeNameOf(name, launch.catalog);
  // Past the authority gate, this launch can say what it is acting on: a
  // change inside this application while the launch runs is ours (ADR-0039).
  causeNames(treeName);
  // The identity conflict guard (ADR-0038). It runs after authority and
  // BEFORE the already-running check below, and the order is the point: a
  // running chrome-work answers to the tree name "chrome", so the check below
  // would call our own browser one we did not open. Catalog keys are iterated
  // rather than table.entries(), because ownsName re-verifies (pid, starttime)
  // and so cannot fire on a process that has exited.
  // Scoped to recipes that open the browser's debugging endpoint: the conflict
  // is that endpoint, not the tree name. Derived recipes routinely share an
  // appearsAs (several desktop entries over one binary) and contend for
  // nothing, so they must not be caught by a guard about browsers.
  const requested = findRecipe(name, launch.catalog);
  const contending = requested !== undefined && contendsForBrowserEndpoint(requested) ? Object.keys(launch.catalog) : [];
  for (const key of contending) {
    if (normalise(key) === normalise(name)) continue;
    if (treeNameOf(key, launch.catalog) !== treeName) continue;
    if (launch.table.ownsName(key) !== undefined) return { refusal: ONE_BROWSER_IDENTITY_REFUSAL, refusalClass: "OneBrowserIdentity", auditApplication: treeName };
  }
  // Idempotent re-open: a live entry of ours wins - no second spawn, no
  // refusal, even when a foreign same-name copy is also running (the by-name
  // tree match cannot distinguish the two copies per element at the current
  // name-only granularity; M2.4's pid join will).
  // Nothing has been spawned yet, and nothing below this line runs without a
  // launch actually happening: the focus read costs a tree walk, so it is
  // taken after every refusal that could still fire and immediately before the
  // only thing that can move the focus (ADR-0044 clause 2).
  let held: FocusHeld = { kind: "none" };
  if (launch.table.ownsName(name) === undefined) {
    const running = await findApplication(backend, treeName);
    if (running !== undefined) {
      // Running, and not ours: refuse, never kill (ADR-0027 - the asking
      // surface arrives with a later milestone).
      return { refusal: ALREADY_RUNNING_REFUSAL, refusalClass: "AlreadyRunning", auditApplication: treeName };
    }
    held = await focusBeforeLaunch(backend);
    try {
      await launchApplication(name, launch.catalog, launch.table);
    } catch (error) {
      // The no-recipe refusal is already honest and leak-free; anything else
      // (a spawn failure) is normalised to a constant so a raw system error
      // never reaches the wire.
      const message = (error as Error).message;
      const noRecipe = message === NO_RECIPE_REFUSAL;
      return { refusal: noRecipe ? message : COULD_NOT_START_REFUSAL, refusalClass: noRecipe ? "NoRecipe" : "CouldNotStart", auditApplication: treeName };
    }
  }
  const deadline = Date.now() + budget;
  for (;;) {
    const application = await findApplication(backend, treeName);
    if (application !== undefined) {
      // The poll is the settle window: focus is put back once the launched
      // application is readable, which is the earliest moment it could have
      // taken the keyboard. A restore before that races the window that has
      // not appeared yet.
      const note = await restoreFocusAfterLaunch(backend, held);
      return { application: withFocusNote(application, note), auditApplication: treeName };
    }
    if (Date.now() >= deadline) {
      // The launch is already not clean; a focus it could not protect is said
      // in the same breath rather than dropped because there is no element to
      // hang it on.
      const note = await restoreFocusAfterLaunch(backend, held);
      const timedOut = `the application was opened but did not become readable within ${budget}ms - refusing to pretend it is ready`;
      return { refusal: note === undefined ? timedOut : `${timedOut}; ${note}`, refusalClass: "NotReadableInTime", auditApplication: treeName };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

interface Request {
  type: "request";
  id: number;
  method: string;
  params?: unknown;
}

export interface HandledResponse {
  type: "response";
  id: number;
  result?: unknown;
  refusal?: string;
}

// Serialise every backend call: one at a time, in arrival order.
let chain: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

// WHAT "TOUCHED" MEANS, DECIDED HERE. A query walks the tree - up to 150 nodes
// in an application and 2500 across the desktop - and ANSWERS the few that
// matched. The record names what was answered, not what was walked, and it says
// so out loud because the two are genuinely different claims: recording every
// walked node would put the accessible name of nearly every element on the
// desktop into an access record whose whole point is restraint, and it would
// make the record's size track the desktop's size rather than the reader's
// access. The consequence is stated rather than hidden: an element a query
// walked past and discarded leaves no entry.
//
// A watch answers no element in its result shape, so subscribe and unsubscribe
// state theirs directly (auditElement), which is why this reads both.
// The elements travel WHOLE from here; audit.ts narrows them to identity on
// the way to the disk, in one place, rather than each route remembering to.
function answeredElements(result: unknown): AuditSubject[] {
  if (result === null || typeof result !== "object") return [];
  const answer = result as Classified<{ elements?: SemanticElement[]; element?: SemanticElement }>;
  if (answer.auditElement !== undefined) return answer.auditElement;
  if (answer.elements !== undefined) return answer.elements;
  if (answer.element !== undefined) return [answer.element];
  return [];
}

// A read that answered is `read`; one that refused is named by its class. The
// distinction matters to an auditor in the one direction that counts: whether
// anything was actually seen.
function observeOutcome(result: unknown): string {
  if (result === null || typeof result !== "object") return READ;
  const answer = result as Classified<{ refusal?: string }>;
  return answer.refusal === undefined ? READ : refused(answer.refusalClass);
}

export async function handleRequest(
  request: Request,
  backend: Backend,
  launch: LaunchContext = NO_PERMITS,
  book?: SubscriptionBook,
): Promise<HandledResponse> {
  const entry = DISPATCH[request.method];
  if (!entry) {
    return {
      type: "response",
      id: request.id,
      refusal:
        `refused by the effect-class gate: "${request.method}" is not a method of ` +
        `schema v${PROTOCOL_VERSION} - the daemon serves what the schema defines and nothing else`,
    };
    // No receipt: a method the schema does not define reaches no route and
    // touches nothing, so there is no access to record. The refusal still has
    // a class (UnknownMethod) because the vocabulary is closed over what this
    // daemon refuses, not over what it happens to write down.
  }
  // A non-observe entry without before-call enforcement is unrepresentable in
  // the table above (B11 reads the source to keep it that way); this check is
  // the runtime backstop with the same refusal shape.
  if (entry.effectClass !== "observe" && entry.enforcement !== "before-call") {
    return {
      type: "response",
      id: request.id,
      refusal: `refused by the effect-class gate: "${request.method}" is ${entry.effectClass}-class but not marked for before-call enforcement`,
    };
    // No receipt, same reason: the backstop fires before the handler runs
    // (class EnforcementUnrepresentable).
  }
  try {
    const result = await serialised<unknown>(async () => {
      // An effect-class verb is a cause: it gets an id, and it is open for
      // exactly as long as it runs. Observe-class methods are not causes, so
      // they leave the daemon quiet and changes during them read as external.
      inFlight = entry.effectClass === "observe" ? undefined : { causeId: mintCauseId() };
      try {
        return await entry.handler(request.params, backend, launch, book);
      } finally {
        inFlight = undefined;
      }
    });
    // THE THIRD AUDIT CALL SITE, and the one the artifact turns on. ADR-0026's
    // own defining example of an access record is a READ - "the subject field
    // of the third message was read" - so a log recording only effects would
    // answer an audit of a reading session with an empty file. All five
    // observe-class methods write from this ONE point, deliberately: an entry
    // per handler would be five places to forget.
    //
    // The effect routes are excluded because they already wrote, in the places
    // that know which scope they were permitted under; a second entry here
    // would double every effect in the record.
    if (entry.effectClass === "observe") {
      recordAudit({ application: undefined, element: answeredElements(result), scope: "observe", cause: causeOf(undefined), outcome: observeOutcome(result) });
    }
    return { type: "response", id: request.id, result: withoutInternals(result) };
  } catch {
    // Whatever the backend threw stays on this side of the wire; the client
    // gets one honest constant, never the raw error (98ac7fd's lesson). The
    // attempt is still recorded: an access the daemon could not complete is a
    // fact about access, and a record that keeps only the tidy cases is a
    // record of the tidy cases.
    if (entry.effectClass === "observe") {
      recordAudit({ application: undefined, element: [], scope: "observe", cause: causeOf(undefined), outcome: FAILED });
    }
    return { type: "response", id: request.id, refusal: BACKEND_UNREADABLE_REFUSAL };
  }
}

/**
 * The narrow duplex the protocol front end actually needs. Exactly the members
 * the connection handler used to reach for on a net.Socket and nothing more -
 * a Unix socket and a WebSocket can both present this, so the handler below is
 * written once and driven by either.
 *
 * `write` takes a whole line INCLUDING its trailing newline. The newline is
 * part of the payload the protocol has always sent, not a socket-framing
 * detail, so it stays part of it on every pipe.
 */
export interface Pipe {
  write(line: string): void;
  /** graceful: the peer is told we are done */
  end(): void;
  /** true once the pipe can no longer carry bytes */
  readonly closed: boolean;
  onData(handler: (chunk: string) => void): void;
  onClose(handler: () => void): void;
}

function socketPipe(socket: Socket): Pipe {
  return {
    write: (line) => {
      socket.write(line);
    },
    end: () => {
      socket.end();
    },
    get closed() {
      return socket.destroyed;
    },
    onData: (handler) => {
      socket.on("data", (chunk: Buffer) => handler(chunk.toString("utf8")));
    },
    onClose: (handler) => {
      socket.on("close", handler);
    },
  };
}

/**
 * The whole protocol front end for ONE connection: the hello gate, the
 * newline-delimited framing, request routing, the server-initiated event
 * direction, and the teardown that closes watches at the backend.
 *
 * Lives here, once, and is called by every listener. A second copy of this
 * logic - or a second framing rule for a pipe whose transport happens to have
 * message boundaries of its own - is how two pipes stop being the same pipe.
 */
export function serveConnection(
  pipe: Pipe,
  options: { backend: Backend; launch?: LaunchContext; visibility: Visibility },
): void {
  const { backend, launch, visibility } = options;
  let buffer = "";
  let helloDone = false;
  // The server-initiated direction (ADR-0039). An event answers nothing, so
  // it carries no id - a client that is not listening ignores it, and a
  // client that is gets it without having asked twice.
  const book = new SubscriptionBook((event) => {
    if (!pipe.closed) pipe.write(`${JSON.stringify({ type: "event", event })}\n`);
  }, visibility);
  // A watch belongs to the connection that asked for it. When the connection
  // goes, the watches go with it - closed at the BACKEND, not merely
  // forgotten here: a forgotten watch is still being fed.
  const teardown = () => {
    void book.closeAll();
  };
  pipe.onClose(teardown);
  pipe.onData((chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.trim()) continue;
      let message: { type: string; digest?: string; id?: number; method?: string; params?: unknown };
      try {
        message = JSON.parse(line);
      } catch {
        pipe.write(`${JSON.stringify({ type: "refusal", refusal: "daemon: not a JSON line" })}\n`);
        continue;
      }
      if (!helloDone) {
        if (message.type !== "hello" || typeof message.digest !== "string") {
          pipe.write(`${JSON.stringify({ type: "refusal", refusal: "daemon: hello with a schema digest must come first" })}\n`);
          pipe.end();
          return;
        }
        if (message.digest !== SCHEMA_DIGEST) {
          pipe.write(
            `${JSON.stringify({
              type: "refusal",
              refusal:
                `daemon: refused at connect - this daemon speaks schema digest ${SCHEMA_DIGEST} ` +
                `but the transport was built against schema digest ${message.digest} (digest-agreement check)`,
            })}\n`,
          );
          pipe.end();
          return;
        }
        helloDone = true;
        pipe.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST, version: PROTOCOL_VERSION })}\n`);
        continue;
      }
      if (message.type === "request" && typeof message.id === "number" && typeof message.method === "string") {
        void handleRequest(message as Request, backend, launch, book).then((response) => {
          if (!pipe.closed) pipe.write(`${JSON.stringify(response)}\n`);
        });
      } else {
        // Valid JSON that is not a well-formed request gets a named refusal,
        // never silence - a swallowed line leaves the client's promise
        // pending forever, which is a hang, not a refusal.
        pipe.write(
          `${JSON.stringify({
            type: "refusal",
            refusal: 'daemon: a message after hello must be {type:"request", id:number, method:string} - refusing a malformed line',
          })}\n`,
        );
      }
    }
  });
}

export function startServer(options: {
  socketPath: string;
  backend: Backend;
  launch?: LaunchContext;
  /** the observe set composed at boot; events are filtered against it at emission */
  visibility?: Visibility;
}): Promise<Server> {
  const { socketPath, backend, visibility = "all" } = options;
  // ONE composed observe set, carried into the launch context rather than
  // passed twice: the listing reports the observe capability from the same set
  // that filters events and hides subtrees, so the two can never disagree.
  const launch = options.launch === undefined ? undefined : { ...options.launch, visibility };
  mkdirSync(dirname(socketPath), { recursive: true });
  rmSync(socketPath, { force: true });

  const server = createServer((socket) => {
    // The error -> hard drop behaviour stays in the adapter rather than in
    // serveConnection: "a socket error means destroy it" is a property of this
    // pipe, not of the protocol. The WebSocket adapter makes the same choice
    // with the vocabulary its own transport has.
    socket.on("error", () => socket.destroy());
    serveConnection(socketPipe(socket), { backend, launch, visibility });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}

function webSocketPipe(socket: WebSocket): Pipe {
  return {
    write: (line) => {
      socket.send(line);
    },
    end: () => {
      socket.close();
    },
    get closed() {
      // CLOSING (2) and CLOSED (3) both mean no more bytes will land
      return socket.readyState > 1;
    },
    onData: (handler) => {
      // Whole frames are fed into the SAME newline buffer the socket path
      // uses. A WebSocket has message boundaries of its own; the protocol
      // does not care about them, and pretending it does is how a peer that
      // batches two lines into one frame starts behaving differently.
      socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
        handler(Array.isArray(data) ? Buffer.concat(data).toString("utf8") : Buffer.from(data as Buffer).toString("utf8"));
      });
    },
    onClose: (handler) => {
      socket.on("close", handler);
    },
  };
}

/** the handle a second listener hands back - deliberately NOT a net.Server */
export interface WebSocketListener {
  /** the port actually bound, which matters when the caller asked for 0 */
  readonly port: number;
  readonly host: string;
  close(): void;
  on(event: "close", handler: () => void): void;
}

/**
 * The same protocol, over a WebSocket, for a client that is not on this
 * filesystem. Additive: startServer above is untouched, and a daemon nobody
 * asked for a port never calls this.
 */
export async function startWebSocketServer(options: {
  port: number;
  host?: string;
  backend: Backend;
  launch?: LaunchContext;
  visibility?: Visibility;
}): Promise<WebSocketListener> {
  const { port, host = "127.0.0.1", backend, visibility = "all" } = options;
  const launch = options.launch === undefined ? undefined : { ...options.launch, visibility };

  const { WebSocketServer } = await import("ws");
  const wss = new WebSocketServer({ host, port });

  wss.on("connection", (socket: WebSocket) => {
    // Same choice the socket adapter makes: a transport-level error means drop
    // this connection, and that is a property of the pipe, not the protocol.
    socket.on("error", () => socket.terminate());
    serveConnection(webSocketPipe(socket), { backend, launch, visibility });
  });

  return new Promise((resolve, reject) => {
    wss.once("error", reject);
    wss.once("listening", () => {
      const address = wss.address();
      const bound = address !== null && typeof address === "object" ? address.port : port;
      resolve({
        port: bound,
        host,
        close: () => wss.close(),
        on: (event, handler) => wss.on(event, handler),
      });
    });
  });
}
