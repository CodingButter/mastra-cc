#!/usr/bin/env python3
"""Throwaway. Which condition makes a browser readable through AT-SPI?

Python rather than Node deliberately: walking the accessibility tree needs
AT-SPI bindings, and whether Node can reach AT-SPI at all is Phase 2's open
question. Writing this in Node would make Phase 1 depend on Phase 2's unknown.

One condition per run. The operator arranges the condition; this script sets
nothing up, enables no screen reader, and writes to no profile but its own.

Conditions
  baseline            Chrome running normally, launched by this script
  force-flag          Chrome launched with --force-renderer-accessibility
  assistive-attached  an AT client is connected and walking the tree
                      (this script IS that client, so the condition is the
                      baseline condition plus the walk itself)

Each run appends a row. A run that cannot complete its walk writes nothing.

Usage: a11y-conditions.py --condition baseline [--artifact PATH]
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CHROME = "/opt/google/chrome/chrome"
ARTIFACT = "docs/proofs/which-condition-makes-a-browser-readable.md"
# Roles that only exist if the renderer's own tree is exposed. A frame and an
# application object appear regardless; these do not.
WEB_CONTENT_ROLES = {"document web", "document frame", "link", "entry", "heading", "push button",
                     "list item", "paragraph", "section"}
MAX_NODES = 4000
MAX_DEPTH = 25


def bus_reachable() -> bool:
    """Ask the session bus for the a11y bus address.

    Never call Atspi.get_desktop(0) to find out: with no accessibility bus it
    does not raise, it calls abort() and takes the interpreter down with it
    (exit 133). That is why every walk below runs in a subprocess.
    """
    try:
        out = subprocess.run(
            ["gdbus", "call", "--session", "--dest", "org.a11y.Bus",
             "--object-path", "/org/a11y/bus", "--method", "org.a11y.Bus.GetAddress"],
            capture_output=True, timeout=5, text=True,
        )
        return out.returncode == 0
    except Exception:
        return False


def a11y_status() -> dict:
    """org.a11y.Status properties, read without touching them."""
    result = {}
    for prop in ("IsEnabled", "ScreenReaderEnabled"):
        try:
            out = subprocess.run(
                ["gdbus", "call", "--session", "--dest", "org.a11y.Bus",
                 "--object-path", "/org/a11y/bus", "--method",
                 "org.freedesktop.DBus.Properties.Get", "org.a11y.Status", prop],
                capture_output=True, timeout=5, text=True,
            )
            result[prop] = "true" in out.stdout.lower() if out.returncode == 0 else "unreadable"
        except Exception:
            result[prop] = "unreadable"
    return result


WALKER = r"""
import sys, json
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

MAX_NODES, MAX_DEPTH = %d, %d
target_pid = int(sys.argv[1])

desktop = Atspi.get_desktop(0)
apps = []
for i in range(desktop.get_child_count()):
    try:
        app = desktop.get_child_at_index(i)
        if app is None:
            continue
        name = app.get_name() or ""
        apps.append(name)
    except Exception:
        continue

def pid_of(app):
    try:
        return Atspi.Accessible.get_process_id(app)
    except Exception:
        return None


nodes, roles = 0, {}
def walk(node, depth):
    global nodes
    if nodes >= MAX_NODES or depth > MAX_DEPTH:
        return
    nodes += 1
    try:
        r = node.get_role_name() or "?"
    except Exception:
        r = "?"
    roles[r] = roles.get(r, 0) + 1
    try:
        count = node.get_child_count()
    except Exception:
        return
    for i in range(min(count, 200)):
        try:
            child = node.get_child_at_index(i)
        except Exception:
            continue
        if child is not None:
            walk(child, depth + 1)

# Scope the walk to the browser THIS RUN launched, by process id. Matching on
# the application name instead would silently fold in any other Chrome the
# operator happens to have open, and a row measured against somebody else's
# browser is worse than no row: it would look exactly like a real result.
matched = []
for i in range(desktop.get_child_count()):
    try:
        app = desktop.get_child_at_index(i)
        if app is None:
            continue
        if pid_of(app) != target_pid:
            continue
        matched.append(app.get_name() or "")
        walk(app, 0)
    except Exception:
        continue

print(json.dumps({"desktopChildren": desktop.get_child_count(),
                  "apps": apps, "chromeApps": matched,
                  "nodes": nodes, "roles": roles}))
""" % (MAX_NODES, MAX_DEPTH)


def walk_tree(pid: int) -> dict | None:
    """Run the walk in a subprocess, so an abort is data rather than a lost run."""
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(WALKER)
        script = f.name
    try:
        proc = subprocess.run([sys.executable, script, str(pid)],
                              capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            print(f"  walk subprocess exited {proc.returncode}: {proc.stderr.strip()[:300]}",
                  file=sys.stderr)
            return None
        import json
        return json.loads(proc.stdout)
    except Exception as e:
        print(f"  walk failed: {e}", file=sys.stderr)
        return None
    finally:
        os.unlink(script)


HOLDER = r"""
import gi, time
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi
# Connect as an assistive client and STAY connected, registering an event
# listener so this is a real subscriber rather than a process that once looked.
d = Atspi.get_desktop(0)
def noop(e):
    pass
listener = Atspi.EventListener.new(noop)
for ev in ("object:state-changed:focused", "object:children-changed"):
    listener.register(ev)
print("holding", d.get_child_count(), flush=True)
time.sleep(600)
"""


def start_at_client() -> subprocess.Popen | None:
    """An assistive client that connects BEFORE the browser launches and stays.

    This is the honest version of the third condition. It does NOT touch
    org.a11y.Status: writing that property is a system-wide change the plan
    forbids, and ScreenReaderEnabled additionally starts a screen reader
    speaking on the operator's desktop.
    """
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(HOLDER)
        script = f.name
    proc = subprocess.Popen([sys.executable, script],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    # wait for it to announce that it is connected
    deadline = time.time() + 20
    while time.time() < deadline:
        if proc.poll() is not None:
            return None
        line = proc.stdout.readline()
        if line.startswith("holding"):
            return proc
    proc.terminate()
    return None


def launch_chrome(force_flag: bool, profile: Path) -> subprocess.Popen:
    args = [CHROME, f"--user-data-dir={profile}", "--no-first-run",
            "--no-default-browser-check", "about:blank"]
    if force_flag:
        args.insert(1, "--force-renderer-accessibility")
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--condition", required=True,
                    choices=["baseline", "force-flag", "assistive-attached"])
    ap.add_argument("--artifact", default=ARTIFACT)
    ap.add_argument("--settle", type=float, default=6.0)
    args = ap.parse_args()

    if not Path(CHROME).exists():
        print(f"REFUSED: no chrome at {CHROME}", file=sys.stderr)
        return 1
    if not bus_reachable():
        print("REFUSED: no accessibility bus on this session; the condition cannot be arranged",
              file=sys.stderr)
        return 1

    holder = None
    if args.condition == "assistive-attached":
        holder = start_at_client()
        if holder is None:
            print("REFUSED: could not hold an assistive client connection open; "
                  "the condition was not arranged", file=sys.stderr)
            return 1
        time.sleep(2)

    before = a11y_status()
    profile = Path(tempfile.mkdtemp(prefix="spike-a11y-"))
    proc = launch_chrome(args.condition == "force-flag", profile)
    try:
        time.sleep(args.settle)
        if proc.poll() is not None:
            print(f"REFUSED: chrome exited immediately ({proc.returncode})", file=sys.stderr)
            return 1
        walked = walk_tree(proc.pid)
        after = a11y_status()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)
        if holder is not None:
            holder.terminate()

    if walked is None:
        print("REFUSED: the tree walk did not complete, so this run has nothing to report",
              file=sys.stderr)
        return 1
    if not walked["chromeApps"]:
        print(f"REFUSED: the browser this run launched (pid {proc.pid}) was not present on the "
              f"accessibility desktop ({walked['desktopChildren']} children); the condition was "
              f"not arranged. Nothing written.", file=sys.stderr)
        return 1

    web = {r: c for r, c in walked["roles"].items() if r in WEB_CONTENT_ROLES}
    row = (f"| `{args.condition}` "
           f"| {before['IsEnabled']} / {after['IsEnabled']} "
           f"| {before['ScreenReaderEnabled']} / {after['ScreenReaderEnabled']} "
           f"| {walked['desktopChildren']} "
           f"| {walked['nodes']} "
           f"| **{sum(web.values())}** "
           f"| {', '.join(f'{r}×{c}' for r, c in sorted(web.items())[:4]) or '—'} |")

    path = Path(args.artifact)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(HEADER)
    text = path.read_text()
    if FOOTER_MARK not in text:
        text = text.rstrip() + "\n" + FOOTER

    # Replace an existing row for this condition, or insert into the table —
    # never append to the end of the file, which would drop rows below the
    # prose that explains them.
    pattern = re.compile(rf"^\| `{re.escape(args.condition)}` .*$", re.M)
    if pattern.search(text):
        text = pattern.sub(row, text)
    else:
        lines = text.split("\n")
        last_row = max(i for i, l in enumerate(lines) if l.startswith("|"))
        lines.insert(last_row + 1, row)
        text = "\n".join(lines)
    path.write_text(text)

    print(f"  condition={args.condition} nodes={walked['nodes']} "
          f"webContentRoles={sum(web.values())} roles={sorted(walked['roles'])[:8]}",
          file=sys.stderr)
    print(f"Wrote {path}", file=sys.stderr)
    return 0


HEADER = """# Which condition makes a browser readable?

The artifact the prototype specified and never produced. Each row is one run of
`spikes/browser/a11y-conditions.py`, which is deleted at the end of M0.5.

`IsEnabled` and `ScreenReaderEnabled` are shown as **before / after** the run,
so that the question "does connecting an assistive client switch accessibility
on?" is answered by observation rather than by belief.

A run that cannot complete its walk, or that finds no browser on the
accessibility desktop, writes nothing at all.

| Condition | `IsEnabled` | `ScreenReaderEnabled` | Desktop children | Nodes walked | Web-content roles | Which |
|---|---|---|---|---|---|---|
"""

FOOTER_MARK = "## What the rows mean"
FOOTER = """
## What the rows mean

"Web-content roles" counts nodes whose role only exists if the renderer's own
tree is exposed — documents, links, entries, headings, paragraphs. A browser
window always publishes a frame and an application object, so a non-zero node
count is not evidence of readability. This column is.

## What the `assistive-attached` row does and does not test

That row is a real assistive client — it connects to the accessibility bus
before the browser launches, registers event listeners, and stays connected
throughout. It is *not* a screen reader.

What was deliberately **not** tested is the stronger condition: a client that
announces itself by setting `org.a11y.Status`. Reaching it requires either
writing a system-wide property, which this milestone's do-not list forbids, or
starting a screen reader on the operator's desktop, which would begin speaking
aloud. Neither is an acceptable cost for a measurement, so the question is
closed as far as it can honestly be taken here and the remainder is named
rather than guessed: **does a client that sets `org.a11y.Status.IsEnabled`
cause Chromium to build its renderer tree?** Settling it needs a disposable
desktop session, not this one.

The practical answer does not depend on it. The launch flag is measured, it
works, and per amendment A1 the assistant launches the application itself — so
the flag is always available at the moment it is needed.

## The prototype's claim, refuted

`computer-controls/docs/07-open-questions.md:19-22` states that a browser whose
accessibility layer is unreadable is *absent from the accessibility desktop
entirely*. It is not: it is present and empty, on both a Wayland and an X11
session. That is a different problem with a different fix, and the distinction
matters — "absent" suggests waiting for it to appear, "present and empty"
tells you the tree is there and the content is not.
"""


if __name__ == "__main__":
    sys.exit(main())
