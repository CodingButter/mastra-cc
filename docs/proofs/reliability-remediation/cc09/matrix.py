"""Run the native workload matrix in private Xvfb displays, never the user's desktop."""
import json
import os
import signal
import pathlib
import select
import subprocess
import sys

here = pathlib.Path(__file__).resolve().parent
def run_group(command, timeout):
    process = subprocess.Popen(command, start_new_session=True)
    try:
        code = process.wait(timeout=timeout)
        if code:
            raise subprocess.CalledProcessError(code, command)
    finally:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()

if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(128 + signum))
    root = str(pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve())

    if len(sys.argv) > 2 and sys.argv[2] == "--session":
        width, height, pattern = sys.argv[3:6]
        painter = subprocess.Popen(["python3", str(here / "paint-workload.py"), width, height, pattern], stdout=subprocess.PIPE, text=True)
        try:
            readable, _, _ = select.select([painter.stdout], [], [], 30)
            if not readable or painter.stdout.readline().strip() != "READY":
                raise RuntimeError("native painter did not become ready")
            for crop in ("small", "full"):
                for concurrency in (1, 4):
                    result = subprocess.run(["node", str(here / "workload.mjs"), root, width, height, pattern, crop, str(concurrency)], capture_output=True, text=True, timeout=180)
                    if result.returncode:
                        raise RuntimeError(result.stderr + result.stdout)
                    record = json.loads(result.stdout)
                    print(json.dumps(record), flush=True)
        finally:
            painter.terminate()
            try:
                painter.wait(timeout=5)
            except subprocess.TimeoutExpired:
                painter.kill()
                painter.wait()
    else:
        print(json.dumps({"type": "metadata", "commit": subprocess.check_output(["git", "-C", root, "rev-parse", "HEAD"], text=True).strip(), "node": subprocess.check_output(["node", "--version"], text=True).strip(), "samplesPerCase": 12, "warmups": 2, "coldRequests": 1}), flush=True)
        for width, height in ((1280, 720), (1920, 1080), (3840, 2160)):
            for pattern in ("ui", "noise"):
                run_group(["xvfb-run", "-a", "-s", f"-screen 0 {width}x{height}x24", "python3", str(here / "matrix.py"), root, "--session", str(width), str(height), pattern], timeout=720)
