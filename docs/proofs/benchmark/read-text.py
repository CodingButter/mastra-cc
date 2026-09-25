# Reads every editable text in one application straight from AT-SPI, without
# the daemon, so the harness checks an outcome by a route the daemon cannot
# influence. usage: python3 read-text.py <application-name>
import sys, gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi
def walk(node, out, depth=0):
    if node is None or depth > 40: return
    try:
        if node.get_role() in (Atspi.Role.TEXT, Atspi.Role.ENTRY, Atspi.Role.DOCUMENT_TEXT):
            if node.get_text_iface():
                out.append(Atspi.Text.get_text(node, 0, Atspi.Text.get_character_count(node)))
        for i in range(node.get_child_count()): walk(node.get_child_at_index(i), out, depth + 1)
    except Exception: pass
d = Atspi.get_desktop(0); out = []
for i in range(d.get_child_count()):
    a = d.get_child_at_index(i)
    if a and a.get_name() == sys.argv[1]: walk(a, out)
print("\n".join(out))
