// Independent visual witness for the live semantic-edit lane.
//
// Issue #56: the only visual corroboration that the written sentence was
// actually PAINTED in Kate's editor was a screenshot produced by ad-hoc,
// uncommitted Playwright steps - it could not be regenerated from a clean
// checkout, so it proved nothing a stranger could re-run. This committed
// witness replaces that screenshot.
//
// It obeys ADR-0012 (proof by artifact):
//   * It reads the answer OUT OF BAND. The element's on-screen rectangle is
//     resolved straight from AT-SPI's Component interface - the same layer the
//     desktop paints from - NOT from the daemon's own report. The daemon's
//     semantic protocol deliberately publishes no pixel geometry, so a pixel
//     claim cannot launder itself through the thing under test.
//   * It refuses to guess. Every failure exits non-zero by name with a
//     distinct code, and nothing is printed unless the pixels back it up.
//   * It captures ONLY the element's extents - not the desktop, not the window
//     frame - so a green result is a statement about the editor and nothing
//     else.
//   * It states its own limit: it proves that non-uniform ink occupies the
//     editor's rectangle after the write, not that the ink spells the exact
//     sentence. Character-exact read-back is the semantic lane's job (already
//     proved in demo.sh); this lane proves the glyphs reached the screen.
//
// It prints "WITNESS: GREEN" as its only success line, mirroring the harness's
// "PROOF: GREEN" lock convention. Any RED line goes to stderr and aborts.
//
// This file is copied into the container by copy_built_artifacts() and driven
// there; it shells a small Python AT-SPI + capture probe because AT-SPI is
// reachable from python3-gi in the image (see 04-a-key-addressed-to-one-element).

import { execFileSync } from "node:child_process";

const application = process.env.MASTRA_CC_WITNESS_APPLICATION ?? "kate";
const documentName = process.env.MASTRA_CC_DOCUMENT_NAME ?? "proof.txt";
const sentence = process.env.MASTRA_CC_PROOF_SENTENCE;
if (!sentence) {
  process.stderr.write("WITNESS: RED - MASTRA_CC_PROOF_SENTENCE is required\n");
  process.exit(2);
}

// The Python probe does the out-of-band work: resolve the editor element by the
// same identity the scenario client uses (role text, the document's name,
// visible + editable), read its screen extents from AT-SPI Component, capture
// exactly that rectangle, and reduce the crop to a verdict about its ink. It
// prints one JSON line on success and exits non-zero by name otherwise.
const probe = `
import gi, json, os, shutil, subprocess, sys, tempfile
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

APPLICATION = os.environ["MASTRA_CC_WITNESS_APPLICATION"]
DOCUMENT = os.environ["MASTRA_CC_DOCUMENT_NAME"]

def red(code, message):
    sys.stderr.write("WITNESS: RED - " + message + "\\n")
    sys.exit(code)

desk = Atspi.get_desktop(0)
apps = [a for a in (desk.get_child_at_index(i) for i in range(desk.get_child_count()))
        if a and a.get_name() == APPLICATION]
if not apps:
    red(3, APPLICATION + " is not on the accessibility bus")
app = apps[0]

def walk(node, depth=0):
    if depth > 16:
        return
    yield node
    try:
        for i in range(node.get_child_count()):
            child = node.get_child_at_index(i)
            if child:
                yield from walk(child, depth + 1)
    except Exception:
        return

def is_editor(node):
    if node.get_role_name() != "text":
        return False
    if node.get_name() != DOCUMENT:
        return False
    states = node.get_state_set()
    return states.contains(Atspi.StateType.VISIBLE) and states.contains(Atspi.StateType.EDITABLE)

editors = [n for n in walk(app) if is_editor(n)]
if not editors:
    red(4, "no visible editable control named " + DOCUMENT + " under " + APPLICATION)
editor = editors[0]

component = editor.get_component_iface()
if component is None:
    red(5, "the editor element publishes no Component interface, so it has no screen rectangle")
extents = Atspi.Component.get_extents(component, Atspi.CoordType.SCREEN)
x, y, w, h = int(extents.x), int(extents.y), int(extents.width), int(extents.height)
if w <= 1 or h <= 1:
    red(6, "the editor's on-screen rectangle is degenerate: " + repr((x, y, w, h)))

crop = tempfile.mktemp(suffix=".png")
# Capture ONLY the element's rectangle. Prefer ImageMagick's import; fall back to
# xwd piped through convert. Refuse (do not guess) if neither backend exists.
if shutil.which("import"):
    subprocess.run(["import", "-window", "root", "-crop",
                    "%dx%d+%d+%d" % (w, h, x, y), "+repage", crop],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    backend = "import"
elif shutil.which("xwd") and shutil.which("convert"):
    dump = tempfile.mktemp(suffix=".xwd")
    subprocess.run(["xwd", "-root", "-silent", "-out", dump], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["convert", dump, "-crop",
                    "%dx%d+%d+%d" % (w, h, x, y), "+repage", crop],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    backend = "xwd+convert"
else:
    red(7, "no screen-capture backend (import, or xwd+convert) is installed in the image")

try:
    from PIL import Image
except Exception:
    red(8, "python3 Pillow (PIL) is not installed, so the crop's ink cannot be measured")

image = Image.open(crop).convert("L")
if image.size != (w, h):
    # A mismatch means the crop is not the element's rectangle; a pass now would
    # be a statement about some other region of the screen.
    red(9, "the captured crop " + repr(image.size) + " is not the element rectangle " + repr((w, h)))

pixels = list(image.getdata())
if not pixels:
    red(10, "the captured crop carries no pixels")
low, high = min(pixels), max(pixels)
distinct = len(set(pixels))
# Blank or single-fill editors (all background, or a solid rectangle) carry one
# tone and a near-zero spread; painted text drives both the spread and the
# distinct-tone count up. These thresholds reject an empty editor while a single
# short sentence clears them comfortably.
spread = high - low
if spread < 24 or distinct < 8:
    red(11, "the editor rectangle is blank or uniform (spread=%d distinct=%d): no ink reached the screen" % (spread, distinct))

os.remove(crop)
print(json.dumps({
    "witness": "green",
    "application": APPLICATION,
    "document": DOCUMENT,
    "rectangle": {"x": x, "y": y, "width": w, "height": h},
    "backend": backend,
    "ink": {"spread": spread, "distinct": distinct},
}))
`;

try {
  const out = execFileSync("python3", ["-c", probe], {
    env: {
      ...process.env,
      MASTRA_CC_WITNESS_APPLICATION: application,
      MASTRA_CC_DOCUMENT_NAME: documentName,
    },
    encoding: "utf8",
  });
  process.stdout.write(out);
  process.stdout.write("WITNESS: GREEN\n");
} catch (error) {
  // The Python probe already wrote a named RED line to stderr and chose the
  // exit code; surface it verbatim and inherit the code so the harness aborts.
  if (error.stderr) process.stderr.write(error.stderr);
  process.exit(typeof error.status === "number" ? error.status : 1);
}
