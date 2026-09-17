"""Paint only synthetic pixels on the isolated benchmark display."""
import random
import sys
import os
os.environ["GDK_BACKEND"] = "x11"
os.environ["NO_AT_BRIDGE"] = "1"
os.environ.pop("WAYLAND_DISPLAY", None)
import gi
import cairo

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gdk, GLib

width, height = map(int, sys.argv[1:3])
pattern = sys.argv[3]
assert Gdk.Display.get_default().get_name() == os.environ["DISPLAY"]
window = Gtk.Window()
window.set_decorated(False)
window.set_default_size(width, height)
window.move(0, 0)
area = Gtk.DrawingArea()
window.add(area)
ready = False
pixels = random.Random(42).randbytes(width * height * 4) if pattern == "noise" else None
surface = cairo.ImageSurface.create_for_data(bytearray(pixels), cairo.FORMAT_RGB24, width, height) if pixels else None

def announce():
    Gdk.Display.get_default().sync()
    print("READY", flush=True)
    return False

def draw(widget, context):
    global ready
    if surface:
        context.set_source_surface(surface, 0, 0)
        context.paint()
    else:
        context.set_source_rgb(0.94, 0.94, 0.94)
        context.paint()
        context.set_source_rgb(0.12, 0.16, 0.22)
        context.rectangle(0, 0, 220, height)
        context.fill()
        context.set_font_size(15)
        for row in range(height // 28):
            context.set_source_rgb(0.84 + (row % 2) * 0.1, 0.88, 0.91)
            context.rectangle(240, row * 28, width - 260, 26)
            context.fill()
            context.set_source_rgb(0.1, 0.12, 0.15)
            context.move_to(250, row * 28 + 19)
            context.show_text("Synthetic benchmark row %04d - no user content" % row)
    if not ready:
        ready = True
        GLib.idle_add(announce)
    return False

area.connect("draw", draw)
window.connect("destroy", Gtk.main_quit)
window.show_all()
Gtk.main()
