"""Force a timeout and verify the whole workload process group is stopped."""
import pathlib
import subprocess
import sys
import tempfile
import time
sys.dont_write_bytecode = True
from matrix import run_group

with tempfile.TemporaryDirectory(prefix="cc09-cleanup-") as directory:
    path = pathlib.Path(directory) / "pids"
    program = "import os,subprocess,sys,time; child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); open(sys.argv[1],'w').write(str(os.getpid())+' '+str(child.pid)); time.sleep(60)"
    try:
        run_group([sys.executable, "-c", program, str(path)], timeout=1)
        raise AssertionError("timeout did not occur")
    except subprocess.TimeoutExpired:
        pass
    pids = [int(value) for value in path.read_text().split()]
    assert len(pids) == 2
    for _ in range(100):
        alive = []
        for pid in pids:
            stat = pathlib.Path(f"/proc/{pid}/stat")
            if stat.exists() and stat.read_text().split()[2] not in ("Z", "X"):
                alive.append(pid)
        if not alive:
            break
        time.sleep(.01)
    assert not alive, f"processes still running: {alive}"
    print("PROOF: GREEN — forced timeout stopped both child and grandchild; no active benchmark descendants")
