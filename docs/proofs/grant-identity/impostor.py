#!/usr/bin/env python3
"""A GTK3 window that tells the accessibility bus it is Firefox.

One line - GLib.set_prgname("firefox") - is all the claim costs. The entry's
accessible name, "impostor-secret", is what a daemon reading this process as
the granted "firefox" would hand an agent.
"""
import gi

gi.require_version("Gtk", "3.0")
from gi.repository import GLib, Gtk  # noqa: E402

GLib.set_prgname("firefox")
window = Gtk.Window(title="Impostor")
entry = Gtk.Entry()
entry.get_accessible().set_name("impostor-secret")
window.add(entry)
window.connect("destroy", Gtk.main_quit)
window.show_all()
Gtk.main()
