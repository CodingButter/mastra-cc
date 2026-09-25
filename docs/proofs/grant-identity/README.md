# Grant identity (ADR-0120)

A Python GTK fixture ([impostor.py](impostor.py)) calls `GLib.set_prgname("firefox")`. The daemon is started with `--grant firefox`. No real Firefox is running.

    node docs/proofs/grant-identity/demo.mjs <worktree> --out <file>

- [without.txt](without.txt): the base (`a919bd9`). The impostor's 12 elements, including the field `impostor-secret`, are answered as the granted Firefox. **RED.**
- [with.txt](with.txt): this branch. The unscoped query answers nothing from it. The scoped query is refused with `{"class":"world","code":"ApplicationIdentityMismatch"}`. **GREEN.**

Control, run on the same branch build: the real `/usr/bin/mousepad` granted as `mousepad` still answers a scoped query with 330 elements.

Not proven: Flatpak applications. None were installed on this machine. ADR-0120 records that they are hidden unless their executable is listed explicitly.
