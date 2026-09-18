"""A GTK3 window holding one solid-colour panel of a known size.

The colour is the point. A rectangle read from the accessibility tree is only
useful if the pixels at that rectangle are the element - and under display
scaling, "the rectangle" has two possible meanings: logical units, which the
toolkit lays out in, and device pixels, which the screen and the screen grab
are made of. If those two ever disagree and the daemon does not notice, a
capture will return a confidently-cropped picture of the wrong thing.

So the panel is painted one flat colour no other part of the window uses. If
the captured pixels are that colour edge to edge, the rectangle meant device
pixels. If they are not, the picture is of somewhere else, and the exact miss
is visible rather than merely suspected.
"""
import os
import sys

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk, Gdk  # noqa: E402

PANEL = (0.0, 0.35, 0.85)  # a blue nothing else in the window uses
PANEL_LOGICAL_WIDTH = 300
PANEL_LOGICAL_HEIGHT = 120


class Fixture:
    def __init__(self, pipe_path: str):
        self.window = Gtk.Window(title="Scaling Fixture")
        self.window.set_default_size(700, 400)
        self.window.get_accessible().set_name("Scaling Fixture")
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        self.window.add(box)

        # A margin on every side, so a capture that is off by even a few pixels
        # picks up the window background instead of more panel.
        self.panel = Gtk.DrawingArea()
        self.panel.set_size_request(PANEL_LOGICAL_WIDTH, PANEL_LOGICAL_HEIGHT)
        self.panel.get_accessible().set_name("panel")
        self.panel.get_accessible().set_description("solid colour target")
        self.panel.set_margin_top(40)
        self.panel.set_margin_start(60)
        self.panel.set_margin_end(60)
        self.panel.connect("draw", self.paint)
        box.pack_start(self.panel, False, False, 0)

        self.entry = Gtk.Entry()
        self.entry.get_accessible().set_name("field")
        self.entry.set_text("field")
        box.pack_start(self.entry, False, False, 0)

        self.window.connect("destroy", Gtk.main_quit)
        self.window.show_all()

        self.pipe = os.open(pipe_path, os.O_RDONLY | os.O_NONBLOCK)
        self.buffer = b""
        GLib.io_add_watch(self.pipe, GLib.IO_IN | GLib.IO_HUP, self.on_pipe)
        self.say("ready")
        # What the toolkit itself believes, so the driver compares the daemon's
        # answer against the application's own numbers rather than a guess.
        scale = self.window.get_scale_factor()
        self.say(f"scale-factor {scale}")

    def paint(self, _widget, context):
        context.set_source_rgb(*PANEL)
        context.paint()
        return False

    def say(self, line: str) -> None:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()

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
            os.close(fd)
            self.pipe = os.open(sys.argv[1], os.O_RDONLY | os.O_NONBLOCK)
            GLib.io_add_watch(self.pipe, GLib.IO_IN | GLib.IO_HUP, self.on_pipe)
            return False
        return True

    def command(self, line: str) -> None:
        if line == "grow":
            # A layout change big enough that a stale rectangle would land on
            # the window background rather than on the panel.
            self.panel.set_size_request(PANEL_LOGICAL_WIDTH, PANEL_LOGICAL_HEIGHT + 90)
            self.say("grew panel")
        elif line == "report":
            allocation = self.panel.get_allocation()
            origin = self.panel.get_window() or self.window.get_window()
            ox, oy = origin.get_origin()[1:3]
            self.say(
                f"allocation {allocation.x} {allocation.y} {allocation.width} {allocation.height} "
                f"origin {ox} {oy} scale {self.window.get_scale_factor()}"
            )
        elif line == "quit":
            Gtk.main_quit()
        elif line:
            self.say(f"unknown {line}")


if __name__ == "__main__":
    GLib.set_prgname("cc07-fixture")
    GLib.set_application_name("cc07-fixture")
    Gdk.set_show_events(False)
    Fixture(sys.argv[1])
    Gtk.main()
