#!/usr/bin/env bash
# WHERE A SYNTHESISED KEY ACTUALLY GOES - measured, not assumed.
#
# The daemon's key route emits on the accessibility registry, which underneath
# is an X test event: it goes wherever the DISPLAY SERVER points, and the
# accessibility layer's own notion of focus has no vote. This script measures
# that directly, because the difference decides whether a key addressed to one
# element can land at all, and because the interface answers success either way.
#
# Two conditions, one editor, one key (Delete, keysym 0xffff):
#   1. the editor's window is the one the display server calls active
#   2. another window is active, and the element is focused through the
#      accessibility layer only
#
# It presses nothing by hand: no xdotool, no wmctrl, no uinput. The only key in
# this script is the one under test, emitted the way the daemon emits it.
set -euo pipefail
CONTAINER="${CONTAINER:-mcc-webtop-harness}"
OUT="${1:-docs/proofs/04-a-key-addressed-to-one-element-spike.txt}"

docker exec -u abc "$CONTAINER" bash -lc '
export DISPLAY=:1
pkill -KILL -x kate >/dev/null 2>&1 || true; pkill -KILL -x yad >/dev/null 2>&1 || true; sleep 2
mkdir -p /config/spike; printf "alpha" > /config/spike/keys.txt
setsid kate -b /config/spike/keys.txt >/dev/null 2>&1 < /dev/null & sleep 8
echo "condition 1 - the window the display server calls active:"
xprop -id "$(xprop -root _NET_ACTIVE_WINDOW | sed "s/.*# //")" WM_NAME 2>/dev/null
python3 - <<PY
import gi, time
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi
desk = Atspi.get_desktop(0)
kate = [a for a in (desk.get_child_at_index(i) for i in range(desk.get_child_count())) if a and a.get_name() == "kate"][0]
def walk(n, d=0):
    if d > 12: return
    yield n
    try:
        for i in range(n.get_child_count()):
            c = n.get_child_at_index(i)
            if c: yield from walk(c, d + 1)
    except Exception: return
def text_of(n):
    f = n.get_text_iface(); return Atspi.Text.get_text(f, 0, Atspi.Text.get_character_count(f))
doc = [n for n in walk(kate) if n.get_role_name() == "text"
       and n.get_state_set().contains(Atspi.StateType.EDITABLE) and text_of(n) == "alpha"][0]
doc.grab_focus(); time.sleep(0.8)
print("  the document before the key:", repr(text_of(doc)))
Atspi.generate_keyboard_event(0xffff, None, Atspi.KeySynthType.SYM); time.sleep(1.5)
print("  the document after Delete:  ", repr(text_of(doc)))
PY
echo
echo "condition 2 - another window is given the display server focus:"
setsid yad --text="a window that is not the editor" --width=320 >/dev/null 2>&1 < /dev/null & sleep 4
xprop -id "$(xprop -root _NET_ACTIVE_WINDOW | sed "s/.*# //")" WM_NAME 2>/dev/null
python3 - <<PY
import gi, time
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi
desk = Atspi.get_desktop(0)
kate = [a for a in (desk.get_child_at_index(i) for i in range(desk.get_child_count())) if a and a.get_name() == "kate"][0]
def walk(n, d=0):
    if d > 12: return
    yield n
    try:
        for i in range(n.get_child_count()):
            c = n.get_child_at_index(i)
            if c: yield from walk(c, d + 1)
    except Exception: return
def text_of(n):
    f = n.get_text_iface(); return Atspi.Text.get_text(f, 0, Atspi.Text.get_character_count(f))
docs = [n for n in walk(kate) if n.get_role_name() == "text" and n.get_state_set().contains(Atspi.StateType.EDITABLE)]
doc = max(docs, key=lambda n: len(text_of(n)))
doc.grab_focus(); time.sleep(0.8)
print("  the accessibility layer says the document is focused:", doc.get_state_set().contains(Atspi.StateType.FOCUSED))
print("  the document before the key:", repr(text_of(doc)))
Atspi.generate_keyboard_event(0xffff, None, Atspi.KeySynthType.SYM); time.sleep(1.5)
print("  the document after Delete:  ", repr(text_of(doc)))
frame = [n for n in walk(kate) if n.get_role_name() == "frame"][0]
frame.grab_focus(); time.sleep(1); doc.grab_focus(); time.sleep(0.8)
Atspi.generate_keyboard_event(0xffff, None, Atspi.KeySynthType.SYM); time.sleep(1.5)
print("  and after grabbing focus on the window itself first:", repr(text_of(doc)))
PY
pkill -KILL -x yad >/dev/null 2>&1 || true; pkill -KILL -x kate >/dev/null 2>&1 || true
' 2>&1 | tee "$OUT"
