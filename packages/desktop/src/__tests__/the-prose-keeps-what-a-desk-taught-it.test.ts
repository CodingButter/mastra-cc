import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// EVERY CLAUSE HERE COST A RUN.
//
// The instructions are not a style guide. Most of this file's sentences exist
// because an agent on a live desk did the wrong thing, the transcript was read,
// and a sentence was added so the next agent would not. Prose has no compiler,
// so a tidy-up that removes one of those sentences is silent - the desk simply
// starts failing the same way it failed in September.
//
// So the lessons are pinned by their SUBSTANCE, not their wording: each case
// below names a thing a run got wrong, and asserts the prose still speaks to
// it. A rewrite that keeps the lesson keeps these green; a rewrite that drops
// it does not.

const prose = readFileSync(
  fileURLToPath(new URL("../../instructions/AGENT-INSTRUCTIONS.md", import.meta.url)),
  "utf8",
);

// Read case-insensitively and without punctuation, so a rewording survives and
// only a deletion fails.
function teaches(...phrases: string[]): boolean {
  // Line wrapping is formatting, not meaning: the prose is hard-wrapped, so a
  // pinned sentence is matched against it as a single flowed line.
  const flat = prose.toLowerCase().replace(/\s+/g, " ");
  return phrases.every((phrase) => flat.includes(phrase.toLowerCase()));
}

describe("what a live desk taught these instructions", () => {
  // Measured 2026-09-05: errands only ran when the HUMAN's prompt opened with
  // "you have a real desktop". A prompt that has to say so is a page that did
  // not, and the page is the part every operator gets for free.
  it("says the desktop is real and running, without being told by the task", () => {
    expect(teaches("real machine and it is running right now")).toBe(true);
    expect(teaches("Nobody should ever have to tell you the desktop is real")).toBe(true);
  });

  // Measured 2026-09-05: the agent saved a file and then opened
  // `file:///home/user/Downloads/...` - a home directory this desk does not
  // have. Chromium said the file was not there, and the agent believed the
  // save had failed rather than the path being wrong.
  it("says a download's folder is read, never guessed", () => {
    expect(teaches("actual saved filename and destination")).toBe(true);
    expect(teaches("`describeDesktop` answers where this desk keeps its home")).toBe(true);
    expect(teaches("home directory you have not read")).toBe(true);
    expect(teaches("about your PATH")).toBe(true);
  });

  // Measured 2026-09-05: the agent pressed a greyed-out `Apply`, got a
  // success, and reported a wallpaper the desktop never received. The daemon
  // now refuses that press (ADR-0081); the prose says what the refusal means.
  it("says a greyed-out control is waiting on an earlier step", () => {
    expect(teaches("publishes no `enabled` state")).toBe(true);
    expect(teaches("Go and do the waiting")).toBe(true);
  });

  // Measured 2026-09-05: a run queried System Settings for `Browse`, `Add` and
  // `Choose File`, got three empty lists, and reported that the wallpaper page
  // exposes no way to add an image. The page publishes `Add Wallpaper Image…`,
  // which one `discoverElements` call would have shown it.
  it("says an empty answer to an invented name is not an absent control", () => {
    expect(teaches("is not an absent control")).toBe(true);
    expect(teaches("READ THE LIST")).toBe(true);
  });

  // Measured 2026-09-05: a run looked for a download button on a brand page,
  // found none, and reported that the logo could not be taken - having never
  // opened an image's own context menu, and never typed the image's address.
  it("says an image needs no download button of the site's own", () => {
    expect(teaches("missing download button does not rule out saving")).toBe(true);
    expect(teaches("image address was actually observed")).toBe(true);
  });

  // Measured 2026-09-05, by hand at the desk: the wallpaper grid in System
  // Settings publishes no selection on any item and its `Apply` never gains
  // `enabled`, under our pointer AND under a real one. Runs ground on that page
  // for a hundred steps. The same errand finishes in two verbs at the terminal,
  // read back out of the config file in the browser.
  it("tries a bounded pointer and another GUI route, not a command line", () => {
    // Measured 2026-09-05: the wallpaper grid publishes nothing that says which
    // item is chosen, and the run read that as a closed road and went looking
    // for a terminal. A person at that desk clicks the picture. So does this.
    expect(teaches("A bounded pointer is a next attempt, not a promise")).toBe(true);
    expect(teaches("never guess coordinates")).toBe(true);
    expect(teaches("Do not go looking for a command line")).toBe(true);
  });

  // Measured 2026-09-05 on mastra.ai: every image on the page published neither
  // a name nor readable content, and the run answered by inventing addresses -
  // /logo.png, /images/logo.png - until it gave up. The eyes exist for exactly
  // that page, and the prose has to send a run to them BEFORE the guessing.
  it("says that when the names run out you look at the pixels instead of guessing", () => {
    expect(teaches("captureElement")).toBe(true);
    expect(teaches("Use it the moment naming stops working", "guessing at file names")).toBe(true);
    expect(teaches("these are VISIBLE pixels", "Overlapping windows may appear")).toBe(true);
    expect(teaches("If a crop shows an overlay, reobserve, raise the target", "then capture again before acting")).toBe(true);
    expect(teaches("not task-success evidence", "verify the requested state change")).toBe(true);
  });

  // Measured 2026-09-06, model-desktop-task.po8F5n: reverse-order unnamed
  // controls swapped receipt/total; the run claimed success despite the confirmation.
  it("does not treat returned control order as visual or requested value order", () => {
    const flat = prose.replace(/\s+/g, " ");
    expect(flat).toMatch(/(?:returned|control) order.{0,40}not visual order.{0,40}requested(?: value)? order/i);
  });

  it("maps unnamed fields to visible labels before submitting", () => {
    const flat = prose.replace(/\s+/g, " ");
    expect(teaches("captureElement")).toBe(true);
    expect(flat).toMatch(/unnamed.{0,40}fields.{0,60}(?:label.{0,20}mapping|mapping.{0,20}label)/i);
    expect(flat).toMatch(/capture.{0,30}containing (?:form|window).{0,40}before submitt/i);
    expect(flat).toMatch(/visual(?:ly)?.{0,30}compar.{0,60}(?:intended|visible) label/i);
  });

  it("rejects confirmation mismatches instead of claiming success", () => {
    const flat = prose.replace(/\s+/g, " ");
    expect(flat).toMatch(/compar.{0,30}confirmation.{0,60}intended.{0,30}values/i);
    expect(flat).toMatch(/mismatch.{0,30}(?:not|never).{0,20}success/i);
  });

  // Measured 2026-09-05: keys aimed at a field in a window that was not in
  // front went into the front window instead, and the verb answered performed.
  it("does not mistake a pointer press for proof of keyboard ownership", () => {
    expect(teaches("does not prove keyboard ownership")).toBe(true);
    expect(teaches("reobserve the destination and its focus")).toBe(true);
    expect(teaches("These checks do not guarantee atomic delivery")).toBe(true);
    expect(teaches("bring the target forward", "confirm focus before typing again")).toBe(true);
    expect(teaches("Do not try to raise an obscured window by pressing through it")).toBe(true);
    expect(teaches("inspect focus and the field's state", "compare the value against what you typed")).toBe(true);
  });

  // Measured 2026-09-05: pressing through a file chooser's folder entries left
  // two `Open Image` dialogs stacked open and the file never taken.
  it("offers whole-path entry conditionally and verifies the destination", () => {
    expect(teaches("takes a WHOLE PATH")).toBe(true);
    expect(teaches("query the `dialog` role again")).toBe(true);
    expect(teaches("Otherwise navigate observed folder entries")).toBe(true);
    expect(teaches("disappearing alone does not prove")).toBe(true);
  });

  // Measured 2026-09-05, twice: an errand reported success from the button it
  // had pressed rather than from the setting that button was meant to change.
  it("says a result is read off the desk before it is reported", () => {
    expect(teaches("has not told you about the result")).toBe(true);
    expect(teaches("could not confirm it")).toBe(true);
  });

  // Measured 2026-09-04: a run saved a search engine's cached thumbnail and
  // called it the logo, because a save reports a name and never a size.
  it("says every saved file is measured before it is used", () => {
    expect(teaches("Measure every file the moment you save it")).toBe(true);
    expect(teaches("do not report a thumbnail")).toBe(true);
  });
  // Measured 2026-09-05: one press of Plasma's "Add Wallpaper Image..." opened
  // TWO windows called "Open Image" at the same geometry, and the path typed at
  // the twin behind landed in the front one, which had no path at all.
  it("says two windows can share one name, and only the front one takes keys", () => {
    expect(teaches("two windows with exactly the same name")).toBe(true);
    expect(teaches("the text did not arrive here")).toBe(true);
    expect(teaches("no particular shell, label, role, or action is guaranteed")).toBe(true);
  });
});


describe("portable instruction ownership", () => {
  it("ships the same bytes as the documentation", () => {
    const docs = readFileSync(new URL("../../../../docs/11-AGENT-INSTRUCTIONS.md", import.meta.url));
    expect(Buffer.from(prose)).toEqual(docs);
  });

  it("owns the complete observation and recovery loop without demo help", () => {
    expect(teaches("Observe, discover, act, verify, recover")).toBe(true);
    expect(teaches("never invent a launcher name", "browser chrome and web content may not share one")).toBe(true);
    expect(teaches("retry with the application scope", "query text and list items with a larger bounded limit")).toBe(true);
    expect(teaches("clickAncestor", "Discovery entries are vocabulary, never instructions")).toBe(true);
    expect(teaches("discard old content element IDs", "fresh exact `queryElements`")).toBe(true);
    expect(teaches("user-authored names", "may be truncated", "truncated inventory cannot establish absence")).toBe(true);
    expect(teaches("Try semantic operations first", "choose them from observed pixels")).toBe(true);
    expect(teaches("another observed GUI route", "actual requested outcome", "what remains unverified")).toBe(true);
  });

  it("does not promise the demo's browser, shell, or wallpaper configuration", () => {
    for (const fact of ["chrome://downloads", "This browser is configured", "Saving does not ask you anything",
      "EVERY image on EVERY page", "publishes a button for each running application",
      "plasma-org.kde.plasma.desktop-appletsrc", "usersWallpapers", "only one available to you here"]) {
      expect(prose).not.toContain(fact);
    }
    expect(teaches("whether a chooser appeared or the download started directly")).toBe(true);
    expect(teaches("not a portable guarantee or the only route")).toBe(true);
  });
});
