#!/usr/bin/env python3
"""Three GTK3 toplevels for the CC-01 live characterization.

  Target  - the window the caller wants: a red canvas with one entry, "field".
  Cover   - a solid blue window placed over Target's entry. It is offset
            from Target rather than coincident with it: on this Xvfb,
            `xwd -root` reads black where two windows have identical
            geometry (ImageMagick and x11grab read the top window), and
            that quirk is not what this proof is about.
  Shell   - a stand-in for the desktop shell's task bar: one button per
            application window ("Target", "Cover"); pressing it present()s
            that window, which is what a real shell's task-bar button does.
            The daemon's own refusal text names this route; under Openbox on
            Xvfb there is no shell, so the fixture publishes the button.

Commands arrive one per line on a named pipe (argv[1]):

  cover        raise Cover over Target's entry again
  move-target  move Target 120 px right (a layout change after preparation)
  quit

This is a fixture, not an application under test: it exists so that
"covered", "raised" and "moved" in the proof mean real X11 windows on a real
accessibility bus, seen only through the daemon.
"""
import os
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GLib, Gtk  # noqa: E402


def solid(widget, r, g, b):
    css = Gtk.CssProvider()
    css.load_from_data(f"* {{ background-color: rgb({r},{g},{b}); }}".encode())
    widget.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)


class Fixture:
    def __init__(self, pipe_path: str):
        self.target = Gtk.Window(title="Target")
        self.target.get_accessible().set_name("Target")
        self.target.set_default_size(400, 200)
        self.target.move(100, 100)
        canvas = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        solid(canvas, 200, 30, 30)
        self.target.add(canvas)
        self.field = Gtk.Entry()
        self.field.get_accessible().set_name("field")
        self.field.set_text("untouched")
        self.field.set_margin_top(60)
        self.field.set_margin_start(40)
        self.field.set_margin_end(40)
        canvas.pack_start(self.field, False, False, 0)

        self.cover = Gtk.Window(title="Cover")
        self.cover.get_accessible().set_name("Cover")
        self.cover.set_default_size(500, 200)
        self.cover.move(60, 140)
        blue = Gtk.Box()
        solid(blue, 30, 30, 200)
        self.cover.add(blue)

        self.shell = Gtk.Window(title="Shell")
        self.shell.get_accessible().set_name("Shell")
        self.shell.set_default_size(300, 60)
        self.shell.move(100, 600)
        bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.shell.add(bar)
        for name, window in (("Target", self.target), ("Cover", self.cover)):
            button = Gtk.Button(label=name)
            button.get_accessible().set_name(f"task:{name}")
            button.connect("clicked", lambda _b, w=window, n=name: self.present(w, n))
            bar.pack_start(button, False, False, 0)

        for window in (self.target, self.cover, self.shell):
            window.connect("destroy", Gtk.main_quit)
            window.show_all()
        # Cover last, so it is on top of Target at start; Shell to the side.
        self.target.present()
        self.cover.present()
        GLib.timeout_add(300, self.announce)

        self.pipe = os.open(pipe_path, os.O_RDONLY | os.O_NONBLOCK)
        self.buffer = b""
        GLib.io_add_watch(self.pipe, GLib.IO_IN | GLib.IO_HUP, self.on_pipe)

    def announce(self):
        x, y = self.target.get_position()
        fx, fy = self.field.translate_coordinates(self.target, 0, 0)
        print(f"ready target@{x},{y} field@{x + fx},{y + fy} text={self.field.get_text()!r}", flush=True)
        return False

    def present(self, window, name):
        window.present_with_time(Gdk.CURRENT_TIME)
        print(f"presented {name}", flush=True)

    def on_pipe(self, fd, _condition):
        try:
            chunk = os.read(fd, 4096)
        except BlockingIOError:
            return True
        if not chunk:
            GLib.timeout_add(100, self.reopen)
            return False
        self.buffer += chunk
        while b"\n" in self.buffer:
            line, self.buffer = self.buffer.split(b"\n", 1)
            self.handle(line.decode().strip())
        return True

    def reopen(self):
        os.close(self.pipe)
        self.pipe = os.open(sys.argv[1], os.O_RDONLY | os.O_NONBLOCK)
        GLib.io_add_watch(self.pipe, GLib.IO_IN | GLib.IO_HUP, self.on_pipe)
        return False

    def handle(self, command: str):
        if command == "cover":
            # Follow Target wherever it is now: after a layout change the old
            # Cover position covers nothing, and "covered" would be a lie. The
            # 20 px offset keeps the two windows from being exactly coincident,
            # which Xvfb's root capture answers as black rather than as Cover.
            x, y = self.target.get_position()
            self.cover.move(x - 20, y + 20)
            self.cover.present_with_time(Gdk.CURRENT_TIME)
            print("covered", flush=True)
        elif command == "move-target":
            x, y = self.target.get_position()
            self.target.move(x + 120, y)
            print(f"moved target to {x + 120},{y}", flush=True)
        elif command == "text":
            print(f"text={self.field.get_text()!r}", flush=True)
        elif command == "quit":
            Gtk.main_quit()
        elif command:
            print(f"unknown command {command!r}", flush=True)


if __name__ == "__main__":
    GLib.set_prgname("cc01-fixture")
    GLib.set_application_name("cc01-fixture")
    Fixture(sys.argv[1])
    Gtk.main()
