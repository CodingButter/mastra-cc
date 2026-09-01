// A restart the operator allowed, and a dialog that outranks it.
//
// Three beats against one real editor, all through the wire:
//
//   1. an unconfigured daemon is asked to restart an application it opened, and
//      refuses - naming the setting, which is the default this segment keeps;
//   2. the same application, made dirty through the ordinary semantic write
//      route, refuses to close: the unsaved-work dialog is reported back as an
//      element to read, and the application is STILL RUNNING afterwards, which
//      is checked with segment 01's running state rather than assumed;
//   3. a clean copy of the same application is closed and started again, and
//      reads afterwards.
//
// Beat 2 is the point. A restart that only ever worked would prove the easy
// half; the half that matters is the one where a person's unsaved work stops a
// machine, and nothing in this driver dismisses that dialog.
//
//   node who-may-close-a-window.mjs ws://<address>:<port> <mode>
//
// mode is "refuses" (no restart configured) or "acts" (graceful configured).
// The wire, and nothing above it: this beat has no model in it. Whether an
// operator may close a window is a question about authority, not about
// language, and a model asked to narrate it would only add a place to lie.
import { connect } from "@mastra-cc/transport";

const [url, mode] = process.argv.slice(2);
if (!url) throw new Error("a websocket url is required");

const log = (step, detail) => console.log(`${step}: ${JSON.stringify(detail)}`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const APP = process.env.MASTRA_CC_APP ?? "org.kde.kate";
const CLEAN = process.env.MASTRA_CC_CLEAN_APP ?? "org.kde.dolphin";

const client = await connect({ url });

// Absent is reported as absent and never defaulted: the red side of this proof
// is a daemon built before schema 1.9.0, and a driver that quietly treated a
// missing route as a refusal would score the base commit as a pass.
const restart = async () => {
  if (typeof client.restartApplication !== "function") return { route: "absent" };
  try {
    return { route: "present", ...(await client.restartApplication({ name: APP })) };
  } catch (error) {
    return { route: "present", threw: String(error).slice(0, 300) };
  }
};

const runningState = async () => {
  const listed = await client.listApplications({});
  return listed.applications.find((application) => application.name.toLowerCase() === APP.toLowerCase())?.running;
};

const open = async () => {
  const opened = await client.openApplication({ name: APP });
  if (opened.refusal !== undefined) throw new Error(`could not open ${APP}: ${opened.refusal}`);
  return opened.application;
};

const problems = [];
const transcript = {};

// ---- beat 1: an operator who configured nothing ----------------------------
if (mode === "refuses") {
  await open();
  await wait(2000);
  const refused = await restart();
  log("the-restart-with-nothing-configured", refused);
  transcript.refused = refused;
  if (refused.route === "absent") problems.push("this daemon has no restartApplication route");
  else if (refused.refusal === undefined) {
    problems.push("an unconfigured daemon restarted an application anyway");
  } else if (!/refused by configuration/.test(refused.refusal)) {
    problems.push(`refused, but not as a configuration decision: ${refused.refusal}`);
    // refusalClass is internal and never reaches the wire, so the sentence the
    // caller actually receives is what gets checked - which is the sentence a
    // person would have to act on anyway.
  } else if (!/restart\.default/.test(refused.refusal)) {
    problems.push("the refusal did not name the setting that would change it");
  }
  const still = await runningState();
  log("still-running-after-the-refusal", still);
  if (still !== "answering") problems.push(`a refused restart left the application ${still}`);
}

// ---- beats 2 and 3: an operator who chose graceful --------------------------
if (mode === "acts") {
  await open();
  await wait(3000);

  // Kate opens on a Welcome screen with no document at all, and a Welcome
  // screen has nothing to lose. The document is made the way a person makes
  // one: File > New, pressed through the action the menu item itself publishes.
  // More than one thing here is called New, and one of them only opens a
  // submenu. The one that makes a document is the one publishing Press, which
  // is the element's own statement rather than a guess about menu layout.
  const newFile = (await client.queryElements({ role: "menuitem", nameMatches: "New", limit: 10 })).elements.find(
    (element) => element.actions?.some((action) => action.name === "Press" && action.availability === "available"),
  );
  if (newFile === undefined) problems.push("no File > New in this editor - cannot create a document to dirty");
  else {
    const pressed = await client.activateElement({ id: newFile.id, action: "Press" });
    log("the-new-document", { pressed: pressed.refusal ?? "pressed" });
  }
  await wait(2500);

  // Dirty the document through the ordinary semantic route. No synthetic input:
  // this is setElementText, the same verb any agent has. Which of the editor's
  // text surfaces is the DOCUMENT is not something to guess at, so each writable
  // one is tried until the window title grows the modified marker - the editor's
  // own statement that it now has something to lose.
  const writable = (await client.queryElements({ role: "text", limit: 30 })).elements.filter((element) =>
    element.operations?.some((operation) => operation.operation === "setText" && operation.availability === "available"),
  );
  const dirtyTitle = async () =>
    (await client.queryElements({ role: "window", limit: 20 })).elements.some((window) => / \*|\* /.test(window.name ?? ""));
  let dirty = false;
  for (const surface of writable) {
    const wrote = await client.setElementText({ id: surface.id, text: "work nobody wants to lose" });
    await wait(1200);
    dirty = await dirtyTitle();
    log("the-unsaved-work", { surface: surface.id, wrote: wrote.refusal ?? "written", editorSaysModified: dirty });
    if (dirty) break;
  }
  if (!dirty) problems.push("could not give the editor unsaved work - nothing to refuse a close over");
  await wait(1500);

  const blocked = await restart();
  log("the-restart-against-unsaved-work", blocked);
  transcript.blocked = blocked;
  if (blocked.route === "absent") problems.push("this daemon has no restartApplication route");
  else if (blocked.application !== undefined) {
    problems.push("the application was restarted while it still had unsaved work");
  } else if (blocked.blockedBy === undefined) {
    // A timeout refusal is an honest answer, but it is not THIS proof: the
    // claim being made is that the application's own dialog came back as a
    // readable element. Accepting "it did not close" for that would let the
    // index document say something the run never showed.
    problems.push(`the restart returned no blocking element: ${JSON.stringify(blocked.refusal)}`);
  }

  const survived = await runningState();
  log("still-running-after-the-block", survived);
  transcript.survived = survived;
  if (survived !== "answering") {
    problems.push(`the application was ${survived} after refusing to close - its unsaved work was not respected`);
  }
  // What the person would be shown. Read, never dismissed.
  if (blocked.blockedBy !== undefined) {
    log("what-the-application-put-up", { role: blocked.blockedBy.role, name: blocked.blockedBy.name });
  }

  // ---- beat 3: the same authority, nothing to lose -------------------------
  // The dirty editor is left exactly as it is; a second, clean copy is what the
  // acting path is measured against.
  const clean = await client.openApplication({ name: CLEAN });
  const secondName = clean.refusal === undefined ? CLEAN : undefined;
  log("a-clean-application", { opened: secondName ?? clean.refusal });
  if (secondName !== undefined) {
    await wait(3000);
    const acted =
      typeof client.restartApplication === "function"
        ? await client.restartApplication({ name: secondName }).catch((error) => ({ threw: String(error).slice(0, 300) }))
        : { route: "absent" };
    log("the-restart-with-nothing-to-lose", {
      restarted: acted.application !== undefined,
      refusal: acted.refusal,
    });
    transcript.acted = { restarted: acted.application !== undefined, refusal: acted.refusal };
    if (acted.application === undefined) {
      problems.push(`a clean application did not come back from a graceful restart: ${JSON.stringify(acted.refusal)}`);
    }
  } else {
    problems.push("could not open a second application to restart cleanly");
  }
}

console.log(
  JSON.stringify({
    proof: problems.length === 0 ? "green" : "red",
    mode,
    ...transcript,
    ...(problems.length ? { reason: problems } : {}),
  }),
);
client.close();
process.exit(problems.length === 0 ? 0 : 1);
