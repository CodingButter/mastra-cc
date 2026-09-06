import { describe, expect, it } from "vitest";
import { desktopPlaces } from "../server.js";

// A PATH A CALLER INVENTED IS A FAILURE IT CANNOT DIAGNOSE.
//
// Measured on a live desk, 2026-09-05: an errand saved a file, then opened
// `file:///home/user/Downloads/...` on a desktop whose home is `/config`. The
// browser said the file was not there, and the errand reported the DOWNLOAD as
// broken - the one conclusion the transcript could not distinguish from a wrong
// path. Nothing in the contract had ever told it where this desk keeps files,
// so it used the home directory of the machine it was trained on.
//
// This verb answers that, and the discipline it is held to is the whole point:
// it PUBLISHES paths, it does not reason its way to them. A field this daemon
// computed would be the same guess, wearing an answer's clothes - so the tests
// below are mostly about what it declines to say.

const nothingRead = () => undefined;
const everythingExists = () => true;

describe("where a desk keeps its own files", () => {
  it("says the home the environment publishes", () => {
    const places = desktopPlaces({ HOME: "/config" }, nothingRead, everythingExists);
    expect(places.home).toBe("/config");
  });

  it("says nothing at all when the environment publishes no home", () => {
    // Not a default, not an empty string: a caller that receives no home goes
    // and reads a file dialog, which is right. One that receives `/root` or
    // `/home/user` believes it.
    expect(desktopPlaces({}, nothingRead, everythingExists)).toEqual({});
    expect(desktopPlaces({ HOME: "" }, nothingRead, everythingExists)).toEqual({});
  });

  it("prefers the folder the desktop itself names over the usual place", () => {
    const places = desktopPlaces(
      { HOME: "/config" },
      (path) => (path === "/config/.config/user-dirs.dirs" ? 'XDG_DOWNLOAD_DIR="$HOME/Saved"\n' : undefined),
      everythingExists,
    );
    // `$HOME` is expanded because the XDG file writes it that way; a caller
    // handed a literal dollar sign would be no better off than guessing.
    expect(places.downloads).toBe("/config/Saved");
  });

  it("takes the environment's own answer ahead of the file", () => {
    const places = desktopPlaces(
      { HOME: "/config", XDG_DOWNLOAD_DIR: "/config/Inbox" },
      () => 'XDG_DOWNLOAD_DIR="$HOME/Saved"\n',
      everythingExists,
    );
    expect(places.downloads).toBe("/config/Inbox");
  });

  it("falls back to the usual place only when that folder is really there", () => {
    const seen = desktopPlaces({ HOME: "/config" }, nothingRead, (path) => path === "/config/Downloads");
    expect(seen.downloads).toBe("/config/Downloads");

    // Same desk, same reasoning, no such folder: the field is dropped rather
    // than asserted. This is the line between an observation and a derivation.
    const unseen = desktopPlaces({ HOME: "/config" }, nothingRead, () => false);
    expect(unseen).toEqual({ home: "/config" });
  });

  it("does not read a home out of the download folder, or the other way round", () => {
    const places = desktopPlaces(
      { HOME: "/config", XDG_DOWNLOAD_DIR: "/mnt/bulk/incoming" },
      nothingRead,
      everythingExists,
    );
    // A desk is free to put downloads on another volume entirely, and a caller
    // that derived one path from the other would land on neither.
    expect(places).toEqual({ home: "/config", downloads: "/mnt/bulk/incoming" });
  });
});
