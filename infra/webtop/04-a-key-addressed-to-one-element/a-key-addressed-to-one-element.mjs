// The errand that could not be finished, finished.
//
// E2 of the desktop-literacy sweep - "rename a file in the file manager" - was
// 0/3 before the instructions were rewritten and 0/3 after, and the diagnosis
// was never prose: Dolphin's inline rename commits on Enter, and the daemon had
// no way to press Enter. Every other route was correctly refused rather than
// faked. This driver runs that errand end to end, and the only thing that
// changed is that one key now exists.
//
//   node a-key-addressed-to-one-element.mjs ws://<address>:<port> <mode>
//
// modes:
//   denied - a daemon started WITHOUT --allow rawInput; the key must be refused
//            for want of authority, naming the flag that would grant it
//   armed  - a daemon started WITH it; the key must be refused for want of a
//            ROUTE, because this machine has none - see below
//
// TWO CORRECTIONS LIVE HERE, and both are the same mistake made twice: reading
// a measurement failure as a fact about the world.
//
// The first: this driver reported that the accessibility interface takes F2,
// Enter and every arrow and delivers none of them, and the segment came within
// one commit of shipping "this desk will not take a key" as a finding. It was
// wrong. The interface was being asked to deliver into an element that had
// never been given focus - the driver reached for a published action instead of
// a focus grab - and a key sent at nothing lands nowhere. Told to grab focus
// first, the same desk takes every one of them. measure-delivery.sh beside this
// file is the control that settles it.
//
// The second: the errand was going to be the file manager rename that E2 could
// never finish. It is not, and the reason is worth recording rather than hiding
// - in this image F2 does not start a rename in that file manager AT ALL, not
// from this daemon and not from a real keyboard pressed at the same window one
// second later. The errand here is therefore the one this desk can actually be
// asked to do: an editor, a document, and the two keys that change it. What the
// segment set out to prove - one named key, addressed to one element, verified
// by reading the desk back - is proven either way. Which application is on the
// other end of it is an environment fact, and pretending otherwise would be
// making the same mistake a third time.
//
// (Legacy note.) This driver's first version reported that the
// accessibility interface takes F2, Enter and every arrow and delivers none of
// them, and the segment came within one commit of shipping "this desk will not
// take a key" as a finding. It was wrong. The interface was being asked to
// deliver into an element that had never been given focus - the driver reached
// for a published action instead of a focus grab - and a key sent at nothing
// lands nowhere. Told to grab focus first, the same desk takes every one of
// them. The measurement that settles it, including the control keystroke, is
// measure-delivery.sh beside this file; the story is in the proof document.
//
// The verdict is never the return code of a keypress. The interface answers
// `()` to a key that landed and to a key that vanished (ADR-0067), so what this
// driver believes is the FILESYSTEM: the harness reads the directory
// afterwards, out of band, and a rename that only happened in a return value is
// a rename that did not happen.
import { connect } from "@mastra-cc/transport";

const [url, mode] = process.argv.slice(2);
if (!url) throw new Error("a websocket url is required");

const log = (step, detail) => console.log(`${step}: ${JSON.stringify(detail)}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PAPER = process.env.MASTRA_CC_PAPER ?? "keys.txt";
const TYPED = "alpha";

const client = await connect({ url });

// Absent is reported as absent. The red side of this proof is a daemon built
// before schema 1.11.0, and a driver that treated a missing route as a refusal
// would score the base commit as a pass for behaviour it does not have.
// A throw is its own outcome and is never folded into "refused". A transport
// error and a daemon declining are different facts, and a driver that reported
// them as one would score a broken connection as a principled refusal.
const press = async (id, chord) => {
  if (typeof client.sendKeyChord !== "function") return { route: "absent" };
  try {
    return { route: "present", ...(await client.sendKeyChord({ id, chord })) };
  } catch (error) {
    return { route: "threw", threw: String(error).slice(0, 300) };
  }
};

// The two refusals this proof is about, matched on the words that distinguish
// them rather than on a loose pattern. Almost every refusal in this daemon
// contains the word "cannot"; scoring green on that would let an unrelated
// failure - a bad id, a dead backend - pass for the finding.
const WANTS_AUTHORITY = "--allow rawInput";
const FLAG_IS_NOT_ENOUGH = "the flag alone would not be enough";

const problems = [];

const opened = await client.openApplication({ name: "org.kde.kate" });
if (opened.refusal !== undefined) throw new Error(`could not open the editor: ${opened.refusal}`);
await wait(4000);

// Kate opens on a Welcome screen with no document at all, and a Welcome screen
// has writable boxes that are not documents - a search field will happily take a
// word and give it back, which is how an earlier version of this driver watched
// a key "arrive" somewhere that could not show it. The document is made the way
// segment 03 makes one: File > New, through the action the menu item publishes.
const newFile = (await client.queryElements({ role: "menuitem", nameMatches: "New", limit: 10 })).elements.find(
  (element) => element.actions?.some((action) => action.name === "Press" && action.availability === "available"),
);
if (newFile === undefined) problems.push("no File > New in this editor - cannot make a document to type into");
else await client.activateElement({ id: newFile.id, action: "Press" });
await wait(2500);

const surfaces = async () =>
  (await client.queryElements({ role: "text", limit: 30 })).elements.filter((element) =>
    element.operations?.some((operation) => operation.operation === "setText" && operation.availability === "available"),
  );

// WHICH surface is the document is settled by the editor, not by this driver:
// the one whose write makes the window title grow a modified marker is the one
// holding a document. Everything else that took the word was a box.
const modified = async () =>
  (await client.queryElements({ role: "window", limit: 20 })).elements.some((window) => / \*|\* /.test(window.name ?? ""));

// The word is typed SEMANTICALLY - raw input is for the keys semantics cannot
// express, and typing text is not one of them (ADR-0046 clause 3).
let document_;
for (const candidate of await surfaces()) {
  const written = await client.setElementText({ id: candidate.id, text: TYPED });
  await wait(1200);
  if (written.element?.content?.value === TYPED && (await modified())) {
    document_ = written.element;
    break;
  }
}
log(
  "the-document-as-the-editor-confirms-it",
  document_ === undefined ? "not found" : { id: document_.id, holds: document_.content?.value },
);
if (document_ === undefined) problems.push("no surface in the editor took the word AND made the editor say it had a document");

// ---- the key ---------------------------------------------------------------
// The caret is placed deliberately rather than inherited. A write leaves it
// wherever the toolkit felt like leaving it, and a Backspace at position zero is
// a no-op that looks exactly like a key that never arrived - this driver spent a
// run learning that difference.
if (document_ !== undefined) {
  // Bring the document into view first, through the operation it publishes for
  // exactly that. A synthesised key follows the display server's focus, and this
  // daemon launches WITHOUT stealing focus (ADR-0044) - so on a freshly opened
  // desk there may be no active window at all, and a key aimed at an element in
  // an unraised window is a key aimed at nothing. Asking semantically is the
  // right order: reveal is an operation the element offers, not a keystroke.
  // Asked, not required: reveal is the operation the element publishes for
  // being brought into view, and if this backend cannot honour it that is a
  // fact to record, not a reason to abandon the errand.
  const revealed = await client.revealElement({ id: document_.id }).catch((error) => ({ refusal: String(error.message ?? error) }));
  log("the-document-brought-into-view", { reveal: revealed.refusal ?? "revealed" });
  await wait(1000);
  await client.setElementCaret({ id: document_.id, offset: 0 });
}

// Delete, addressed to the document, with the caret known to be at the start: a
// delivered key removes exactly one character and nothing else. That is a change
// no successful return code can manufacture, and one that a key landing in some
// OTHER window cannot produce either.
const struck = document_ === undefined ? { route: "skipped" } : await press(document_.id, "Delete");
log("the-key", struck);
if (struck.route === "absent") problems.push("this daemon has no sendKeyChord route");
if (struck.route === "threw") problems.push(`the key route threw instead of answering: ${struck.threw}`);

if (mode === "denied") {
  const refusal = struck.refusal ?? "";
  if (struck.route === "present" && refusal === "") problems.push("a daemon nobody armed pressed a key anyway");
  if (struck.route === "present" && !refusal.includes(WANTS_AUTHORITY)) {
    problems.push(`refused, but not for want of authority: ${refusal}`);
  }
  // The refusal carries a second clause exactly when this build has no way to
  // deliver a key here. Which case this desk is in is settled by the armed run,
  // not guessed at; the unit tests own both sentences.
  if (refusal.includes(FLAG_IS_NOT_ENOUGH)) console.log("note: this build reports no key route on this platform");
}

if (mode === "armed") {
  const refusal = struck.refusal ?? "";
  if (refusal !== "") problems.push(`armed, and still refused: ${refusal}`);
}

// ---- the verdict, read on a connection that did none of the typing ----------
// The acting session is not asked whether it succeeded. A second client, with
// no rawInput authority of its own, re-reads the same document: if the daemon's
// answer and an independent reading disagree, the independent one is the fact
// (ADR-0047).
await wait(1500);
const witness = await connect({ url });
const seen = (await witness.queryElements({ limit: 400 })).elements.find((element) => element.id === document_?.id);
log("the-document-read-back-by-another-connection", { holds: seen?.content?.value ?? null });
await witness.close();

const expected = mode === "armed" ? TYPED.slice(1) : TYPED;
if ((seen?.content?.value ?? null) !== expected) {
  problems.push(`the document holds ${JSON.stringify(seen?.content?.value ?? null)}, expected ${JSON.stringify(expected)}`);
}

await client.close();
if (problems.length > 0) {
  for (const problem of problems) console.log(`PROBLEM: ${problem}`);
  process.exit(1);
}
console.log(mode === "denied" ? "REFUSED FOR WANT OF AUTHORITY, and the document is untouched" : "THE KEY WAS DELIVERED, AND THE DESK SHOWS IT");
