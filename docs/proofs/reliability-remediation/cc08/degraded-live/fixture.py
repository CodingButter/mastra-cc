#!/usr/bin/env python3
"""A GTK3 application whose one text view moves between parents on command.

Two toplevels. "Home" holds two frames, Left and Right; "Annex" is a separate
window. The text view named "doc" starts in Left. Commands arrive one per line
on a named pipe (argv[1]) and move it - the daemon's watch on the Left frame is
what the proof observes while the view travels:

  right          Left -> Right   (same window, outside the watched subtree)
  left           back into Left
  annex          into the Annex window (another root)
  destroy-annex  destroy Annex with the view inside it (root removal)
  quit

This is a fixture, not an editor: it exists so that "reparenting" in the CC-08
proof means a real GTK container move seen over the real accessibility bus.
"""
import os
import sys

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk  # noqa: E402


class Fixture:
    def __init__(self, pipe_path: str):
        self.home = Gtk.Window(title="Reparent Home")
        self.home.set_default_size(700, 300)
        self.home.get_accessible().set_name("Reparent Home")
        box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, homogeneous=True)
        self.home.add(box)
        self.left = Gtk.Frame(label="Left")
        self.left.get_accessible().set_name("Left")
        self.right = Gtk.Frame(label="Right")
        self.right.get_accessible().set_name("Right")
        box.pack_start(self.left, True, True, 0)
        box.pack_start(self.right, True, True, 0)

        self.annex = Gtk.Window(title="Reparent Annex")
        self.annex.set_default_size(400, 300)
        self.annex.get_accessible().set_name("Reparent Annex")
        self.annex_frame = Gtk.Frame(label="Annex")
        self.annex_frame.get_accessible().set_name("Annex")
        self.annex.add(self.annex_frame)

        self.view = Gtk.TextView()
        self.view.get_accessible().set_name("doc")
        self.view.get_buffer().set_text("start")
        self.left.add(self.view)
        self.parent = self.left
        self.pokes = 0

        self.home.connect("destroy", Gtk.main_quit)
        self.home.show_all()
        self.annex.show_all()

        self.pipe = os.open(pipe_path, os.O_RDONLY | os.O_NONBLOCK)
        self.buffer = b""
        GLib.io_add_watch(self.pipe, GLib.IO_IN | GLib.IO_HUP, self.on_pipe)
        self.say("ready")

    def say(self, line: str) -> None:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()

    def move(self, target: Gtk.Container, label: str) -> None:
        if self.parent is target:
            self.say(f"already {label}")
            return
        # self.view is a Python reference; it survives the gap between remove and add.
        self.parent.remove(self.view)
        target.add(self.view)
        self.parent = target
        target.show_all()
        self.say(f"moved {label}")

    def on_pipe(self, fd, condition):
        if condition & GLib.IO_IN:
            try:
                chunk = os.read(fd, 4096)
            except BlockingIOError:
                return True
            self.buffer += chunk
            while b"\n" in self.buffer:
                line, self.buffer = self.buffer.split(b"\n", 1)
                self.command(line.decode().strip())
        if condition & GLib.IO_HUP:
            # Writer closed; reopen so the next writer is heard.
            os.close(fd)
            self.pipe = os.open(sys.argv[1], os.O_RDONLY | os.O_NONBLOCK)
            GLib.io_add_watch(self.pipe, GLib.IO_IN | GLib.IO_HUP, self.on_pipe)
            return False
        return True

    def command(self, line: str) -> None:
        if line == "right":
            self.move(self.right, "right")
        elif line == "left":
            self.move(self.left, "left")
        elif line == "annex":
            self.move(self.annex_frame, "annex")
        elif line == "rebuild":
            # The annex took the original view with it. A fresh one, inside
            # Left, so the degraded-ancestry half starts from a known-good watch.
            self.view = Gtk.TextView()
            self.view.get_accessible().set_name("doc")
            self.view.get_buffer().set_text("rebuilt")
            self.left.add(self.view)
            self.parent = self.left
            self.left.show_all()
            self.say("rebuilt view")
        elif line == "orphan":
            # The unknown-ancestry case, INDUCED rather than simulated: remove
            # the view from its parent but keep a Python reference, so the
            # widget stays alive and addressable on the bus with no parent to
            # climb to. Nothing is destroyed, so no defunct is announced - the
            # daemon simply cannot place the element it is being told about.
            self.parent.remove(self.view)
            self.parent = None
            self.say("orphaned view")
        elif line == "poke":
            # A real change event from an element whose ancestry cannot be read.
            self.view.get_buffer().set_text(f"poke-{self.pokes}")
            self.pokes += 1
            self.say("poked view")
        elif line == "destroy-annex":
            # Root removal means the view goes with its window. Dropping this
            # side's reference first is what lets GTK finalize the widget;
            # holding it would leave a live, parentless view - which the first
            # run of this proof measured as "two changed, watch still alive",
            # and which is a fixture artifact, not a daemon verdict.
            self.view = None
            self.parent = None
            self.annex.destroy()
            self.say("destroyed annex")
        elif line == "quit":
            Gtk.main_quit()
        elif line:
            self.say(f"unknown {line}")


if __name__ == "__main__":
    GLib.set_prgname("reparent-fixture")
    GLib.set_application_name("reparent-fixture")
    Fixture(sys.argv[1])
    Gtk.main()
