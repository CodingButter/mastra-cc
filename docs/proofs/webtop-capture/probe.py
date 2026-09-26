#!/usr/bin/env python3
"""Diagnose the selected Webtop container; never retain or print screenshot pixels."""
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import tempfile


def run(command, **kwargs):
    child = subprocess.Popen(command, start_new_session=True, **kwargs)
    try:
        stdout, stderr = child.communicate(timeout=12)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.communicate()
        raise RuntimeError(f"timed out: {command[0]}") from None
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
    if child.returncode:
        raise RuntimeError(f"{command[0]} exited {child.returncode}: {(stderr or b'')[:1000].decode(errors='replace')}")
    return stdout


def capture(command):
    with tempfile.TemporaryFile() as pixels, tempfile.TemporaryFile() as errors:
        child = subprocess.Popen(command, stdout=pixels, stderr=errors, start_new_session=True)
        try:
            child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            raise RuntimeError("capture timed out") from None
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        size = pixels.tell()
        pixels.seek(0)
        header = pixels.read(100)
        errors.seek(0)
        error = errors.read(2048).decode(errors="replace")
        return child.returncode, size, header, error


def inside():
    from gi.repository import Gio, GLib
    import resource

    def terminated(signum, frame):
        raise RuntimeError("diagnostic terminated; cleaning up active helpers")

    signal.signal(signal.SIGTERM, terminated)
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))
    pids = run(["pgrep", "-u", str(os.getuid()), "-x", "plasmashell"], stdout=subprocess.PIPE, stderr=subprocess.PIPE).split()
    if len(pids) != 1:
        raise RuntimeError("expected exactly one desktop-user plasmashell")
    session = Path(f"/proc/{pids[0].decode()}/environ").read_bytes().split(b"\0")
    allow = {"DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY", "WAYLAND_DISPLAY"}
    for key in allow:
        os.environ.pop(key, None)
    for item in session:
        key, _, value = item.partition(b"=")
        if key.decode(errors="replace") in allow:
            os.environ[key.decode()] = value.decode()
    for key in ("DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"):
        if not os.environ.get(key):
            raise RuntimeError(f"missing session {key}")
    print(f"desktop UID: {os.getuid()}; DISPLAY: {os.environ['DISPLAY']}", flush=True)
    processes = run(["ps", "-u", str(os.getuid()), "-o", "comm="], stdout=subprocess.PIPE, stderr=subprocess.PIPE).decode().splitlines()
    names = sorted({name.strip() for name in processes} & {"kwin_wayland", "kwin_x11", "Xwayland", "Xvnc"})
    print("display processes: " + ", ".join(names), flush=True)
    if "kwin_wayland" not in names or "Xwayland" not in names:
        raise RuntimeError("not the KDE Wayland/Xwayland session this diagnosis covers")
    xwayland = run(["pgrep", "-u", str(os.getuid()), "-x", "Xwayland"], stdout=subprocess.PIPE, stderr=subprocess.PIPE).split()
    display = os.environ["DISPLAY"].split(".")[0].encode()
    matching = [Path(f"/proc/{pid.decode()}/cmdline").read_bytes().split(b"\0") for pid in xwayland]
    matching = [args for args in matching if display in args]
    if len(matching) != 1 or b"-rootless" not in matching[0]:
        raise RuntimeError("expected exactly one rootless Xwayland for the selected display")
    print("selected-display Xwayland rootless: yes", flush=True)

    code, size, _, error = capture(["xwd", "-root", "-silent"])
    print(f"desktop xwd: exit={code}; bytes={size}; {error.strip()}", flush=True)
    if code == 0 or size != 0 or "BadMatch" not in error or "X_GetImage" not in error:
        raise RuntimeError("desktop capture did not reproduce the measured BadMatch")
    code, size, header, error = capture(["xvfb-run", "-a", "-s", "-screen 0 160x120x24", "xwd", "-root", "-silent"])
    if code or len(header) != 100:
        raise RuntimeError(f"Xvfb control failed: {error}")
    fields = struct.unpack(">25I", header)
    header_size, version, pixmap_format, depth, width, height = fields[:6]
    bytes_per_line, colors = fields[12], fields[19]
    expected = header_size + colors * 12 + bytes_per_line * height
    if (version, pixmap_format, depth, width, height) != (7, 2, 24, 160, 120) or header_size < 100 or bytes_per_line < width * 3 or size != expected:
        raise RuntimeError("Xvfb control is not a complete expected XWD image")
    print(f"Xvfb control: exit=0; XWD version={version}; {width}x{height}; depth={depth}; bytes={size}; complete payload", flush=True)

    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    service = "org.kde.KWin.ScreenShot2"
    path = "/org/kde/KWin/ScreenShot2"
    xml = bus.call_sync(service, path, "org.freedesktop.DBus.Introspectable", "Introspect", None, GLib.VariantType.new("(s)"), Gio.DBusCallFlags.NONE, 8000, None).unpack()[0]
    if 'name="CaptureWorkspace"' not in xml:
        raise RuntimeError("KDE CaptureWorkspace is absent")
    print("KDE ScreenShot2: CaptureWorkspace advertised", flush=True)
    with tempfile.TemporaryFile() as pixels:
        fds = Gio.UnixFDList.new()
        handle = fds.append(pixels.fileno())
        try:
            bus.call_with_unix_fd_list_sync(service, path, service, "CaptureWorkspace", GLib.Variant("(a{sv}h)", ({}, handle)), None, Gio.DBusCallFlags.NONE, 8000, fds, None)
        except GLib.Error as error:
            remote = Gio.DBusError.get_remote_error(error)
            print(f"KDE capture caller result: {remote}", flush=True)
            if remote != service + ".Error.NoAuthorized":
                raise
        else:
            raise RuntimeError("KDE caller is now authorized; diagnosis must be revised")
        if pixels.seek(0, 2) != 0:
            raise RuntimeError("unexpected bytes returned with authorization refusal")
    try:
        bus.call_sync("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop", "org.freedesktop.DBus.Introspectable", "Introspect", None, None, Gio.DBusCallFlags.NONE, 8000, None)
    except GLib.Error as error:
        remote = Gio.DBusError.get_remote_error(error)
        print(f"desktop portal: {remote}", flush=True)
        if remote != "org.freedesktop.DBus.Error.ServiceUnknown":
            raise
    else:
        raise RuntimeError("portal is now present; diagnosis must be revised")
    print("DIAGNOSIS: VERIFIED (not a screenshot fix); pixels discarded", flush=True)


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--inside"]:
            inside()
        else:
            if len(sys.argv) != 2 or sys.argv[1].startswith("-"):
                raise RuntimeError("usage: probe.py CONTAINER")
            container = sys.argv[1]
            os.environ.setdefault("DOCKER_HOST", "unix:///var/run/docker.sock")
            image = run(["docker", "inspect", "--format", "{{.Config.Image}}", container], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            print("container image: " + image.decode().strip(), flush=True)
            # Docker exec gets its own bounded in-container timeout: killing only
            # the host Docker client does not necessarily kill the remote process.
            with Path(__file__).open("rb") as source:
                child = subprocess.run(["docker", "exec", "-i", "-u", "1000", container, "timeout", "--kill-after=3", "45", "python3", "-", "--inside"], stdin=source, timeout=50)
            if child.returncode:
                raise RuntimeError(f"container diagnostic exited {child.returncode}")
    except Exception as error:
        print(f"DIAGNOSIS: FAILED: {error}", file=sys.stderr)
        sys.exit(1)
