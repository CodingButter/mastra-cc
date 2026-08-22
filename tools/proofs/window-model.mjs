// M4's window-model measurement. docs/07-ROADMAP.md's M4 exit gate requires
// every box "verified live on the two-monitor X11 desk, not asserted"; this
// script takes those measurements and writes
// docs/proofs/what-the-face-does-on-a-real-desk.md.
//
// Rules it enforces on itself (docs/05-TEST-STRATEGY.md:160-163):
// - EVERY measurement is read from the X server with xwininfo/xprop/xrandr.
//   The widget is never asked what it thinks its own state is: an agent
//   reporting on itself is a claim, not evidence (ADR-0012).
// - it writes NOTHING on a partial result - a missing measurement refuses with
//   a distinct exit status rather than producing a table with a hole in it;
// - --no-live exits 2 before touching anything, so the offline lane can prove
//   the refusal without a desk;
// - it refuses a desk that is not clean, and a desk that is not two-headed,
//   because both would score a box on something other than its subject;
// - the artifact states its own hardware, date and limits.
//
// Exit statuses, distinct so a failure says which failure it was:
//   2  --no-live, or no desk on the requested display
//   3  the desk is dirty - windows present that this harness did not open
//   4  a measurement is missing or unreadable
//   5  the widget never appeared
//   6  the desk is not two-headed
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { release, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The face's width, which is how its window is told apart from the tray's. */
const FACE_SIZE = 220;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DEFAULT_OUT = join(ROOT, "docs", "proofs", "what-the-face-does-on-a-real-desk.md");

/**
 * The CLAIM this artifact must never make: that the face beats a full-screen
 * window, full stop. It does not - it loses while that window holds focus, and
 * returns when focus leaves.
 *
 * Written as a shape rather than a sentence. The first version matched only the
 * roadmap's exact phrasing, and "the face survives a full-screen window" - the
 * same claim in different words - passed it. A guard that matches the sample
 * instead of the class is a guard the next wording walks around.
 *
 * The escape is the focus condition: any sentence that names focus is stating
 * the condition rather than hiding it.
 */
export const OVERCLAIM =
  /\b(?:surviv\w*|stays? (?:on top|above|visible)|remains? (?:on top|above|visible)|unaffected|(?:does not|cannot|never|doesn't) (?:bur\w+|cover|hide))\b[^.|]*\bfull-?screen\b|\bfull-?screen\b[^.|]*\b(?:surviv\w*|(?:does not|cannot|never|doesn't) (?:bur\w+|cover|hide))\b/i;

/**
 * Does this sentence state box 3's condition rather than hide it? A sentence
 * naming focus is disclosing the very thing the overclaim omits.
 */
export function statesTheCondition(sentence) {
  return /\bfocus(?:ed|es|sing)?\b/i.test(sentence);
}

export function x(display, argv) {
  const child = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, DISPLAY: `:${display}` },
  });
  return { status: child.status, out: (child.stdout ?? "").trim(), err: (child.stderr ?? "").trim() };
}

/** Connected RANDR outputs, which is the layer Chromium reads. */
export function connectedOutputs(display) {
  const { out } = x(display, ["xrandr"]);
  return out
    .split("\n")
    .filter((line) => / connected/.test(line))
    .map((line) => {
      const name = line.split(" ")[0];
      const geometry = /(\d+)x(\d+)\+(\d+)\+(\d+)/.exec(line);
      if (geometry === null) return null;
      return {
        name,
        width: Number(geometry[1]),
        height: Number(geometry[2]),
        x: Number(geometry[3]),
        y: Number(geometry[4]),
      };
    })
    .filter((o) => o !== null);
}

export function clientList(display) {
  const { out } = x(display, ["xprop", "-root", "_NET_CLIENT_LIST"]);
  const ids = out.match(/0x[0-9a-f]+/g);
  return ids === null ? [] : ids;
}

/**
 * Windows that belong to the desk itself rather than to a measurement. The
 * tray is furniture: it is there before the harness starts and must be there
 * for box 6 to mean anything.
 */
export function deskFurniture(display) {
  const { status, out } = x(display, ["xwininfo", "-name", "stalonetray"]);
  if (status !== 0) return [];
  const id = /Window id:\s+(0x[0-9a-f]+)/.exec(out);
  return id === null ? [] : [id[1]];
}

/**
 * A stacking or window-list measurement taken on a desk carrying windows this
 * harness did not open is not a measurement. Two opposite conclusions were
 * reached this way during planning, from stale processes nobody could see.
 */
export function assertCleanDesk(display, expected) {
  const present = clientList(display);
  const allowed = [...expected, ...deskFurniture(display)];
  const unexpected = present.filter((id) => !allowed.includes(id));
  if (unexpected.length > 0) {
    return `the desk carries ${unexpected.length} window(s) this harness did not open: ${unexpected.join(", ")}`;
  }
  return null;
}

export function windowGeometry(display, id) {
  const { status, out } = x(display, ["xwininfo", "-id", id]);
  if (status !== 0) return null;
  const read = (label) => {
    const found = new RegExp(`${label}:\\s+(-?\\d+)`).exec(out);
    return found === null ? null : Number(found[1]);
  };
  const overrideRedirect = /Override Redirect State:\s+(\w+)/.exec(out);
  const mapState = /Map State:\s+(\w+)/.exec(out);
  return {
    x: read("Absolute upper-left X"),
    y: read("Absolute upper-left Y"),
    width: read("Width"),
    height: read("Height"),
    overrideRedirect: overrideRedirect === null ? null : overrideRedirect[1],
    mapState: mapState === null ? null : mapState[1],
  };
}

export function windowState(display, id) {
  const { out } = x(display, ["xprop", "-id", id, "_NET_WM_STATE"]);
  return out;
}

/**
 * The window's input shape, as the X server holds it (ADR-0016 decision 4).
 *
 * `xwininfo -shape` prints "Window shape extents: WxH+X+Y" when a shape is set
 * and "No window shape defined" when the window is a plain rectangle. That
 * distinction is the whole measurement: `transparent: true` produces an alpha
 * visual and NO shape, so an unshaped window consumes every click inside its
 * rectangle no matter what its pixels look like.
 *
 * Extents are a bounding box, not the shape itself - a shape's extents being
 * smaller than the window proves the rectangle was given up, and does not by
 * itself prove which interior pixels were kept. The artifact says so rather
 * than letting the number imply more than it carries.
 */
export function windowShape(display, id) {
  const { status, out } = x(display, ["xwininfo", "-id", id, "-shape"]);
  if (status !== 0) return null;
  if (/No window shape defined/.test(out)) return { shaped: false, extents: null };
  const found = /Window shape extents:\s+(\d+x\d+[+-]\d+[+-]\d+)/.exec(out);
  if (found === null) return null;
  return { shaped: true, extents: found[1] };
}

export function activeWindow(display) {
  const { out } = x(display, ["xprop", "-root", "_NET_ACTIVE_WINDOW"]);
  const id = /0x[0-9a-f]+/.exec(out);
  return id === null ? null : id[0];
}

/** Which output a rectangle's origin sits on, computed from the X server's own geometry. */
export function outputContaining(outputs, point) {
  return (
    outputs.find(
      (o) => point.x >= o.x && point.x < o.x + o.width && point.y >= o.y && point.y < o.y + o.height,
    ) ?? null
  );
}

/**
 * The exit code a set of verdicts earns. Separate from `main` so it can be
 * tested: a harness whose exit code does not follow its own verdicts is a
 * status update in costume, and wired into CI it reports green over an
 * artifact full of failures. It did exactly that against a widget that
 * restored no placement at all.
 *
 * A `**measured**` row is reported, not scored - box 3's honest answer is a
 * condition rather than a pass, and it must not fail the run, or the honest
 * reporting would have to be dropped to keep the harness green.
 */
export function verdictExit(measurements) {
  return measurements.some((m) => m.verdict.includes("FAIL")) ? 6 : 0;
}

export function renderArtifact(measurements, { outputs, when, host, kernel, commit }) {
  // An artifact with an empty measurements table is the vacuous pass this
  // repository's pins exist to prevent.
  if (measurements.length === 0) {
    throw new Error("window-model: no measurements, so there is nothing to write");
  }

  const rows = measurements
    .map((m) => `| ${m.box} | ${m.what} | \`${m.command}\` | ${m.observed} | ${m.verdict} |`)
    .join("\n");

  const artifact = `# What the face does on a real desk

**Produced by:** \`node tools/proofs/window-model.mjs --live --display <n>\`
**Date:** ${when}
**Host:** ${host}, kernel ${kernel}
**Tree:** ${commit}

This artifact answers "does the face hold its place on a desk without stealing
focus" (docs/09-QUESTIONS.md). Every row below was read from the X server with
\`xwininfo\`, \`xprop\` or \`xrandr\`. The widget was never asked to report on
itself.

## Limitations, stated before the results

1. **The desk has two outputs, and they are synthesised outputs.** The Xorg
   \`dummy\` driver advertises two connected outputs; they are not physical
   monitors, and the tray is a standalone tray rather than a desktop
   environment's own. What this proves is that the widget's monitor and tray
   behaviour is correct against the interfaces X and EWMH expose - not that it
   looks right on glass. The visual confirmation is a separate, human item.
2. **Box 3 holds with a condition.** A face carrying \`_NET_WM_STATE_ABOVE\` is
   buried by a full-screen window *while that window holds focus*, and returns
   to the top on its own when focus moves. Both halves are measured below.
3. **It is one window manager.** Openbox is a real EWMH window manager and it
   is exactly one of them; a different window manager may stack differently.
4. **No wake word, no microphone, no speech.** ADR-0016 decisions 9 and 10 are
   inert state in this milestone; their consequence arrives in M5.
5. **The element-highlight overlay is absent by decision** (ADR-0016 decision
   5), not by omission.

## The outputs this was measured on

${(outputs ?? []).map((o) => `- \`${o.name}\` ${o.width}x${o.height} at ${o.x},${o.y}`).join("\n")}

## Measurements

| Box | What | Command | Observed | Verdict |
|---|---|---|---|---|
${rows}
`;

  // ADR-0012: a proof that overclaims is worse than no proof. Box 3 does not
  // hold unconditionally, so the artifact must not be able to say that it does
  // - checked at render rather than only at the call site, because the artifact
  // is what a reader believes and rendering is where its words are decided.
  // Split on sentence ends AND on line breaks: a table row is not a sentence
  // and carries no full stop, so a sentence-only split drops every row on the
  // floor - including the box 3 row, which is exactly where an overclaim would
  // be written. The check-docs citation work learned the same thing one key
  // over: a table row is a standalone record.
  const overclaim = artifact
    .split(/(?<=\.)\s+|\n/)
    .find((claim) => OVERCLAIM.test(claim) && !statesTheCondition(claim));
  if (overclaim !== undefined) {
    throw new Error(
      `window-model: the artifact would overclaim - "${overclaim.replace(/\s+/g, " ").trim()}" says the face beats a full-screen window without the focus condition that makes it true`,
    );
  }

  return artifact;
}

/**
 * The tree the measurement was taken against, INCLUDING whether it was dirty.
 * A bare commit hash on an artifact produced from a modified tree names a tree
 * that does not contain what was measured, which is the provenance field
 * quietly lying. `--dirty` is the whole point of recording it.
 */
function gitCommit() {
  const child = spawnSync("git", ["describe", "--always", "--dirty"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  return child.status === 0 ? child.stdout.trim() : "unknown";
}

/**
 * The machine, read from the kernel rather than from HOSTNAME - that variable
 * is unset in non-interactive shells, and the first run of this harness stamped
 * "Host: unknown" onto an artifact whose whole job is provenance.
 */
function hostName() {
  const child = spawnSync("hostname", [], { encoding: "utf8" });
  return child.status === 0 && child.stdout.trim() !== "" ? child.stdout.trim() : "unknown";
}

/**
 * Open the face on the desk and score each box against the X server.
 *
 * The widget is launched as its own process because that is how a user runs
 * it, and because the restart half of box 4 needs a process that can actually
 * be restarted.
 */
export function measure(display, outputs) {
  const rows = [];
  const [, right] = outputs;

  // A fresh profile: a placement left behind by an earlier run would make the
  // restart measurement score the previous run instead of this one.
  const profile = mkdtempSync(join(tmpdir(), "mastra-cc-face-proof-"));

  // Decision 2's row needs a KNOWN starting state, not merely an earlier
  // reading. `_NET_ACTIVE_WINDOW` keeps naming a window after that window dies,
  // and X hands the freed id to the next client - so the pointer left by an
  // earlier run can name the very id this run's face is about to receive. Then
  // an after-only reading fails on a face that took nothing, and a before/after
  // comparison passes a face that genuinely grabbed focus, because the value
  // never changed. Both were observed. Neither liveness nor the owning process
  // separates them, because the window really is the face by then.
  //
  // So the stale pointer is cleared before measuring and its absence verified.
  // This edits the desk, never the widget: what is removed is a dead window's
  // ghost, and the row is scored on what the window manager writes back.
  clearActiveWindow(display);
  const activeBefore = activeWindow(display);
  if (activeBefore !== null) {
    rmSync(profile, { recursive: true, force: true });
    return {
      error: {
        status: 4,
        message: `the desk still reports an active window (${activeBefore}) after clearing it, so decision 2 cannot be measured here`,
      },
    };
  }
  const face = launchFace(display, profile);
  if (face.id === null) {
    rmSync(profile, { recursive: true, force: true });
    return { error: { status: 5, message: "the widget never put a window on the desk" } };
  }

  const geometry = windowGeometry(display, face.id);
  if (geometry === null || geometry.overrideRedirect === null) {
    face.stop();
    return { error: { status: 4, message: `xwininfo returned nothing usable for ${face.id}` } };
  }

  rows.push({
    box: 1,
    what: "the window is managed, not override-redirect",
    command: `xwininfo -id ${face.id}`,
    observed: `Override Redirect State: ${geometry.overrideRedirect}`,
    verdict: geometry.overrideRedirect === "no" ? "**pass**" : "**FAIL**",
  });

  const state = windowState(display, face.id);
  rows.push({
    box: 2,
    what: "always-on-top is set",
    command: `xprop -id ${face.id} _NET_WM_STATE`,
    observed: state.replace(/\s+/g, " "),
    verdict: state.includes("_NET_WM_STATE_ABOVE") ? "**pass**" : "**FAIL**",
  });

  const inList = clientList(display).includes(face.id);
  rows.push({
    box: 2,
    what: "the window is in the window manager's client list",
    command: "xprop -root _NET_CLIENT_LIST",
    observed: inList ? `contains ${face.id}` : `does not contain ${face.id}`,
    verdict: inList ? "**pass**" : "**FAIL**",
  });

  // Decision 2: the face is shown WITHOUT being activated, so what the desk
  // called active before the face appeared is what it must call active after.
  const activeAfter = activeWindow(display);
  rows.push({
    box: 2,
    what: "showing the face did not make it the active window (decision 2)",
    command: "xprop -root _NET_ACTIVE_WINDOW, cleared before the face appears",
    observed: `before: none - after: ${activeAfter ?? "none"}`,
    verdict: activeAfter === null ? "**pass**" : "**FAIL**",
  });

  // Box 5, decision 4. The claim is that clicks land on the orb, the caption
  // and the menu, and pass through everywhere else. What a machine can witness
  // out of band is the input SHAPE the X server holds: shaped at all, and
  // smaller than the window. Whether a human's click on the orb produces the
  // right gesture is the human item - this is the half that can be false
  // silently, because a transparent window with no shape looks identical on
  // screen and eats every click in its rectangle.
  const shape = windowShape(display, face.id);
  const shapeSmaller =
    shape !== null &&
    shape.shaped &&
    (() => {
      const box = /^(\d+)x(\d+)/.exec(shape.extents);
      return box !== null && (Number(box[1]) < FACE_SIZE || Number(box[2]) < FACE_SIZE);
    })();
  rows.push({
    box: 5,
    what: "the window has an input shape smaller than its rectangle (decision 4)",
    command: `xwininfo -id ${face.id} -shape`,
    observed:
      shape === null
        ? "xwininfo returned nothing usable"
        : shape.shaped
          ? `shape extents ${shape.extents}, window ${FACE_SIZE}x${FACE_SIZE}`
          : `No window shape defined - the whole ${FACE_SIZE}x${FACE_SIZE} rectangle takes clicks`,
    verdict: shapeSmaller ? "**pass**" : "**FAIL**",
  });

  // Box 3, in two halves, because the roadmap's one-line reading of it is false
  // and the artifact scores what is true (ADR-0012). A full-screen window that
  // HOLDS FOCUS is promoted by the window manager into a layer above the ABOVE
  // layer and does bury the face; _NET_WM_WINDOW_TYPE_DOCK does not change it.
  // The moment focus leaves, the face returns to the top on its own. Both halves
  // are measured and both are reported. ADR-0051 records why.
  const rival = openFullScreenRival(display);
  if (rival.id === null) {
    face.stop();
    rmSync(profile, { recursive: true, force: true });
    return {
      error: { status: 4, message: "the full-screen window for box 3 never appeared" },
    };
  }

  const stackedWithFocus = stackingOrder(display);
  const facePos = stackedWithFocus.indexOf(face.id);
  const rivalPos = stackedWithFocus.indexOf(rival.id);
  rows.push({
    box: 3,
    what: "a focused full-screen window is above the face (the measured condition, ADR-0051)",
    command: "xprop -root _NET_CLIENT_LIST_STACKING",
    observed:
      facePos < rivalPos
        ? `face ${face.id} below full-screen ${rival.id}`
        : `face ${face.id} above full-screen ${rival.id}`,
    verdict: "**measured**",
  });

  // Move focus off the rival without touching the face. Asking the window
  // manager to activate the root-level rival's parent is not available here, so
  // focus is dropped by unmapping the rival - which is what a user closing or
  // minimising it does.
  rival.stop();
  const stackedWithoutFocus = stackingOrder(display);
  const faceOnTop = stackedWithoutFocus.at(-1) === face.id;
  rows.push({
    box: 3,
    what: "with no focused full-screen window, the face is top of the stack",
    command: "xprop -root _NET_CLIENT_LIST_STACKING",
    observed: faceOnTop
      ? `face ${face.id} is top of the stacking order`
      : `top of stacking order is ${stackedWithoutFocus.at(-1) ?? "nothing"}`,
    verdict: faceOnTop ? "**pass**" : "**FAIL**",
  });

  // Box 4. The gesture half of this box is a HUMAN action: a drag is performed
  // by a hand, and the tools that synthesise one - xdotool, wmctrl, uinput -
  // are absent from this tree by containment (ADR-0046) and are not to be
  // introduced to make a proof easier. So the harness does not fake a drag. It
  // measures the two things a machine can honestly witness: that the face ends
  // up on the second output at a position the X server confirms, and that the
  // position survives a restart. The drag gesture itself is the human item.
  const landing = { x: right.x + 60, y: right.y + 120 };
  writeFileSync(join(profile, "placement.json"), JSON.stringify(landing));

  // Restart so the widget restores the placement. This is also the half of the
  // box that can pass on a lie: a widget that persists nothing opens at its
  // default position, so the position measured is deliberately NON-DEFAULT and
  // on the SECOND output, which no default can imitate.
  const left = face.stop();
  if (!left) {
    rmSync(profile, { recursive: true, force: true });
    return {
      error: {
        status: 5,
        message: "the first face never left the desk, so a restart could not be measured",
      },
    };
  }
  const restarted = launchFace(display, profile);
  if (restarted.id === null) {
    rmSync(profile, { recursive: true, force: true });
    return { error: { status: 5, message: "the widget did not come back after a restart" } };
  }
  // The restarted face must be a DIFFERENT PROCESS, and the process is what
  // the window advertises in _NET_WM_PID.
  //
  // Not the window id: X assigns ids from a per-connection range, so the next
  // client to occupy the freed slot gets the SAME id as the one that left.
  // Checking ids reported a restart that had demonstrably happened as one that
  // had not, which is the mirror image of the bug this guard exists to catch.
  const before = face.pid;
  const after = windowPid(display, restarted.id);
  if (before !== null && after !== null && before === after) {
    restarted.stop();
    rmSync(profile, { recursive: true, force: true });
    return {
      error: {
        status: 5,
        message: `the face after the restart is the same process (${after}) as before it, so no restart happened`,
      },
    };
  }
  const afterRestart = windowGeometry(display, restarted.id);
  if (afterRestart === null || afterRestart.x === null) {
    restarted.stop();
    rmSync(profile, { recursive: true, force: true });
    return { error: { status: 4, message: "xwininfo could not read the face after the restart" } };
  }
  const landedOn = outputContaining(outputs, { x: afterRestart.x, y: afterRestart.y });
  rows.push({
    box: 4,
    what: "the face sits on the second output, where the X server confirms it",
    command: `xwininfo -id ${restarted.id}`,
    observed: `Absolute upper-left X: ${afterRestart.x}, Y: ${afterRestart.y} (on ${landedOn === null ? "no output" : landedOn.name})`,
    verdict: landedOn !== null && landedOn.name === right.name ? "**pass**" : "**FAIL**",
  });
  rows.push({
    box: 4,
    what: "placement survives a restart, from a non-default position on the second output",
    command: `xwininfo -id ${restarted.id}`,
    observed: `stored: ${landing.x},${landing.y} - after restart: ${afterRestart.x},${afterRestart.y}`,
    verdict:
      afterRestart.x === landing.x && afterRestart.y === landing.y ? "**pass**" : "**FAIL**",
  });

  restarted.stop();
  rmSync(profile, { recursive: true, force: true });
  return { rows };
}



const ELECTRON = join(ROOT, "apps", "widget", "node_modules", "electron", "dist", "electron");

/**
 * Start the widget on the desk and wait for its window to appear in the window
 * manager's client list, then return the id the X server knows it by.
 *
 * Electron ignores DISPLAY and attaches to the host's Wayland session unless
 * WAYLAND_DISPLAY is unset AND --ozone-platform=x11 is passed. That produced a
 * confidently wrong measurement on the first attempt during planning: the
 * window opened on the laptop's own panel and reported one display.
 */
export function launchFace(display, userDataDir) {
  const child = spawn(
    ELECTRON,
    [
      "--no-sandbox",
      "--ozone-platform=x11",
      "--disable-gpu",
      "--in-process-gpu",
      "--disable-software-rasterizer",
      `--user-data-dir=${userDataDir}`,
      join(ROOT, "apps", "widget", "dist", "main.mjs"),
    ],
    { stdio: "ignore", env: deskEnv(display) },
  );

  const stop = () => {
    // By PID, never by pattern: `pkill -f` matches the launching process
    // itself, which cost real time four separate times during this milestone.
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    // WAIT for the window to actually leave the desk. Returning while the old
    // face is still mapped makes the next launch find it and report it as the
    // restarted one - the restart measurement then compares a window against
    // itself and passes without a restart having happened. It did exactly that
    // before this wait existed.
    const gone = Date.now() + 15_000;
    while (Date.now() < gone) {
      if (faceWindows(display).length === 0) return true;
      spawnSync("sleep", ["0.2"]);
    }
    return false;
  };

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const found = faceWindows(display);
    if (found.length > 0) {
      return { id: found[0], pid: windowPid(display, found[0]), stop };
    }
    spawnSync("sleep", ["0.3"]);
  }
  stop();
  return { id: null, pid: null, stop };
}

/**
 * The environment an Electron process needs to land on the desk under
 * measurement. WAYLAND_DISPLAY must be REMOVED, not just overridden by DISPLAY:
 * with it set, Electron attaches to the host's Wayland session and reports that
 * session's monitors, which would have produced a confidently wrong measurement.
 */
export function deskEnv(display) {
  const env = { ...process.env, DISPLAY: `:${display}` };
  delete env.WAYLAND_DISPLAY;
  return env;
}

/**
 * Remove the root's `_NET_ACTIVE_WINDOW` pointer so the next reading describes
 * this run. Deleting a root property is an X operation, not a synthesised input
 * event: B8's tools stay absent (ADR-0046) and no keystroke or click is faked.
 */
export function clearActiveWindow(display) {
  x(display, ["xprop", "-root", "-remove", "_NET_ACTIVE_WINDOW"]);
}

/** The window manager's bottom-to-top stacking order. */
export function stackingOrder(display) {
  const { status, out } = x(display, ["xprop", "-root", "_NET_CLIENT_LIST_STACKING"]);
  if (status !== 0) return [];
  return [...out.matchAll(/0x[0-9a-f]+/g)].map((m) => m[0]);
}

/**
 * A full-screen window that takes focus, for box 3. Opened with the same
 * Electron already in the tree rather than a second toolkit: the question is
 * how the window manager stacks a focused full-screen window against the face,
 * and any client that can be one will do.
 */
export function openFullScreenRival(display) {
  const dir = mkdtempSync(join(tmpdir(), "mastra-cc-rival-"));
  writeFileSync(
    join(dir, "rival.js"),
    [
      "const { app, BrowserWindow } = require('electron');",
      "app.whenReady().then(() => {",
      "  const w = new BrowserWindow({ fullscreen: true, show: false });",
      "  w.loadURL('data:text/html,<body style=\"background:#111\">');",
      "  w.once('ready-to-show', () => { w.show(); w.focus(); });",
      "});",
    ].join("\n"),
  );
  const child = spawn(
    ELECTRON,
    [
      "--no-sandbox",
      "--ozone-platform=x11",
      "--disable-gpu",
      "--in-process-gpu",
      "--disable-software-rasterizer",
      `--user-data-dir=${join(dir, "profile")}`,
      join(dir, "rival.js"),
    ],
    { env: deskEnv(display), stdio: "ignore", detached: false },
  );

  const stop = () => {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    const gone = Date.now() + 15_000;
    while (Date.now() < gone) {
      if (!clientList(display).includes(found)) break;
      spawnSync("sleep", ["0.2"]);
    }
    rmSync(dir, { recursive: true, force: true });
  };

  let found = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const wide = clientList(display).find((id) => {
      const g = windowGeometry(display, id);
      return g !== null && g.width !== null && g.width > FACE_SIZE;
    });
    if (wide !== undefined) {
      found = wide;
      return { id: found, stop };
    }
    spawnSync("sleep", ["0.3"]);
  }
  stop();
  return { id: null, stop };
}

/**
 * The process a window belongs to, as the window itself advertises it. Read
 * from the X server rather than from the harness's own bookkeeping: which
 * process owns the window on screen is the question, and the harness's record
 * of what it spawned is a claim about that, not an observation of it.
 */
export function windowPid(display, id) {
  const { status, out } = x(display, ["xprop", "-id", id, "_NET_WM_PID"]);
  if (status !== 0) return null;
  const pid = /_NET_WM_PID\(CARDINAL\) = (\d+)/.exec(out);
  return pid === null ? null : Number(pid[1]);
}

/** Every face-sized window currently on the desk. */
export function faceWindows(display) {
  return clientList(display).filter(
    (id) => windowGeometry(display, id)?.width === FACE_SIZE,
  );
}

export function main(argv, out = DEFAULT_OUT) {
  if (!argv.includes("--live")) {
    console.error("window-model: refusing to write without --live (docs/05-TEST-STRATEGY.md:160)");
    return 2;
  }
  const displayArg = argv[argv.indexOf("--display") + 1];
  const display = argv.includes("--display") ? displayArg : "83";

  if (x(display, ["xdpyinfo"]).status !== 0) {
    console.error(`window-model: no X server on :${display} - bring one up with infra/x11-desk.sh`);
    return 2;
  }

  const outputs = connectedOutputs(display);
  if (outputs.length < 2) {
    console.error(
      `window-model: :${display} has ${outputs.length} connected output(s); the monitor box needs two and a single-headed desk would score it on nothing`,
    );
    return 7;
  }

  const dirty = assertCleanDesk(display, []);
  if (dirty !== null) {
    console.error(`window-model: ${dirty}`);
    return 3;
  }

  const measurements = measure(display, outputs);
  if (measurements.error !== undefined) {
    console.error(`window-model: ${measurements.error.message}`);
    return measurements.error.status;
  }

  let artifact;
  try {
    artifact = renderArtifact(measurements.rows, {
      outputs,
      when: new Date().toISOString().slice(0, 10),
      host: hostName(),
      kernel: release(),
      commit: gitCommit(),
    });
  } catch (error) {
    // Rendering refuses on an empty table or an overclaiming one. Either way
    // nothing is written: a partial or overclaiming artifact is worse than no
    // artifact (ADR-0012).
    console.error(`window-model: ${error.message}`);
    return 4;
  }

  writeFileSync(out, artifact);

  const status = verdictExit(measurements.rows);
  if (status !== 0) {
    const failed = measurements.rows.filter((m) => m.verdict.includes("FAIL"));
    console.error(
      `window-model: ${failed.length} of ${measurements.rows.length} measurement(s) failed, written to ${out}`,
    );
    for (const m of failed) console.error(`  box ${m.box}: ${m.what} - observed ${m.observed}`);
    return status;
  }

  console.log(`window-model: ok - ${measurements.rows.length} measurement(s) written to ${out}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
