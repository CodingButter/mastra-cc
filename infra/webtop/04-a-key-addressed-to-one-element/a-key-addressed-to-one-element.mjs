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
// WHY THE ARMED RUN ALSO REFUSES, and why that is the honest green. This driver
// was written to finish E2 - and running it is how the segment learned that the
// accessibility interface it was built on takes Enter, F2 and every arrow and
// delivers none of them, while answering success to all of them. The evidence
// is in the proof document beside this file, including the control keystroke
// that moved the same window in the same second through a different mechanism.
// So the daemon now reports no route at all, and this driver proves the two
// refusals a caller can actually get: one that a flag would fix, and one that
// nothing on this machine would.
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
const OLD_NAME = process.env.MASTRA_CC_OLD_NAME ?? "notes.txt";
const NEW_NAME = process.env.MASTRA_CC_NEW_NAME ?? "renamed-by-a-key.txt";

const client = await connect({ url });

// Absent is reported as absent. The red side of this proof is a daemon built
// before schema 1.11.0, and a driver that treated a missing route as a refusal
// would score the base commit as a pass for behaviour it does not have.
const press = async (id, chord) => {
  if (typeof client.sendKeyChord !== "function") return { route: "absent" };
  try {
    return { route: "present", ...(await client.sendKeyChord({ id, chord })) };
  } catch (error) {
    return { route: "present", threw: String(error).slice(0, 300) };
  }
};

const problems = [];

const opened = await client.openApplication({ name: "org.kde.dolphin" });
if (opened.refusal !== undefined) throw new Error(`could not open the file manager: ${opened.refusal}`);
await wait(3000);

// The file, as the file manager itself lists it. Not a path, not a guess about
// the view's layout - the element that carries the name a person would click.
// Read the desk and pick the row out of it, rather than asking the desk to
// match a name: name matching on the wire is exact NFKC equality, and the row
// that says "notes.txt" sits among a hundred menu items that also mention it.
const fileItem = async (name) =>
  (await client.queryElements({ limit: 300 })).elements.find(
    (element) => element.role === "listitem" && (element.name ?? "") === name,
  );

const target = await fileItem(OLD_NAME);
log("the-file-as-the-desk-lists-it", target === undefined ? "not found" : { role: target.role, name: target.name });
if (target === undefined) problems.push(`the file manager is not showing ${OLD_NAME}`);

// ---- the key that starts the rename ---------------------------------------
// F2, addressed to the item. This is the first of the two keystrokes the errand
// needs and the file manager publishes no action for it: renaming is a context
// menu entry or a key, and the context menu route was the one E4 could not
// reach either.
const started = target === undefined ? { route: "skipped" } : await press(target.id, "F2");
log("the-rename-key", started);
if (started.route === "absent") problems.push("this daemon has no sendKeyChord route");
if (mode === "denied") {
  const refusal = started.refusal ?? "";
  if (started.route === "absent") {
    // Already recorded above; a daemon without the route cannot demonstrate the
    // switch either way, and saying both would double-count one fact.
  } else if (refusal === "") {
    problems.push("a daemon nobody armed pressed a key anyway");
  } else if (!/rawInput/.test(refusal)) {
    problems.push(`refused, but not for want of the raw-input class: ${refusal}`);
  } else if (!/--allow rawInput/.test(refusal)) {
    problems.push("the refusal did not name what would change it");
  }
}

if (mode === "armed") {
  const refusal = started.refusal ?? "";
  if (started.route === "absent") {
    // Recorded already; a daemon with no route cannot be asked this question.
  } else if (refusal === "") {
    problems.push("an armed daemon claimed it pressed a key this machine cannot deliver");
  } else if (/--allow rawInput/.test(refusal)) {
    problems.push("armed, and still refused for want of the flag it was given");
  } else if (!/no way|delivers nothing|cannot/.test(refusal)) {
    problems.push(`refused, but not for want of a route: ${refusal}`);
  }
  // The refusal must not send an operator hunting for a setting. There is no
  // setting; that is the whole content of a not-exposed answer
  // (protocol/schema.json:236).
  if (/turned it off|disabled-by-configuration/.test(refusal)) {
    problems.push("a machine that cannot do a thing was reported as a machine somebody switched off");
  }

  // And the file is untouched, which is the part no wording can fake.
  const original = await fileItem(OLD_NAME);
  const renamed = await fileItem(NEW_NAME);
  log("the-file-manager-afterwards", {
    still_shows_old_name: original !== undefined,
    shows_new_name: renamed !== undefined,
  });
  if (renamed !== undefined) problems.push("something renamed the file after refusing to");
}

await client.close();
if (problems.length > 0) {
  for (const problem of problems) console.log(`PROBLEM: ${problem}`);
  process.exit(1);
}
console.log(mode === "denied" ? "REFUSED FOR WANT OF AUTHORITY, as it must be" : "REFUSED FOR WANT OF A ROUTE, as it must be");
