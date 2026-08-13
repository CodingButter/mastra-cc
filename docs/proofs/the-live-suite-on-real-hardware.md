# The live suite on real hardware

Produced by running the two live lanes on a real machine with a real session,
2026-08-13. The M2 exit gate demands the live suite green on real hardware with
the machine and session type recorded in the receipt — this document is that
receipt.

## The machine and the session

- Machine: **minibeast** (the work machine every M0.5 measurement was taken on).
- OS: Ubuntu 24.04.
- Session type: **Wayland** (`XDG_SESSION_TYPE=wayland`, a live desktop session
  with the session accessibility bus present).
- Node: v25.2.1 — read from `node --version` in the run, not quoted from an
  earlier document.
- Chrome: Google Chrome 150.0.7871.186 — read from `google-chrome --version`
  in the run.
- pnpm: 10.23.0.

## The commands

Two lanes, exactly as the conformance suite defines them:

```
bash infra/cdp-live.sh
```

The cdp lane's harness: it serves the fixture page on port 9745, boots a real
headless Chrome with its debugging endpoint on port 9744 and a throwaway
profile, health-checks the endpoint with bounded retries, then runs the
conformance suite with the live flag set. It kills only the processes it
started.

```
cd daemon && MASTRA_CC_LIVE=1 npx vitest run src/__tests__/backend-conformance.test.ts --reporter=dot
```

The second invocation runs the same suite shape directly, with the cdp lane's
precondition (a real browser at the debugging endpoint) arranged the same way
the harness arranges it, so both live lanes execute rather than skip. The atspi
live lane talks to the session's real accessibility bus — nothing arranges
that; it is the desktop session itself.

## The result

Both invocations, same counts:

```
Test Files  1 passed (1)
     Tests  32 passed (32)
```

**32 passed, 0 skipped.** The offline run of this suite reports 16 passed and
16 skipped; the difference — the 16 tests that only run against a live
accessibility bus and a live browser endpoint — is exactly what this receipt
witnesses. Both lanes exited 0.

## The limit of this result

This witnesses the suite on **one machine and one session type**: minibeast,
under Wayland. It says nothing about X11. The X11 frame-provider wrinkle —
an X11 host publishes `mutter-x11-frames` as its own accessibility
application, recorded under Q04 in [09-QUESTIONS.md](../09-QUESTIONS.md) — is
an X11 concern and is out of this run's reach. No X11 claim is made here.

A rerun is one paste: the repository keeps an untracked proof leg that runs
both lanes and tees the transcript, and the two commands above are the whole
of what it does.
