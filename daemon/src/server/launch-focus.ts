import { existsSync, readFileSync } from "node:fs";
import { CAPABILITY_NAMES, ROLES, type Diagnostic, type SemanticElement } from "@mastra-cc/protocol-types";
import type { ListApplicationsResult, OpenApplicationResult, RestartApplicationResult } from "../results.js";
import { type Backend, type RunningCensus, IncompleteObservationError, ApplicationScopeAmbiguousError, ApplicationIdentityMismatchError, ApplicationScopeUnmatchedError, WindowScopeAmbiguousError, WindowScopeUnmatchedError, InventoryUnsupportedError } from "../backend.js";
import { FAILED, PERFORMED, READ, recordAudit, refused, withoutInternals, type Classified } from "../audit.js";
import { ACQUIRE_SETTING, type AccessibilityLayerState, type AccessibilityReport } from "../accessibility/index.js";
import { applicationName } from "../backends/atspi/names.js";
import { restartLevelForAny, WITHHOLDS_NOTHING } from "../capabilities.js";
import { isVisible } from "../grants.js";
import { contendsForBrowserEndpoint, type LaunchCatalog } from "../launch/recipes.js";
import { findRecipe, launchApplication, NO_RECIPE_REFUSAL } from "../launch/spawn.js";
import { causeOf, outcomeOf, performEffect, sendKeyChord } from "./dispatch.js";
import { ALREADY_RUNNING_REFUSAL, AMBIGUOUS_NAME_REFUSAL, APPLICATION_IDENTITY_MISMATCH_REFUSAL, APPLICATION_SCOPE_AMBIGUOUS_REFUSAL, APPLICATION_SCOPE_UNMATCHED_REFUSAL, COULD_NOT_START_REFUSAL, DISCOVERY_APPLICATION_REFUSAL, DISCOVERY_LIMIT_REFUSAL, DISCOVERY_WINDOW_REFUSAL, InventoryIndex, LIST_APPLICATIONS_REFUSAL, LaunchContext, ONE_BROWSER_IDENTITY_REFUSAL, QUERY_WINDOW_REQUIRES_APPLICATION_REFUSAL, UNAVAILABLE_REFUSAL, UNKNOWN_ROLE_REFUSAL, WINDOW_SCOPE_AMBIGUOUS_REFUSAL, WINDOW_SCOPE_UNMATCHED_REFUSAL, candidateNamesOf, capabilityStateFor, configurationWithholdingFor, indexInventory, observedWithConfiguration, resolvePermitted, restartAuthority, runningFieldsFor, withheldRefusal } from "./grants.js";
import { serialised } from "./queues.js";
import { causeNames, operation } from "./subscriptions.js";

// CAN THIS MACHINE BE HEARD AT ALL (ADR-0064). Observation of the daemon's own
// instrument rather than of any desktop behind it: it names no application,
// answers no element, and needs no grant, because there is nothing here an
// application published. A daemon assembled without an adapter says so in the
// only honest way - cannot-tell with a reason - rather than reporting the
// machine's layer off on the strength of its own incompleteness.
export const NO_ADAPTER: AccessibilityReport = {
  state: "cannot-tell",
  reason: "this daemon was assembled without a way to look at the accessibility layer",
};

export async function describeAccessibility(launch: LaunchContext): Promise<{ accessibility: AccessibilityReport }> {
  const layer = launch.accessibility;
  return { accessibility: layer === undefined ? NO_ADAPTER : await layer.report() };
}

// WHERE THIS DESKTOP KEEPS ITS OWN FILES (ADR-0082). Every other verb here is
// about what is ON the screen, so a caller asked to name a path has nowhere in
// this contract to learn one - and what it does instead was measured: it types
// the home directory of whatever machine it was trained on. On a desk whose
// home is somewhere else that produces an application's not-found page, which
// is indistinguishable from a save that failed, and the errand reports a
// download as broken.
//
// Nothing is read, listed or opened. Two paths, each PUBLISHED rather than
// computed: the environment's own home, and the download folder the desktop
// names. The XDG file is the desktop's answer when it exists; the spec's own
// default is used only when that folder IS THERE to be seen, because a path
// this daemon reasoned its way to is the same guess the caller was making, and
// an omitted field is a caller that goes and looks instead of believing one.
export function xdgDownloadDir(home: string, read: (path: string) => string | undefined): string | undefined {
  const named = read(`${home}/.config/user-dirs.dirs`);
  const line = named?.split("\n").find((entry) => entry.trimStart().startsWith("XDG_DOWNLOAD_DIR="));
  const value = line?.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "");
  return value === undefined || value === "" ? undefined : value.replace("$HOME", home);
}

export function desktopPlaces(
  environment: Record<string, string | undefined>,
  read: (path: string) => string | undefined,
  exists: (path: string) => boolean,
): { home?: string; downloads?: string } {
  const home = environment.HOME;
  if (home === undefined || home === "") return {};
  const published = environment.XDG_DOWNLOAD_DIR ?? xdgDownloadDir(home, read);
  const downloads = published ?? `${home}/Downloads`;
  return exists(downloads) ? { home, downloads } : { home };
}

export function describeDesktop(): { places: { home?: string; downloads?: string } } {
  return {
    places: desktopPlaces(
      process.env,
      (path) => {
        try {
          return readFileSync(path, "utf8");
        } catch {
          return undefined;
        }
      },
      (path) => existsSync(path),
    ),
  };
}

// ACQUIRING IT, in the order the two refusals must be asked. The operator's
// flag first, because a daemon the operator did not arm must not report the
// platform's shape as its reason - and a machine whose layer this build cannot
// touch must not be told to go and change a setting that would not help. Both
// sentences use the wire's standing vocabulary (protocol/schema.json:236,241).
export const ACQUIRE_WITHHELD_REFUSAL =
  `refused before acting: switching this machine's accessibility layer on is disabled-by-configuration, ` +
  `withheld by ${ACQUIRE_SETTING} - an operator arms it at startup, and no request can`;
export const ACQUIRE_NOT_EXPOSED_REFUSAL =
  "refused before acting: switching this machine's accessibility layer on is not-exposed on this platform - " +
  "this build has no adapter that could, and no setting would change that";
// Acquiring the layer is several writes, not one (ADR-0075), so a failure can
// land after some of them have already been accepted. The refusal says the
// attempt did not complete - never that nothing happened - and the report that
// travels with it is the re-read, so an operator can see the half-acquired
// machine it was actually left holding.
export const ACQUIRE_FAILED_REFUSAL =
  "refused after acting: this machine's accessibility layer did not accept every property of being switched on, " +
  "and what it did accept is reported beside this refusal";
// The re-read can fail too, and then there is nothing beside the refusal to
// read. Promising a report that is not there would be the same lie in a
// smaller place, so that case says so.
export const ACQUIRE_FAILED_UNREADABLE_REFUSAL =
  "refused after acting: this machine's accessibility layer did not accept every property of being switched on, " +
  "and could not be read afterwards to say what it was left holding";

export async function acquireAccessibility(launch: LaunchContext): Promise<Classified<{ accessibility?: AccessibilityReport; refusal?: string }>> {
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
    // The same re-read the success path does, for the same reason: the state
    // that goes back is measured, not assumed. A failed acquire is exactly
    // where assuming would lie loudest.
    let accessibility: AccessibilityReport | undefined;
    try {
      accessibility = await layer.report();
    } catch {
      accessibility = undefined;
    }
    const refusal = accessibility === undefined ? ACQUIRE_FAILED_UNREADABLE_REFUSAL : ACQUIRE_FAILED_REFUSAL;
    return { accessibility, refusal, refusalClass: "AccessibilityNotAcquired" };
  }
  // RE-READ, never report the intention. The state that goes back is measured
  // after the attempt, so a write that was accepted and changed nothing is
  // visible as what it is rather than as success (ADR-0064 clause 6).
  return { accessibility: await layer.report() };
}

// A DESK THAT WENT DEAF MID-SESSION IS NOT A BARE DESK (ADR-0089).
//
// Measured 2026-09-05 on the demo container: a daemon started with authority
// to switch the accessibility layer on did so, served a run for several
// minutes, and then something on that desktop wrote IsEnabled back to false
// underneath it. Every observation after that answered emptily - no
// applications, no elements - which reads exactly like a desktop with nothing
// running, and the errand above it concluded the desk was bare and stopped.
//
// Two facts are separated here. Emptiness with the layer ON is an answer. The
// same emptiness with the layer OFF is silence, and answering silence as an
// answer is the false belief this whole daemon exists to refuse.
//
// The authority question is already settled: a session started WITHOUT
// --acquire-accessibility may not switch anything on, and this does not - it
// refuses and says the desk went deaf. A session started WITH it was granted
// that act for its lifetime, and an authority that evaporates the first time
// the desktop resets a property is not an authority, so that session switches
// the layer back on and the caller retries. Nothing is retried here on the
// caller's behalf: what goes back is a refusal that names what happened, so
// the next call is the caller's decision and its result is its own.
export const DEAF_DESK_REFUSAL =
  "this desk answered nothing because its accessibility layer is switched off, not because nothing is running - " +
  "it was switched on for this session and has since been switched back off underneath it";
export const DEAF_DESK_REACQUIRED_REFUSAL =
  `${DEAF_DESK_REFUSAL}. It has been switched on again for you: ask the same question again`;

export async function deafDesk(launch: LaunchContext): Promise<Classified<{ refusal: string }> | undefined> {
  const layer = launch.accessibility;
  if (layer === undefined) return undefined;
  let report: AccessibilityReport;
  try {
    report = await layer.report();
  } catch {
    // A layer that cannot be read is not a layer that is off, and this route
    // is not the place that answers that question - describeAccessibility is.
    return undefined;
  }
  if (report.state !== "disabled") return undefined;
  if (launch.mayAcquireAccessibility !== true || !layer.acquirable) {
    return { refusal: DEAF_DESK_REFUSAL, refusalClass: "AccessibilityLostMidSession" };
  }
  try {
    await layer.acquire();
  } catch {
    return { refusal: DEAF_DESK_REFUSAL, refusalClass: "AccessibilityNotAcquired" };
  }
  return { refusal: DEAF_DESK_REACQUIRED_REFUSAL, refusalClass: "AccessibilityLostMidSession" };
}

// The listing (ADR-0042). Existence and permission are readable; nothing from
// inside an application is. The backend answers WHAT EXISTS and this function
// answers WHAT MAY BE DONE - the second half from the same tables the gates
// enforce, never from a list written beside them.
export async function listApplications(backend: Backend, launch: LaunchContext): Promise<Classified<ListApplicationsResult>> {
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
  // said about an application it does have. The union and the claims over it
  // are built by indexInventory so this listing and the launch gate cannot
  // hold different beliefs about who claims a name.
  const index = indexInventory(installed, launch.catalog);
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
  // WHETHER THE DESK CAN BE HEARD, asked ONCE for the whole listing, exactly
  // as the census above is. It is a fact about the machine, identical for
  // every entry, and a D-Bus round trip per application across an inventory
  // measured at 125 entries would make this call unusable.
  //
  // A layer that throws is a failed read, and a failed read is cannot-tell -
  // the same answer a daemon assembled without an adapter gives, and for the
  // same reason: neither knows, and neither may say the machine's ears are off.
  const heard = await (async (): Promise<AccessibilityLayerState> => {
    if (launch.accessibility === undefined) return NO_ADAPTER.state;
    try {
      return (await launch.accessibility.report()).state;
    } catch {
      return "cannot-tell";
    }
  })();
  // WHICH NAMES THIS DAEMON OWNS A LIVE PROCESS FOR, computed ONCE for the
  // listing. ownsName does a synchronous readFileSync of /proc/<pid>/stat per
  // matching record; asking it per installed entry per candidate name would put
  // that on the event loop dozens of times over an inventory measured at 125
  // entries. The number of owned processes is small - it is the number of
  // QUESTIONS that would not have been.
  //
  // The table is the only source consulted. Nothing here enumerates processes,
  // scans /proc for pids this daemon did not launch, or asks a window manager
  // anything.
  const ownedAndLive = new Set(
    [...new Set(launch.table.entries().map((owned) => owned.name))].filter(
      (name) => launch.table.ownsName(name) !== undefined,
    ),
  );
  // Runtime names are query scopes, not evidence that an installed entry's
  // alias carries authority. Publish only names directly visible to this
  // session, without adding them to the launch/permission claim index.
  const runtime = [...census.observable]
    .filter((name) => isVisible(launch.visibility ?? new Set(), name)
      && !index.entries.some((entry) => applicationName(entry.name) === applicationName(name)))
    .map((name) => ({
      name,
      capabilities: CAPABILITY_NAMES.map((capability) => capabilityStateFor(
        launch, capability, name, capability === "observe" ? undefined : index,
      )),
      launchable: findRecipe(name, launch.catalog) !== undefined,
      running: "answering" as const,
    }));
  return {
    applications: [...index.entries]
      .map((entry) => ({
        name: entry.name,
        capabilities: CAPABILITY_NAMES.map((capability) => capabilityStateFor(launch, capability, entry.name, index)),
        // A statement about this daemon's own recipes, never about permission:
        // an application can be installed and honestly not launchable.
        launchable: findRecipe(entry.name, launch.catalog) !== undefined,
        ...runningFieldsFor(launch, census, entry, index, heard, ownedAndLive),
        ...(entry.diagnostic === undefined ? {} : { diagnostic: entry.diagnostic }),
      }))
      .concat(runtime)
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

// The acquire route writes its own record, like every other effect route and
// unlike the observe ones: a change to the OPERATOR'S MACHINE is the least
// deniable thing this daemon can do, so it is attributable whether it was
// performed, refused, or failed. No application and no element - there is
// neither - which is precisely the case `application: null` was defined for.
export async function auditedAcquire(launch: LaunchContext): Promise<Classified<{ accessibility?: AccessibilityReport; refusal?: string }>> {
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

// How long a launched app gets to become readable. Ten seconds was a desktop
// utility's budget; a browser on a profile it has not opened before takes far
// longer. Measured 2026-09-05 through this daemon, on a desk whose container
// had been running for hours: Chromium answered as readable 31.3 seconds after
// the launch - just past a thirty-second budget, so the errand above it was
// told the browser never arrived while the browser was, in fact, arriving. It
// then spent its turns hunting for a browser that was already on screen.
//
// Sixty seconds is not a guess at the next machine; it is twice the slowest
// start measured here, which leaves the refusal meaning what it is for - an
// application that never arrives - rather than one that is slower than a
// calculator. The cost of the higher ceiling is paid only by a launch that
// genuinely fails, and an errand waiting is cheaper than an errand misled.
export const POLL_BUDGET_MS = 60_000;
export const POLL_INTERVAL_MS = 250;

// The appears-as join (ADR-0038). A composed profile identity launches a
// browser that still calls itself "chrome" in the semantic tree, because the
// browser reports its own product name whichever profile it opened
// (backends/cdp/index.ts). So the tree is queried under the name the recipe
// says it will answer to, never the catalog key.
export function treeNameOf(name: string, catalog: LaunchCatalog): string {
  return applicationName(findRecipe(name, catalog)?.appearsAs ?? name);
}

// A backend read that throws here means "no daemon-visible application by
// that name" - not a refusal. For the CDP backend that is literally true: a
// browser without its debug port is invisible to this backend, so unreachable
// and not-running are the same observation. This tolerance covers BOTH call
// sites (the pre-spawn already-running check and the post-spawn poll, where a
// per-tick exception is "not ready yet" within the poll budget) - without it,
// opening the browser while the browser is down would refuse instead of
// launching.
export async function findApplication(backend: Backend, name: string): Promise<SemanticElement | undefined> {
  try {
    const { elements } = await backend.queryElements({ role: "application", name });
    return elements.find((el) => el.role === "application" && applicationName(el.name) === applicationName(name));
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
export type FocusHeld =
  | { kind: "held"; element: SemanticElement }
  | { kind: "none" }
  | { kind: "unreadable" };

// Read immediately before the spawn. A throw of any kind is "unreadable" and
// is REPORTED rather than swallowed - a route that cannot read focus cannot
// promise it protected it, and clause 4 is explicit that a silent best-effort
// is worse than none.
export async function focusBeforeEffect(backend: Backend): Promise<FocusHeld> {
  try {
    const element = await backend.focusedElement();
    return element === undefined ? { kind: "none" } : { kind: "held", element };
  } catch {
    return { kind: "unreadable" };
  }
}

export const FOCUS_UNREADABLE_NOTE =
  "the focus was not protected across this launch: this session's backend cannot read or restore what holds focus, " +
  "so whether this launch took the keyboard is unmeasured - only a route that can read focus back would answer differently";

export function focusNotRestored(before: SemanticElement, now: SemanticElement | undefined, occasion: string): string {
  const holder = now === undefined ? "nothing holds it now" : `${JSON.stringify(now.name)} holds it now`;
  return (
    `the focus was not restored after this ${occasion}: ${JSON.stringify(before.name)} held it before the ${occasion} and ${holder} - ` +
    `this is not a clean ${occasion}, and the keyboard is somewhere the caller did not ask for`
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
export async function restoreFocusAfterEffect(backend: Backend, held: FocusHeld, occasion = "launch"): Promise<string | undefined> {
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
    return focusNotRestored(held.element, after, occasion);
  }
  if (regained !== undefined && regained.id === held.element.id) return undefined;
  return focusNotRestored(held.element, regained, occasion);
}

// Where the report goes. The launch result has two shapes and the note reaches
// a reader in both: stamped into the element's diagnostic when the launch
// otherwise succeeded, and carried in the refusal when it did not. Diagnostic
// because it is debug-only by the wire's own contract and never load-bearing
// for agent logic - the schema is not changed to carry it; no field is added
// to a frozen version for a debug-only note.
export function withFocusNote(element: SemanticElement, note: string | undefined): SemanticElement {
  if (note === undefined) return element;
  const diagnostic: Diagnostic & { "mastra-cc/focus-preservation": string } = {
    ...element.diagnostic,
    "mastra-cc/focus-preservation": note,
  };
  return { ...element, diagnostic };
}

// The role guard mirrors the chord guard in sendKeyChord: the wire vocabulary
// is the generated ROLES tuple, and a role outside it (or not a string at all)
// is a malformed parameter, refused before the call. Enforcement of the
// answer itself stays at-result, as for every observe-class method.
export async function queryElements(p: unknown, b: Backend, l: LaunchContext): Promise<unknown> {
  const params = (p ?? {}) as { role?: unknown; application?: unknown; window?: unknown };
  if (params.role !== undefined && !(ROLES as readonly string[]).includes(params.role as string)) {
    return { refusal: UNKNOWN_ROLE_REFUSAL, refusalClass: "MalformedParameter" as const };
  }
  if (params.window !== undefined && params.application === undefined) {
    return { refusal: QUERY_WINDOW_REQUIRES_APPLICATION_REFUSAL, refusalClass: "MalformedParameter" as const };
  }
  try {
    const answered = observedWithConfiguration(await b.queryElements(params as never), b, l);
    // An empty answer is the one shape a switched-off layer and a bare desk
    // share. Only then is the layer asked about (ADR-0089): a query that found
    // something has already proved the desk can be heard.
    if (isEmptyAnswer(answered)) return (await deafDesk(l)) ?? answered;
    return answered;
  } catch (error) {
    const scoped = windowScopeRefusal(error, params as { application?: string; window?: string });
    if (scoped !== undefined) return scoped;
    throw error;
  }
}

// Emptiness, as the two observation routes each publish it.
export function isEmptyAnswer(answered: unknown): boolean {
  const elements = (answered as { elements?: unknown })?.elements;
  return Array.isArray(elements) && elements.length === 0;
}

// An id this daemon minted: the three prefixes it answers with, then hex.
export function looksLikeAnsweredId(value: string | undefined): boolean {
  return value !== undefined && /^(el|win|app)-[0-9a-f]{6,}$/.test(value);
}

// One place turns the two scope failures into the two sentences, so the scoped
// query and scoped discovery cannot drift apart in what they say about the
// same desktop.
export function windowScopeRefusal(
  error: unknown,
  scope?: { application?: string; window?: string },
):
  | { refusal: string; refusalClass: "WindowScopeUnmatched" | "WindowScopeAmbiguous" | "ApplicationScopeUnmatched" | "ApplicationScopeAmbiguous" | "ApplicationIdentityMismatch" }
  | undefined {
  // A scope is a NAME. An id looks enough like an answer to be reached for as
  // one, and the bare not-found sentence sends the caller looking for a window
  // that was never missing, so the id is named as the mistake it is.
  const asId = looksLikeAnsweredId(scope?.window) ? ` - "${scope?.window}" is an id this daemon answers WITH, and a window scope is a window's name` : "";
  if (error instanceof WindowScopeUnmatchedError) return { refusal: `${WINDOW_SCOPE_UNMATCHED_REFUSAL}${asId}`, refusalClass: "WindowScopeUnmatched" };
  if (error instanceof WindowScopeAmbiguousError) return { refusal: WINDOW_SCOPE_AMBIGUOUS_REFUSAL, refusalClass: "WindowScopeAmbiguous" };
  if (error instanceof ApplicationScopeUnmatchedError) return { refusal: APPLICATION_SCOPE_UNMATCHED_REFUSAL, refusalClass: "ApplicationScopeUnmatched" };
  if (error instanceof ApplicationScopeAmbiguousError) return { refusal: APPLICATION_SCOPE_AMBIGUOUS_REFUSAL, refusalClass: "ApplicationScopeAmbiguous" };
  if (error instanceof ApplicationIdentityMismatchError) return { refusal: APPLICATION_IDENTITY_MISMATCH_REFUSAL, refusalClass: "ApplicationIdentityMismatch" };
  return undefined;
}

export async function discoverElements(p: unknown, b: Backend, l: LaunchContext): Promise<unknown> {
  const params = (p ?? {}) as { application?: unknown; window?: unknown; role?: unknown; limit?: unknown };
  if (typeof params.application !== "string" || params.application.length === 0) {
    return { refusal: DISCOVERY_APPLICATION_REFUSAL, refusalClass: "MalformedParameter" as const };
  }
  if (params.window !== undefined && (typeof params.window !== "string" || params.window.length === 0)) {
    return { refusal: DISCOVERY_WINDOW_REFUSAL, refusalClass: "MalformedParameter" as const };
  }
  if (params.role !== undefined && !(ROLES as readonly string[]).includes(params.role as string)) {
    return { refusal: UNKNOWN_ROLE_REFUSAL, refusalClass: "MalformedParameter" as const };
  }
  if (params.limit !== undefined && (typeof params.limit !== "number" || !Number.isInteger(params.limit) || params.limit < 1 || params.limit > 200)) {
    return { refusal: DISCOVERY_LIMIT_REFUSAL, refusalClass: "MalformedParameter" as const };
  }
  try {
    const answered = await b.discoverElements({ ...params, limit: params.limit ?? 100 } as never);
    if (isEmptyAnswer(answered)) return (await deafDesk(l)) ?? answered;
    return answered;
  } catch (error) {
    const scoped = windowScopeRefusal(error, params as { application?: string; window?: string });
    if (scoped !== undefined) return scoped;
    throw error;
  }
}

// The launch handler. Order is the contract (ADR-0019): AUTHORITY first -
// the permit set is consulted before the catalog, the tree, or anything else,
// and an unpermitted name never reaches a capability probe, because the probe
// itself would leak that the application exists. Runs inside the serialised
// chain like every other operation.
export async function openApplication(
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
    recordAudit({ application: applicationName(name), element: [], scope: "launch", cause: causeOf(undefined), outcome: FAILED });
    throw error;
  }
  const application = answer.auditApplication ?? applicationName(name);
  recordAudit({
    application,
    element: answer.application === undefined ? [] : [answer.application],
    scope: "launch",
    cause: causeOf(application),
    outcome: outcomeOf(answer),
  });
  return withoutInternals(answer);
}

export async function decideOpenApplication(
  params: { name?: string },
  backend: Backend,
  launch: LaunchContext,
): Promise<Classified<OpenApplicationResult>> {
  const requestedName = typeof params.name === "string" ? params.name : "";
  // THE PERMIT GATE RESOLVES THE WAY THE CENSUS READS. The inventory is
  // enumerated first because the gate needs to know which entry - if exactly
  // one - claims the requested name; a backend that cannot enumerate
  // (InventoryUnsupportedError) degrades to the exact-name check this gate
  // always was, losing nothing it could ever do. Enumeration is a read the
  // caller could make directly through listApplications (ADR-0042 made the
  // inventory readable), so consulting it before refusing leaks nothing the
  // refusal must protect.
  let index: InventoryIndex | undefined;
  try {
    index = indexInventory(await backend.installedApplications(), launch.catalog);
  } catch (error) {
    if (!(error instanceof InventoryUnsupportedError)) throw error;
  }
  const resolution = resolvePermitted(requestedName, index, launch.catalog, launch.permits);
  if (resolution.kind === "ambiguous") {
    return { refusal: AMBIGUOUS_NAME_REFUSAL, refusalClass: "LaunchUnavailable" };
  }
  if (resolution.kind === "unpermitted") {
    return { refusal: UNAVAILABLE_REFUSAL, refusalClass: "LaunchUnavailable" };
  }
  // From here on the launch acts on the ENTRY the name resolved to - its full
  // id - so a request for `kate` and a request for `org.kde.kate` are the
  // same launch, hit the same recipe, and are owned under the same name. When
  // the inventory could not be read there is no entry, and the caller's own
  // name is the subject, exactly as before this gate learned to resolve.
  const name = resolution.entry?.name ?? requestedName;
  // The user's configuration, asked after the session's authority and before
  // anything is spawned or probed. A name that got this far is one this session
  // was permitted to launch, so naming the setting here tells the caller
  // nothing it did not already know - and it is the difference between "you
  // cannot" and "it is switched off, here is the switch" (ADR-0042). Asked
  // across the ENTRY'S names, not just the resolved id: a rule the operator
  // keyed on `kate` must keep applying when the request resolves to
  // `org.kde.kate`, or resolution would widen what the configuration allows.
  const withheld = configurationWithholdingFor(launch, "launch", resolution.entry, requestedName);
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
    if (applicationName(key) === applicationName(name)) continue;
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
  let ours = launch.table.ownsName(name) !== undefined;
  // The desk is asked about OURS as well as about a stranger's copy, because a
  // process being alive is not the same as an application being there to work
  // in.
  const running = await findApplication(backend, treeName);
  // Ownership is not presence. Measured on this desk 2026-09-05: an agent
  // closed Chromium's last window, the process stayed up with nothing to
  // publish, the accessibility bus stopped answering to "Chromium", and every
  // re-open after that took the idempotent path, started nothing, and refused
  // as unreadable - a live owned process the caller could neither reach nor
  // restart. An owned name that publishes nothing is a name to open again: the
  // desktop entry hands the request to the running instance, which opens a
  // window, which is what the caller asked for.
  if (ours && running === undefined) ours = false;
  if (!ours && running !== undefined) {
    // Running, and not ours: refuse, never kill (ADR-0027 - the asking
    // surface arrives with a later milestone).
    return { refusal: ALREADY_RUNNING_REFUSAL, refusalClass: "AlreadyRunning", auditApplication: treeName };
  }
  if (!ours) {
    held = await focusBeforeEffect(backend);
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
      const note = await restoreFocusAfterEffect(backend, held);
      return { application: withFocusNote(application, note), auditApplication: treeName };
    }
    if (Date.now() >= deadline) {
      // The launch is already not clean; a focus it could not protect is said
      // in the same breath rather than dropped because there is no element to
      // hang it on.
      const note = await restoreFocusAfterEffect(backend, held);
      const timedOut = `the application was opened but did not become readable within ${budget}ms - refusing to pretend it is ready`;
      return { refusal: note === undefined ? timedOut : `${timedOut}; ${note}`, refusalClass: "NotReadableInTime", auditApplication: treeName };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

// RESTART (ADR-0065). The two acting levels are two signals, and the
// difference between them is whether the application is allowed to say no.
// SIGTERM is a REQUEST: a well-behaved application with unsaved work answers
// it by putting up a dialog and staying alive, which is exactly the case
// clause 4 protects. SIGKILL is not a request, which is why nothing but an
// operator writing "force" can reach it.
//
// Only owned processes are signalled, and the table re-verifies (pid,
// starttime) before every signal, so a recycled pid is never touched
// (ADR-0029). A foreign copy is refused rather than resolved by killing it -
// the same answer openApplication already gives, for the same reason.
export const NOT_OURS_REFUSAL =
  "refused by the restart gate: this daemon did not open that application, and it does not signal processes it does not own - the person at the machine owns that window";

export const RESTART_BUDGET_MS = 10_000; // how long a closing application gets, before and after

export async function restartApplication(
  params: { name?: string },
  backend: Backend,
  launch: LaunchContext,
): Promise<RestartApplicationResult> {
  const name = typeof params.name === "string" ? params.name : "";
  let answer: Classified<RestartApplicationResult>;
  try {
    answer = await decideRestartApplication(params, backend, launch);
  } catch (error) {
    recordAudit({ application: applicationName(name), element: [], scope: "restart", cause: causeOf(undefined), outcome: FAILED });
    throw error;
  }
  const application = answer.auditApplication ?? applicationName(name);
  const element = answer.application ?? answer.blockedBy;
  recordAudit({
    application,
    element: element === undefined ? [] : [element],
    scope: "restart",
    cause: causeOf(application),
    outcome: outcomeOf(answer),
  });
  return withoutInternals(answer);
}

export async function decideRestartApplication(
  params: { name?: string },
  backend: Backend,
  launch: LaunchContext,
): Promise<Classified<RestartApplicationResult>> {
  const requestedName = typeof params.name === "string" ? params.name : "";
  // Restarting ENDS a program and STARTS one, so it needs the authority to
  // start it: a session that may not launch this application may not restart
  // it into existence either. Session authority first, then the operator's
  // configuration - the same order every other route uses, so `disabledBy`
  // never names a setting to a caller who was never going to get past the
  // session gate anyway.
  //
  // The name resolves EXACTLY as the launch gate resolves it, because the
  // launch is what recorded the ownership this gate is about to look up: an
  // application opened as `kate` is owned under its entry id `org.kde.kate`,
  // and a restart that looked the raw request up would refuse to close a
  // process this daemon started thirty seconds earlier. Same degradation too -
  // a backend that cannot enumerate keeps the exact-name behaviour.
  //
  // A session holding no launch permits at all has no authority under any
  // name, so the refusal is decidable without the backend - and MUST be, per
  // the before-call enforcement pin: no authority, no backend touched.
  if (launch.permits.size === 0) {
    return { refusal: UNAVAILABLE_REFUSAL, refusalClass: "LaunchUnavailable" };
  }
  let index: InventoryIndex | undefined;
  try {
    index = indexInventory(await backend.installedApplications(), launch.catalog);
  } catch (error) {
    if (!(error instanceof InventoryUnsupportedError)) throw error;
  }
  const resolution = resolvePermitted(requestedName, index, launch.catalog, launch.permits);
  if (resolution.kind === "ambiguous") {
    return { refusal: AMBIGUOUS_NAME_REFUSAL, refusalClass: "LaunchUnavailable" };
  }
  if (resolution.kind === "unpermitted") {
    return { refusal: UNAVAILABLE_REFUSAL, refusalClass: "LaunchUnavailable" };
  }
  const name = resolution.entry?.name ?? requestedName;
  // Restart authority across the entry's names, most restrictive winning
  // (restartLevelForAny): the operator's `restart.applications["kate"]` rule
  // is about the editor, whichever of its names the caller typed.
  const authorityNames = resolution.entry === undefined ? [requestedName] : candidateNamesOf(resolution.entry, launch.catalog);
  const authority = restartAuthority(launch.capabilities ?? WITHHOLDS_NOTHING, authorityNames);
  if ("refusal" in authority) return authority;
  const treeName = treeNameOf(name, launch.catalog);
  causeNames(treeName);
  const owned = launch.table.ownsName(name);
  if (owned === undefined) return { refusal: NOT_OURS_REFUSAL, refusalClass: "RestartNotOurs", auditApplication: treeName };
  try {
    process.kill(owned.pid, authority.level === "force" ? "SIGKILL" : "SIGTERM");
  } catch (error) {
    // Ownership was just established, so "not ours" would be a refusal derived
    // from a check that did not run (ADR-0008 clause 5). Two different things
    // land here. ESRCH: it exited in the gap between the check and the signal,
    // which is the close this caller asked for happening without our help -
    // fall through and start it again. Anything else: the signal was refused,
    // and the honest answer is that nothing was confirmed.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      return {
        refusal: `the application is this daemon's to close, but the operating system would not accept the signal - it is still running, and nothing was confirmed`,
        refusalClass: "RestartNotConfirmed",
        auditApplication: treeName,
      };
    }
  }
  const budget = launch.pollBudgetMs ?? RESTART_BUDGET_MS;
  const interval = launch.pollIntervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + budget;
  let looked = 0;
  for (;;) {
    // The PROCESS is what closing means. An application can drop off the
    // accessibility tree while still alive, and reading absence there as
    // "closed" would relaunch a program that never went away and leave two
    // under one name.
    if (launch.table.owns(owned.pid) !== true) break;
    looked += 1;
    // Something it put up outranks this daemon: report the element and stop.
    // Nothing here dismisses it, and nothing escalates the signal - a
    // "graceful" that ends in a kill is a force with a delay (ADR-0065
    // clause 4). Two conditions before that sentence may be said. Force asked
    // nothing, so nothing can have refused it. And a dialog seen in the same
    // instant as the signal may be one that was already open - only a dialog
    // that is still there a poll later is an answer to what we sent.
    const blocking = authority.level === "force" || looked < 2
      ? undefined
      : await blockingDialogOf(backend, treeName);
    if (blocking !== undefined) {
      return {
        blockedBy: blocking,
        refusal: `the application was asked to close and did not: it put up ${JSON.stringify(blocking.name)} instead, and this daemon does not answer that dialog - it is still running`,
        refusalClass: "RestartRefusedByApplication",
        auditApplication: treeName,
      };
    }
    if (Date.now() >= deadline) {
      // Neither gone nor visibly blocked. Saying "restarted" here would be
      // reporting an intention, and escalating would be punishing an
      // application for being slow (ADR-0065 clause 6).
      return {
        refusal: `the application was asked to close and neither closed nor put anything up within ${budget}ms - it is still running, and this daemon does not escalate because a timer expired`,
        refusalClass: "RestartNotConfirmed",
        auditApplication: treeName,
      };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  try {
    await launchApplication(name, launch.catalog, launch.table);
  } catch (error) {
    const message = (error as Error).message;
    const noRecipe = message === NO_RECIPE_REFUSAL;
    return { refusal: noRecipe ? message : COULD_NOT_START_REFUSAL, refusalClass: noRecipe ? "NoRecipe" : "CouldNotStart", auditApplication: treeName };
  }
  const readable = Date.now() + budget;
  for (;;) {
    const application = await findApplication(backend, treeName);
    // The outcome is READ BACK, never taken from the signal or the spawn
    // (ADR-0065 clause 5).
    if (application !== undefined) return { application, auditApplication: treeName };
    if (Date.now() >= readable) {
      return {
        refusal: `the application was closed and started again but did not become readable within ${budget}ms - refusing to pretend it is ready`,
        refusalClass: "NotReadableInTime",
        auditApplication: treeName,
      };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

// What the application put up instead of closing. A dialog belonging to the
// application being closed is the shape clause 4 is about; anything else on
// the desktop is somebody else's window and is not reported as a blocker.
export async function blockingDialogOf(backend: Backend, treeName: string): Promise<SemanticElement | undefined> {
  try {
    const { elements } = await backend.queryElements({ role: "dialog" });
    return elements.find((el) => applicationName(backend.applicationOfElement(el.id) ?? "") === applicationName(treeName));
  } catch {
    return undefined; // could not look; the caller falls through to the timeout, which says so
  }
}
