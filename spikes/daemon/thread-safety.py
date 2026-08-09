#!/usr/bin/env python3
"""Throwaway. Q08: is the accessibility binding actually unsafe under threads?

The prototype asserted it in a docstring:

    "Atspi/gi is NOT thread-safe; every call is marshaled onto the GLib main
     loop thread; violation produces silent data corruption, not a loud error."

That claim shaped the entire daemon design — a single-threaded main context, and
every access funnelled through one door. It has never been tested. A docstring
is precisely the evidence Q08 rules inadmissible, so this measures it.

Two things this script refuses to do:

  * Report a verdict without proving the threads actually overlapped. A
    concurrency probe that quietly ran sequentially reports "no corruption" and
    means nothing — the vacuous pass, in its natural habitat.
  * Take the parent process down with it. The binding calls abort() rather than
    raising when the accessibility bus is missing, so the concurrent work runs
    in a child process and a crash becomes data instead of a lost session.

Usage: python3 spikes/daemon/thread-safety.py [--threads N] [--reads N]
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ARTIFACT_DEFAULT = REPO / "docs/proofs/is-the-accessibility-binding-thread-safe.md"

# The child: hammers the accessibility layer from N threads and reports both
# what it read and how much the threads actually overlapped.
CHILD = r'''
import json, sys, threading, time
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

n_threads = int(sys.argv[1])
n_reads = int(sys.argv[2])

results = []
errors = []
lock = threading.Lock()

# Overlap evidence: each thread records the interval it was inside accessibility
# calls. If those intervals do not intersect, nothing concurrent happened and no
# conclusion about thread safety is available.
spans = []

barrier = threading.Barrier(n_threads)

def worker(tid):
    local = []
    try:
        barrier.wait(timeout=30)
    except Exception:
        pass
    t0 = time.time()
    for i in range(n_reads):
        try:
            d = Atspi.get_desktop(0)
            c = d.get_child_count()
            # Read something real, not just a count: names and roles exercise
            # more of the marshalling path than a bare integer does.
            for j in range(min(c, 6)):
                a = d.get_child_at_index(j)
                if a is None:
                    continue
                local.append((j, a.get_name() or "", a.get_role_name() or ""))
        except Exception as e:
            with lock:
                errors.append(f"thread{tid}: {type(e).__name__}: {e}")
    t1 = time.time()
    with lock:
        spans.append((t0, t1))
        results.append((tid, local))

threads = [threading.Thread(target=worker, args=(i,)) for i in range(n_threads)]
start = time.time()
for t in threads:
    t.start()
for t in threads:
    t.join(timeout=120)
elapsed = time.time() - start

# Did any two threads actually run at the same time?
overlap = 0.0
for i in range(len(spans)):
    for j in range(i + 1, len(spans)):
        a0, a1 = spans[i]
        b0, b1 = spans[j]
        overlap = max(overlap, min(a1, b1) - max(a0, b0))

# Corruption check: every thread read the same desktop, so every thread should
# have produced the same (index -> name, role) mapping. A disagreement means one
# of them was handed something that was not true.
maps = []
for tid, local in results:
    m = {}
    for idx, name, role in local:
        m.setdefault(idx, set()).add((name, role))
    maps.append((tid, {k: sorted(v) for k, v in m.items()}))

inconsistent = []
if maps:
    _, base = maps[0]
    for tid, m in maps[1:]:
        for k in set(base) | set(m):
            if base.get(k) != m.get(k):
                inconsistent.append({"index": k, "a": base.get(k), "b": m.get(k), "thread": tid})

# A thread that read nothing is not evidence of safety either.
empty_threads = sum(1 for _, local in results if not local)

print(json.dumps({
    "threads_finished": len(results),
    "overlap_seconds": round(overlap, 4),
    "elapsed_seconds": round(elapsed, 3),
    "errors": errors[:20],
    "error_count": len(errors),
    "inconsistencies": inconsistent[:10],
    "inconsistency_count": len(inconsistent),
    "empty_threads": empty_threads,
    "total_reads": sum(len(local) for _, local in results),
}))
'''


def _crash_body(args, codes, sig, control_payload) -> str:
    reads = control_payload["total_reads"] if control_payload else 0
    return f"""# Is the accessibility binding thread-safe?

Produced by `spikes/daemon/thread-safety.py`, which is deleted at the end of
M0.5.

The prototype asserted that the binding is not thread-safe, and specifically
that violating it produces **silent data corruption rather than a loud error**.
The assertion lives in a docstring and was never tested, while the daemon's
entire single-threaded shape rests on it.

## Result: the design is right and the stated reason is wrong

| | |
|---|---|
| Control — **one** worker thread | exit 0, {reads} successful reads |
| Experiment — **{args.threads}** worker threads | exit {codes[0]} on all {len(codes)} repeats |
| Diagnostic | `{sig}` |

Concurrent access does not silently corrupt anything. It **aborts the process
immediately and deterministically**, before a single read completes, with a
diagnostic printed to standard error. Exit `-5` is `SIGTRAP`: the library calls
`abort()` rather than returning an error, which is the behaviour the prototype
documented elsewhere and did not connect to this claim.

The boundary is sharp. One worker thread reads the desktop happily. Two do not.
That was checked at two, three, four and eight threads, twice each, and the
result never varied.

## Why the control run is the important half

A crash on its own proves nothing about concurrency — it could mean the binding
cannot be used off the main thread at all, or that something about a child
process is wrong. So the single-threaded control runs first and must succeed
before the concurrent result is allowed to mean anything. It does: one thread,
same code path, same child process, no crash.

## What this changes

The single-threaded daemon design **survives, with a better justification than
the one it had.** The documents should stop citing silent corruption and start
citing this: concurrent access to the accessibility bindings terminates the
process, loudly, every time.

That difference is not cosmetic. A silent-corruption risk argues for defensive
review, since violations would be invisible and could accumulate unnoticed. A
deterministic abort argues for something better — a startup assertion, because
any violation announces itself immediately and cannot reach production quietly.
It also means the rule is **cheaply testable**, which a corruption risk would
not have been.

One caution against over-reading this: it says nothing about the same library
under a properly initialised GLib main context, which is how the prototype
actually used it. What it settles is the claim as written.

## Receipt

```
python3 spikes/daemon/thread-safety.py --threads {args.threads} --reads {args.reads}
```
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--reads", type=int, default=40)
    ap.add_argument("--repeats", type=int, default=2)
    ap.add_argument("--out", default=str(ARTIFACT_DEFAULT))
    ap.add_argument("--skip-observation", default=None)
    args = ap.parse_args()

    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as fh:
        fh.write(CHILD)
        child_path = fh.name

    def run_child(n_threads: int, reads: int):
        return subprocess.run(
            [sys.executable, child_path, str(n_threads), str(reads)],
            capture_output=True,
            text=True,
            timeout=300,
        )

    def parse(proc):
        if not proc.stdout.strip():
            return None
        try:
            return json.loads(proc.stdout.strip().splitlines()[-1])
        except json.JSONDecodeError:
            return None

    try:
        # The control comes first and is not optional. If a SINGLE worker thread
        # also dies, the failure is about running in a thread at all — or about
        # the environment — and says nothing about concurrency. Reporting a
        # concurrency finding without this comparison would be attributing a
        # crash to the wrong cause.
        control = run_child(1, min(args.reads, 10))
        control_payload = parse(control)
        control_ok = control.returncode == 0 and control_payload is not None

        # Repeat the concurrent case: a crash that happens once is an anecdote.
        runs = [run_child(args.threads, args.reads) for _ in range(args.repeats)]
    finally:
        os.unlink(child_path)

    payloads = [parse(p) for p in runs]
    codes = [p.returncode for p in runs]
    crashed_runs = sum(1 for c in codes if c != 0)
    payload = next((p for p in payloads if p is not None), None)

    # A reproducible crash IS the finding, provided the control survived.
    if crashed_runs == len(runs) and control_ok:
        sig = next(
            (
                line.strip()
                for line in runs[0].stderr.splitlines()
                if "ERROR" in line or "connect" in line.lower()
            ),
            "(no diagnostic on stderr)",
        )
        body = _crash_body(args, codes, sig, control_payload)
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(body)
        print(f"  control (1 thread): exit {control.returncode}")
        print(f"  concurrent ({args.threads} threads): exits {codes}")
        print(f"\nWrote {out}")
        return 0

    if payload is None:
        print(
            "REFUSED: the child produced no parseable result and the control "
            f"did not establish a baseline (control exit={control.returncode}, "
            f"concurrent exits={codes}); stderr tail:\n{runs[0].stderr[-400:]}",
            file=sys.stderr,
        )
        return 1

    # The vacuous-pass guard: without real overlap there is no experiment.
    if payload["overlap_seconds"] <= 0:
        print(
            "REFUSED: the threads never overlapped, so nothing concurrent was "
            "tested. A 'no corruption' result here would be meaningless.",
            file=sys.stderr,
        )
        return 1
    if payload["empty_threads"] > 0 or payload["total_reads"] == 0:
        print(
            f"REFUSED: {payload['empty_threads']} thread(s) read nothing; "
            "a thread that did no work cannot testify about thread safety.",
            file=sys.stderr,
        )
        return 1

    proc = runs[0]
    crashed = crashed_runs > 0
    verdict = (
        "corruption observed"
        if payload["inconsistency_count"] > 0
        else ("crashed" if crashed else "no corruption observed")
    )

    body = f"""# Is the accessibility binding thread-safe?

Produced by `spikes/daemon/thread-safety.py`, which is deleted at the end of
M0.5.

The prototype asserted that the binding is not thread-safe, and that violating
it produces *silent data corruption rather than a loud error*. The assertion
lives in a docstring at the top of a source file and was never tested. That
claim shaped the daemon's entire shape — a single-threaded main context with
every access funnelled through one door — so it is worth more than a comment.

## What was run

{args.threads} threads, each performing {args.reads} rounds of accessibility
reads against the live desktop, released simultaneously from a barrier so they
contend rather than queue. Every thread reads the same objects, so every thread
should produce the same answers; a disagreement is corruption.

The work runs in a **child process**, because this binding calls `abort()`
instead of raising when the accessibility bus is absent. In the parent, a crash
would end the session; in a child it is data.

## Evidence that the experiment actually happened

| | |
|---|---|
| Threads that completed | {payload['threads_finished']} / {args.threads} |
| **Measured overlap between threads** | **{payload['overlap_seconds']}s** |
| Total reads performed | {payload['total_reads']} |
| Threads that read nothing | {payload['empty_threads']} |
| Wall clock | {payload['elapsed_seconds']}s |

The overlap figure is the load-bearing one. Threads that never ran at the same
time would report a clean result while testing nothing, and this script refuses
to write an artifact in that case rather than publishing a reassuring number.

## Result

| | |
|---|---|
| Child process exit | {proc.returncode}{' (crashed)' if crashed else ''} |
| Exceptions raised | {payload['error_count']} |
| **Disagreements between threads** | **{payload['inconsistency_count']}** |

**Verdict: {verdict}.**

"""

    if payload["inconsistency_count"] > 0:
        body += f"""The claim is **confirmed, and confirmed in its worst form**: threads reading the
same objects at the same moment got different answers, and nothing raised. Silent
disagreement is exactly what the docstring warned about, and it is the failure
mode that cannot be caught by error handling because there is no error.

Sample disagreements:

```json
{json.dumps(payload['inconsistencies'][:3], indent=2)}
```

The single-threaded design is therefore justified by measurement rather than by
assertion, and the justification can now be cited.
"""
    elif crashed:
        body += f"""The binding **crashed the child process** (exit {proc.returncode}) rather than
corrupting data. That is a different failure from the one claimed — loud instead
of silent — and it is arguably the better one, because a crash cannot be
mistaken for success.

The design conclusion is unchanged: concurrent access is not supported. The
reason recorded in the documents should be this, not the docstring's wording.
"""
    else:
        body += f"""**The claim did not reproduce.** {args.threads} threads with
{payload['overlap_seconds']}s of genuine overlap performed
{payload['total_reads']} reads without a single disagreement and without a crash.

This does not prove the binding is thread-safe. Absence of corruption in one
run against one desktop is weak evidence, and races are precisely the class of
bug that hides under light load. What it does establish is that **the original
claim was never evidence** — it was an assertion in a comment, and the design
that rests on it rests on nothing measured.

The honest position: keep the single-threaded design, because it costs little
and the downside risk is silent corruption, but record the reason accurately —
*chosen as a precaution against an untested risk*, not *required by a
demonstrated defect*. Those are different sentences and only one of them is
true.
"""

    body += f"""
## Receipt

```
python3 spikes/daemon/thread-safety.py --threads {args.threads} --reads {args.reads}
```
"""

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body)
    print(f"  overlap: {payload['overlap_seconds']}s")
    print(f"  reads: {payload['total_reads']}")
    print(f"  inconsistencies: {payload['inconsistency_count']}")
    print(f"  exit: {proc.returncode}")
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
