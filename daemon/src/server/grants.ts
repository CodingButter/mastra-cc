import { KEY_CHORD_NAMES, ROLES, type Capability, type CapabilityName, type SemanticElement } from "@mastra-cc/protocol-types";
import { type Backend, type RunningCensus, type RunningState, InventoryUnsupportedError, runningStateOf } from "../backend.js";
import type { InventoryEntry } from "../inventory.js";
import { READ, refused, type RefusalClass } from "../audit.js";
import { ACQUIRE_SETTING, type AccessibilityLayer, type AccessibilityLayerState } from "../accessibility/index.js";
import type { KeyDeliverySelection } from "../rawinput/index.js";
import { applicationName } from "../backends/atspi/names.js";
import { CATALOG, type LaunchCatalog } from "../launch/recipes.js";
import { findRecipe } from "../launch/spawn.js";
import { OwnershipTable } from "../launch/table.js";
import { activateElement, clearElementText, clickElement, editElement, revealElement, sendKeyChord, setElementCaret, setElementText, setElementValue, submitElement, typeText } from "./dispatch.js";
import { listApplications, treeNameOf } from "./launch-focus.js";
import { startServer } from "./pipes.js";
import { operation } from "./subscriptions.js";

export interface LaunchContext {
  catalog: LaunchCatalog;
  table: OwnershipTable;
  pollBudgetMs?: number;
  pollIntervalMs?: number;
  accessibility?: AccessibilityLayer;
  keys?: KeyDeliverySelection;
}

// One neutral answer covers both an unknown name and an installed entry with no launch recipe.
export const NO_LAUNCH_RECIPE_REFUSAL = "no installed application with that name has a launch recipe";

// Multiple entries answering one folded name are ambiguous; never pick one silently.
export const AMBIGUOUS_NAME_REFUSAL =
  "refused by the launch gate: more than one installed application answers to that name - ask again with the application's full id, which listApplications reports for every entry";

export const ALREADY_RUNNING_REFUSAL =
  "that application is already running and was not opened by this daemon - launching a second copy is refused; the running copy must be closed first";

// Two browser identities cannot run at once through this daemon: the browser
// backend dials ONE debugging endpoint (backends/cdp/channel.ts), so a second
// profile would fight the first for it. ALREADY_RUNNING_REFUSAL cannot serve
// here - it says "was not opened by this daemon", which would be a lie about a
// browser this daemon launched itself (ADR-0038). Nothing is killed to make
// room (ADR-0027). Keep this on ONE line: a byte-comparison test copies it.
export const ONE_BROWSER_IDENTITY_REFUSAL = "refused by the launch gate: another browser identity opened by this daemon is already using the browser's debugging endpoint - one browser identity at a time; close it before opening another";

// A spawn that fails after catalog resolution passed. The constant
// names nothing about the command or the filesystem - a raw spawn error would
// leak argv[0], which is platform vocabulary the wire must never carry (B10).
export const COULD_NOT_START_REFUSAL = "the application could not be started";

// A backend that throws while serving a method becomes THIS constant on the
// wire - never the raw error (the M2.1 lesson, commit 98ac7fd: a system error
// leaks transport and platform vocabulary). For the browser backend this is
// the everyday case, not the exotic one: an unreachable debugging endpoint is
// a browser this session cannot read.
export const BACKEND_UNREADABLE_REFUSAL = "the desktop could not be read by this session's backend";

// ...unless what failed names ONE application (ADR-0090). A bus error that
// says the peer behind an element is gone is a fact about that application,
// and answering it with the blanket refusal above says the desk is dead when
// three other windows are open on it. No peer name crosses the wire - that is
// bus vocabulary - only what it means and what to do about it.
export const ELEMENT_GONE_REFUSAL =
  "that element is no longer on the desk - the thing it named has been closed or redrawn since it was answered; " +
  "ask what is there now and work from the ids in that answer";
export const APPLICATION_GONE_REFUSAL =
  "the application this element belonged to is no longer running - ask what is on the desk again and work from the answer, " +
  "the rest of the desk is still there";

// A role the schema does not name is refused HERE, by name, before any backend
// is asked. The AT-SPI role table is keyed by the generated ROLES vocabulary
// and has no entry for anything else, so an unchecked "heading" reached the
// backend and died inside it - and died as BACKEND_UNREADABLE_REFUSAL, which
// reads as a desk that cannot be read rather than a question that cannot be
// asked (ADR-0071).
export const UNKNOWN_ROLE_REFUSAL = "that role is not one this desk can be asked about";
export const QUERY_WINDOW_REQUIRES_APPLICATION_REFUSAL = "a window can only be named inside an application";
export const DISCOVERY_APPLICATION_REFUSAL = "an application must be named for element discovery";
export const DISCOVERY_WINDOW_REFUSAL = "a discovery window must be a non-empty name inside an application";
export const DISCOVERY_LIMIT_REFUSAL = "a discovery limit must be a whole number from 1 through 200";

// A window scope that names no window, or names several, used to answer with
// an EMPTY list - and an empty list is a sentence about the desktop ("this
// window has nothing in it") that the daemon had no grounds to say. Measured
// on a Plasma file dialog, which publishes two visible top-levels called
// "Open Image" for one dialog on screen: every scoped question about it came
// back empty, and the agent asking them concluded the dialog had no controls
// and gave up, while the same question WITHOUT the window answered with the
// whole dialog. Not-found and ambiguous are separate sentences because they
// have separate repairs: one is a wrong name, the other is a name that is not
// enough by itself.
export const WINDOW_SCOPE_UNMATCHED_REFUSAL =
  "no visible window of that application answers to that name, so there is nothing this scope could have been asked about - ask without the window to see what windows there are";
export const WINDOW_SCOPE_AMBIGUOUS_REFUSAL =
  "more than one visible window of that application answers to that name, so this scope names no single window - ask without the window, or by a name only one of them carries";
export const APPLICATION_SCOPE_UNMATCHED_REFUSAL =
  "no application on this desktop answers to that name, so there is nothing this scope could have been asked about - listApplications names every application this desktop has, and an application just launched may not have arrived yet";
export const APPLICATION_SCOPE_AMBIGUOUS_REFUSAL =
  "more than one application on this desktop answers to that name, so this scope names no single application - listApplications names them as the desktop publishes them";

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


// The two raw-input methods share one refusal shape and differ in the name
// they carry, because the name is what the caller reads back to know which
// call was turned away (ADR-0070 admits typeText into the same class).
export type RawInputMethod = "sendKeyChord" | "typeText" | "clearElementText" | "clickElement";

export function rawInputScopeSentence(method: RawInputMethod): string {
  return (
    `refused by the scope gate: "${method}" is rawInput-class and this session holds no rawInput authority - ` +
    `${method === "sendKeyChord" ? "a key is" : method === "typeText" ? "typed text is keystrokes, and keystrokes are" : method === "clearElementText" ? "clearing presses one key per character, and keystrokes are" : "a pointer press is synthesised on the machine, and a synthesised press is"} raw input even when it is addressed to one element, ` +
    "this session was started without the session flag --allow rawInput, and only a session started with it can perform this method"
  );
}

// The two refusals that are NOT about authority, and the difference between
// them is the difference the wire's vocabulary was built for. A chord this
// contract never defined is the caller's mistake and naming the vocabulary
// tells them how to fix it. A machine with no key route is nobody's mistake:
// no setting changes it, which is why the sentence offers none - offering one
// is how an operator spends an afternoon editing a file that was never the
// problem.
export function unknownChordRefusal(chord: string): string {
  return (
    `refused before the call: "sendKeyChord" was given the chord ${JSON.stringify(chord)}, which this contract does not define - ` +
    `the chord list is closed on purpose (a free-form key string is an arbitrary-input surface wearing a chord's clothes), and the names it does define are: ${KEY_CHORD_NAMES.join(", ")}`
  );
}

export const NO_KEY_ROUTE_REFUSAL =
  'refused before the call: "sendKeyChord" cannot be performed by this build on this platform - there is no way to deliver a key here, and no setting on this daemon would change that';

export const NO_CLEAR_ROUTE_REFUSAL =
  'refused before the call: "clearElementText" cannot be performed by this build on this platform - there is no way to deliver a key here, and no setting on this daemon would change that';

// The pointer vocabulary, named here rather than imported from the AT-SPI
// route: the wire's vocabulary is the contract's, not one platform's, and a
// second backend with a different gesture table must not be able to widen what
// the wire accepts by existing.
export const POINTER_BUTTON_NAMES: readonly string[] = ["left", "middle", "right"];

export const NO_POINTER_ROUTE_REFUSAL =
  'refused before the call: "clickElement" cannot be performed by this build on this platform - there is no way to move or press a pointer here, and no setting on this daemon would change that';

// The pointer's own vocabulary refusals (ADR-0078). Each names the thing that
// was wrong and the set it was not in, for the same reason the chord list is
// spelled out: a caller told only "invalid" has to guess, and guessing at an
// input surface is how a caller ends up sending a hundred variants.
export function unknownButtonRefusal(button: string): string {
  return (
    `refused before the call: "clickElement" was given the button ${JSON.stringify(button)}, which this contract does not define - ` +
    'the buttons it defines are: left, middle, right'
  );
}

export function unknownClickCountRefusal(count: unknown): string {
  return (
    `refused before the call: "clickElement" was asked for ${JSON.stringify(count)} presses and this contract performs 1 or 2 - ` +
    "a double click is asked for by name so that the platform makes the gesture, and anything beyond two is a drumroll rather than a click"
  );
}

export function outsideElementRefusal(axis: "x" | "y", value: unknown): string {
  return (
    `refused before the call: "clickElement" was given ${axis} of ${JSON.stringify(value)}, and a position inside an element ` +
    "is a fraction of that element's own rectangle from 0 through 1 - a fraction outside that range names a point outside the element, which is a press on a neighbour"
  );
}

export function unknownCapturedAtRefusal(value: unknown): string {
  return (
    `refused before the call: "clickElement" was given capturedAt of ${JSON.stringify(value)}, and a picture is named by the ` +
    "finite millisecond time this daemon answered for it - a time that is not a number names no picture this daemon could check"
  );
}

export const NO_TYPE_ROUTE_REFUSAL =
  'refused before the call: "typeText" cannot be performed by this build on this platform - there is no way to deliver a key here, and no setting on this daemon would change that';

// WHAT A STRING MAY CARRY (ADR-0070 clause 3). The bound and the character
// class are the whole of what keeps typeText from being the free-form key
// surface ADR-0067 refused: a control character is a chord with no name on the
// list, and a string long enough to be a document is a payload, not a field
// entry. Both are refused BY NAME - the offending character and its position,
// or the length and the limit - so the caller knows which sentence to fix.
// A newline in particular is refused with the chord that replaces it, because
// that is the one a caller reaching for typeText to "submit" will have meant.
export const TYPE_TEXT_MAX_LENGTH = 1024;

export function typeTextRefusal(text: string): string | undefined {
  if (text.length === 0) return 'refused before the call: "typeText" was given no text - an empty string types nothing, and a call that does nothing is refused rather than performed';
  if (text.length > TYPE_TEXT_MAX_LENGTH) {
    return `refused before the call: "typeText" was given ${text.length} UTF-16 code units and this contract delivers at most ${TYPE_TEXT_MAX_LENGTH} in one call - a field entry is short, and a longer text is a payload this raw-input class does not carry`;
  }
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { index += 1; continue; }
      return 'refused before the call: "typeText" contains an unpaired surrogate';
    }
    if (code >= 0xdc00 && code <= 0xdfff) return 'refused before the call: "typeText" contains an unpaired surrogate';
    // C0, DEL and C1: every code point a keyboard has no printable glyph for.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      const which =
        code === 0x0a || code === 0x0d
          ? "a newline - a newline is not text, it is the chord Enter, sent separately through sendKeyChord"
          : code === 0x09
            ? "a tab - a tab is not text, it is the chord Tab, sent separately through sendKeyChord"
            : code === 0x1b
              ? "an escape - an escape is not text, it is the chord Escape, sent separately through sendKeyChord"
              : `the control character U+${code.toString(16).toUpperCase().padStart(4, "0")}, which no field takes as text`;
      return `refused before the call: "typeText" was given ${which}; found at position ${index} - the text this method types is printable only, and anything a keyboard sends that is not a printable character is a named chord or nothing`;
    }
  }
  return undefined;
}

// BOTH FACTS, WHEN BOTH ARE TRUE. An unarmed session on a machine with no key
// route is refused for want of authority first - ADR-0019's ordering, and the
// gate that runs before a target is even named - but stopping there would hand
// an operator a flag that fixes nothing, which is the exact false belief the
// availability vocabulary exists to prevent (protocol/schema.json:236). Saying
// only the second would be the mirror error: it would tell a session it lacks a
// route when it also lacks permission, and the permission is real and would
// still be missing on a machine that could type.
//
// So the sentence carries both, in the order they would have to be fixed, and
// says plainly that the flag alone is not enough here. The capability report
// answers the same question with `not-exposed` and names no setting
// (capabilityFor above), because a report has no room for a sequence.
export function rawInputScopeRefusal(hasRoute: boolean, method: RawInputMethod = "sendKeyChord"): string {
  const sentence = rawInputScopeSentence(method);
  if (hasRoute) return sentence;
  return (
    `${sentence} - and on this machine the flag alone would not be enough: ` +
    "this build has no way to deliver a key here, and no setting on this daemon would change that"
  );
}

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
// says so, because the application does not expose it.
// The optional index is the LISTING's: it holds the enumerated inventory, so
// observe and launch resolve through the entry's several names (ADR below).
// A caller without one - a context built without a server, a test asking
// about one name - gets the exact-name behaviour, the same degradation the
// launch gate applies when the inventory cannot be read at all.
export function capabilityExposureFor(
  launch: LaunchContext,
  capability: CapabilityName,
  application: string,
  index?: InventoryIndex,
): Capability {
  // What this daemon can do AT ALL for this application, before any question
  // of permission. Launch needs a recipe; the element verbs need an element,
  // which is a question about a running application rather than about this
  // one, so they are reported on their own terms below.
  if (capability === "launch" && findRecipe(application, launch.catalog) === undefined) {
    return { capability, availability: "not-exposed" };
  }
  // Raw input's reach question, asked in the same breath as launch's for the
  // same reason: this is what the daemon can do AT ALL here, before any
  // question of permission. A build with no key route on this platform reports
  // not-exposed, and names no setting, because none would help (ADR-0066
  // clause 2). Note the ORDER against permission below - reach first means an
  // unarmed session on an unsupported platform is told the true reason rather
  // than sent to add a flag that would still deliver nothing.
  if (capability === "rawInput" && launch.keys === undefined) {
    return { capability, availability: "not-exposed" };
  }
  return { capability, availability: "available" };
}

// WHETHER ONE APPLICATION IS ANSWERING, decided here and not in the backend
// (ADR-0063).
//
// The grant is checked FIRST and short-circuits the census entirely. That
// order is the whole point: a session with no observe grant for an application
// cannot observe, and reporting the census's answer to it would leak
// the desk through a field that is not gated. Reporting "not-answering"
// instead would be worse - a false statement about the desktop manufactured
// out of a fact about permission - so the answer is cannot-tell, naming the
// grants file, which genuinely is the setting a person would change to be told.
//
// isVisible is the same reader the observe capability uses six lines up, on the
// same deny-by-default fallback, so the field and the capability beside it can
// never disagree about what this session may see.
//
// AND WHETHER THE DESK COULD BE HEARD AT ALL. A machine whose accessibility
// layer is switched off did not tell this daemon an application is absent - it
// told it nothing, about every application at once. Reporting not-answering on
// that silence is a statement about the desktop manufactured out of a fact
// about the machine's ears, which is the same error the grant check above
// exists to prevent, arriving through a different door. Measured on a fresh
// demo container: org.a11y.Status/IsEnabled was false and every one of the
// hundred-odd installed applications was reported absent, several of them open.
//
// Only the layer state `disabled` names ACQUIRE_SETTING. `cannot-tell` - which
// is what a failed read and an unsupported platform both return
// (accessibility/index.ts:19-22, :71) - names NOTHING, because an operator told
// "switch it on" when the truth is "I could not find out" goes and switches on
// something that was never off. A positive census result is never degraded by
// either: an application that answered is not made mute by a stale reading.
export function runningFieldsFor(
  launch: LaunchContext,
  census: RunningCensus,
  entry: InventoryEntry,
  index: InventoryIndex,
  heard: AccessibilityLayerState,
  ownedAndLive: ReadonlySet<string>,
): { running: RunningState; runningUnknownBy?: string } {
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
  if (answering.some((name) => (index.census.get(name)?.length ?? 0) > 1)) return { running: "cannot-tell" };
  if (answering.length > 0) return { running: "answering" };
  // Absence is only a measurement if EVERY name this entry could answer to was
  // within the horizon. Otherwise the route never had a view of it.
  const states = [...names].map((name) => runningStateOf(census, name));
  if (!states.every((state) => state === "not-answering")) return { running: "cannot-tell" };
  // The census would say absent. Before that is believed, ask whether this
  // machine can be heard at all - the one reading that explains every silence
  // on the desk at once.
  if (heard === "disabled") return { running: "cannot-tell", runningUnknownBy: ACQUIRE_SETTING };
  if (heard === "cannot-tell") return { running: "cannot-tell" };
  // AND WHETHER THIS DAEMON CAN STILL SEE THE PROCESS BREATHING. The desk can
  // be heard, and this name is not on the tree - but this daemon started it and
  // can still verify the process it started is alive. Absence from the
  // accessibility tree is not absence from the machine, and restart already
  // treats owned-process liveness as authoritative over tree absence for
  // exactly this reason (:1613). No setting is named: nothing an operator could
  // change fixes "I own it, it is alive, and it is not publishing".
  //
  // ONLY names this daemon launched are consulted. An application a person
  // started by hand has no owned entry, so the set does not contain it, so
  // nothing about it changes. That invisibility is a product decision, and this
  // reading is scoped to leave it exactly where it was.
  if ([...names].some((name) => ownedAndLive.has(name))) return { running: "cannot-tell" };
  return { running: "not-answering" };
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
export function censusNamesOf(entry: { name: string; diagnostic?: Record<string, string> }, catalog: LaunchCatalog): Set<string> {
  const names = candidateNamesOf(entry, catalog);
  const displayed = entry.diagnostic?.["mastra-cc/display-name"];
  if (displayed !== undefined) names.add(applicationName(displayed));
  return names;
}

// THE NAMES AN ENTRY ITSELF PUBLISHES, minus the human label. The census above
// adds the desktop file's `Name=` because a wrong census guess degrades to
// cannot-tell and costs a reading; a wrong PERMISSION guess launches or
// exposes the wrong application, and the display label is exactly where real
// desks collide - measured on the live demo desk
// (tools/candidate-collisions.mjs), 13 of 16 candidate collisions were pure
// `Name=` label collisions (kcm modules twinned with their _x11 builds), and
// excluding the label leaves 2, both internal helper entries. So the
// label stays a census candidate and is never a permission one. Both sets are
// still read off the entry alone - id, the catalog's appears-as translation,
// the final dot-segment - never guessed from a table of known applications.
export function candidateNamesOf(entry: { name: string; diagnostic?: Record<string, string> }, catalog: LaunchCatalog): Set<string> {
  const names = new Set<string>([applicationName(entry.name), treeNameOf(entry.name, catalog)]);
  const segment = entry.name.slice(entry.name.lastIndexOf(".") + 1);
  if (segment.length > 0) names.add(applicationName(segment));
  return names;
}

// ONE CONSTRUCTION SITE for "what does this desk answer to". The union is the
// listing's union, moved rather than reimplemented: installed entries first,
// keeping their diagnostic, then every catalog recipe key the scan did not
// see as a synthetic entry - a recipe adds a name the scan could not, and
// never overwrites what the machine itself said. Both the listing and the
// launch gate build their claims HERE, so there is exactly one notion of
// which entries claim a name and one notion of ambiguity.
//
// Two indexes over one union, because the two readers tolerate different
// errors: `census` includes the `Name=` display label (a wrong match degrades
// to cannot-tell), `launchNames` does not (a wrong match launches or exposes
// the wrong application - see candidateNamesOf above for the measurement).
export interface InventoryIndex {
  readonly entries: readonly InventoryEntry[];
  /** censusNamesOf-derived: candidate -> entries claiming it */
  readonly census: ReadonlyMap<string, readonly InventoryEntry[]>;
  /** candidateNamesOf-derived: candidate -> entries claiming it */
  readonly launchNames: ReadonlyMap<string, readonly InventoryEntry[]>;
}

export function indexInventory(installed: readonly InventoryEntry[], catalog: LaunchCatalog): InventoryIndex {
  // Installed entries are kept AS SCANNED, never collapsed: two desktop files
  // whose ids differ only by case (`org.example.Kate`, `org.example.kate`) are
  // two entries that contend for one folded name, and contention is the
  // resolver's answer (ADR-0069 under ADR-0068), not a silent pick of one.
  const entries = [...installed];
  const claimed = new Set(installed.map((entry) => applicationName(entry.name)));
  for (const key of Object.keys(catalog)) {
    if (!claimed.has(applicationName(key))) {
      claimed.add(applicationName(key));
      entries.push({ name: key });
    }
  }
  const census = new Map<string, InventoryEntry[]>();
  const launchNames = new Map<string, InventoryEntry[]>();
  for (const entry of entries) {
    for (const name of censusNamesOf(entry, catalog)) census.set(name, [...(census.get(name) ?? []), entry]);
    for (const name of candidateNamesOf(entry, catalog)) launchNames.set(name, [...(launchNames.get(name) ?? []), entry]);
  }
  return { entries, census, launchNames };
}

// Resolve a request against the same installed-entry union used by the census.
// An unreadable inventory falls back to an exact catalog lookup; a readable
// inventory preserves ambiguity and requires the selected entry to have a recipe.
export type Resolution =
  | { kind: "launchable"; entry?: InventoryEntry }
  | { kind: "unlaunchable" }
  | { kind: "ambiguous" };

export function resolveLaunchable(
  name: string,
  index: InventoryIndex | undefined,
  catalog: LaunchCatalog,
): Resolution {
  const wanted = applicationName(name);
  if (index === undefined) return findRecipe(wanted, catalog) === undefined ? { kind: "unlaunchable" } : { kind: "launchable" };
  const claimants = index.launchNames.get(wanted) ?? [];
  // AN EXACT FULL ID IS NEVER AMBIGUOUS. Derived recipes routinely put a
  // sibling's id inside another entry's candidates - chrome and gmail both
  // appear as `chrome` - and a rule that let a sibling's appears-as make the
  // real entry's own id unreachable would refuse launches that work today.
  // Ids are compared case-folded (ADR-0069), so two installed entries CAN
  // match one id exactly when their ids differ only by case; that pair is
  // contested like any other and refuses. Otherwise one exact match wins,
  // and only DERIVED claims can contend, refusing at >1.
  const entry = claimantOf(wanted, index);
  if (entry === undefined && claimants.length > 1) return { kind: "ambiguous" };
  if (entry === undefined) return { kind: "unlaunchable" };
  return findRecipe(entry.name, catalog) === undefined ? { kind: "unlaunchable" } : { kind: "launchable", entry };
}

// The one entry a (normalised) name resolves to, or undefined when the name
// is unclaimed or contested. Exact-id precedence as above.
export function claimantOf(wanted: string, index: InventoryIndex): InventoryEntry | undefined {
  const claimants = index.launchNames.get(wanted) ?? [];
  const exact = claimants.filter((claimant) => applicationName(claimant.name) === wanted);
  // two entries with the SAME folded id (a case-only pair) are contested, not exact
  if (exact.length === 1) return exact[0];
  return exact.length === 0 && claimants.length === 1 ? claimants[0] : undefined;
}
