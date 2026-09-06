# Connection startup has one bounded lifetime

## Question

Does the built public `@mastra-cc/transport` entry reject silent peers with
`TransportConnectionError` around 10,000ms, close the underlying connection,
and permit an explicit fresh connection without killing healthy sessions?

## Producer

Prerequisites: Linux/Unix sockets, a supported Node runtime, Bash, GNU `timeout`,
installed workspace dependencies including transport's `ws` runtime dependency,
and the built transport entry. The intended current artifact uses `ws` directly
and does not require global WebSocket; an older baseline may still require it
(the prior runs used Node 25). Promoting the existing `ws` devDependency to runtime
makes supported `terminate()` available for failed startup without waiting for
an uncooperative peer's close handshake. Production/package/lock changes and
builds belong to the parent and implementation worker, not this proof.
No source imports, desktop, or model are needed. The harness resolves `ws` from `packages/transport/package.json`,
independently of where the selected transport bundle was saved.

The built entry is **not self-contained**: it imports external workspace
packages including `@mastra-cc/protocol-types`. From the repository root, save
it **before** building the implementation and preserve dependency resolution
(the parent owns building, snapshot creation, and all actual runs):

```sh
snapshot="$(mktemp -d /tmp/transport-before-startup.XXXXXX)"
cp packages/transport/dist/index.mjs "$snapshot/index.mjs"
ln -s "$PWD/packages/transport/node_modules" "$snapshot/node_modules"
export BEFORE_ARTIFACT="$snapshot/index.mjs"
```

This snapshots the entry only, not its dependency graph. Keep the linked workspace
dependencies installed and unchanged across comparisons. The link targets the
transport package's dependencies, where its workspace protocol dependency resolves.

Run exactly the same harness against each artifact:

```sh
PROOF_LOG=docs/proofs/connection-startup-2026-09-06/terminate-baseline-new.txt \
  bash docs/proofs/connection-startup-2026-09-06/demo.sh "$BEFORE_ARTIFACT"
# Expected nonzero: "connect did not reject by deadline (13000ms cap)".

# After the parent builds the changed transport:
PROOF_LOG=docs/proofs/connection-startup-2026-09-06/terminate-after-new.txt \
  bash docs/proofs/connection-startup-2026-09-06/demo.sh packages/transport/dist/index.mjs
```

An artifact path may alternatively be set with `TRANSPORT_ARTIFACT`.
Arguments take precedence. Paths are resolved relative to the invoking working
directory. The default is this checkout's built `dist/index.mjs`; the script
never builds anything. Direct invocation is also possible:

```sh
timeout --kill-after=2s 75s node docs/proofs/connection-startup-2026-09-06/proof.mjs "$BEFORE_ARTIFACT"
```

## Assertions

Each case uses a real local listening socket, not a mocked transport or timer:

1. Unix peer accepts and receives the client's schema hello but never answers.
2. Raw TCP peer receives an HTTP WebSocket upgrade request but never upgrades.
3. WebSocket peer upgrades but never answers the schema hello.
4. WebSocket peer waits four seconds before upgrading, then never answers hello.
   This distinguishes one shared startup budget from a new ten-second budget
   after opening: a fourteen-second outcome fails the thirteen-second cap.

Each stalled connect must reject specifically as the imported
`TransportConnectionError` between 9 and 13 seconds. The peer must observe
closure within another 1.5 seconds **before harness cleanup**. Only one socket
may have been accepted, and no protocol requests may have arrived. The peer
then attempts a late matching hello (or HTTP upgrade on the raw listener).
The original promise must remain rejected and no client may become available.
Since closure is already required, this is an attempted write on a closed peer,
not a claim that bytes arrived after disconnection.

Recovery uses explicit new `connect` calls to healthy Unix and real WebSocket
peers concurrently. Each echoes the client's actual schema digest and answers
`listApplications` with `{ applications: [] }`. Each must succeed immediately
and again after 10.5 seconds; only these two observation requests are allowed
per peer. This exercises healthy-session longevity on both transports without
adding another ten-second wait to the normal run.

The normal run takes approximately 52 seconds. Each connect has a finite
Promise.race cap, requests have harness-only caps, and the shell enforces a
75-second outer timeout (with a two-second forced-kill grace). Tracked clients,
sockets, servers, and timers are cleaned up, awaiting server shutdown on success.
Success never calls `process.exit`: retained runtime handles must allow natural
exit or the outer timeout fails the run, even if assertion PASS lines appeared.
Forced exit is reserved for failures, after a bounded cleanup attempt, so an old
transport opening handle cannot keep the negative control alive.
The baseline fails fast on the first Unix case after 13 seconds;
it is not expected to run all four cases. A heavily stalled host can fail the
timing tolerance; this is intentionally visible rather than silently skipped.

## Required uncooperative upgraded peer (also available in focused mode)

```sh
PROOF_LOG=docs/proofs/connection-startup-2026-09-06/terminate-uncooperative-new.txt \
  bash docs/proofs/connection-startup-2026-09-06/demo.sh --uncooperative packages/transport/dist/index.mjs
# Optional focused negative control against a preserved artifact:
PROOF_LOG=docs/proofs/connection-startup-2026-09-06/terminate-uncooperative-baseline-new.txt \
  bash docs/proofs/connection-startup-2026-09-06/demo.sh --uncooperative "$BEFORE_ARTIFACT"
```

The normal run requires this case to pass and runs it concurrently with both
healthy recovery cases. Focused mode runs only this case under a 20-second shell
cap (plus two-second kill grace). A positional artifact or `TRANSPORT_ARTIFACT`
selects the entry. A raw TCP peer performs the real HTTP 101 handshake, then
consumes masked WebSocket frames without replying, including ignoring any close
frame. It never supplies a schema hello. No WebSocket library acknowledges close.

Caller rejection must be `TransportConnectionError` in 9–13 seconds. Underlying
TCP close must be observed within **1,500ms after that rejection, before harness
cleanup**. The close timestamp is checked, not merely whether the polling loop
noticed closure. A close frame is diagnostic only: supported hard termination
need not send one. Rejection or a close frame alone cannot pass this case.
The raw parser unmasks payloads and assembles fragmented messages independently
of the WebSocket server library: exactly one schema hello, zero decoded
application requests, and exactly one accepted connection are required.
These counters establish no request/retry during the observed attempt, not an
unlimited future guarantee. Runtime version is printed for interpretation.

## Evidence and limits

Stdout includes the selected artifact path, its SHA256, and runtime version.
`PASS` lines record measured elapsed milliseconds and assertions. `FAIL` exits
nonzero, including the explicit baseline deadline failure. The commands above
capture real readable output; no live transcript is claimed until they run.
Only syntax checks were performed by the proof author; the parent runs the slow
before/after demonstrations.

These are controlled transport peer behaviors, **not a real daemon replay server
or desktop**. The healthy peer implements only hello and a minimal inventory
response. No requests on stalled connections means no effects were dispatched
by this harness; it does not prove remote desktop state or effect rollback.
There are no automatic retries, no production request deadlines, and
cancellation is not remote rollback. Both healthy transport lifetimes are tested,
but neither healthy peer is a production daemon. Existing `without.txt`,
`with.txt`, `after.txt`, and `uncooperative-before.txt` are historical evidence,
not verification of the strengthened contract. Preserve the historical RED
uncooperative result; even earlier PASS output does not establish this revision
passed. None of those transcripts was changed. `demo.sh` refuses an existing
`PROOF_LOG` path; choose another new filename for each rerun.

Final live verification passed on September 6, 2026. See
[final-harddrop-green.txt](final-harddrop-green.txt): the freshly built artifact
rejected all four stalled transports near 10 seconds; the uncooperative peer's
TCP connection closed 0ms after rejection, before cleanup; healthy Unix and
WebSocket connections remained usable beyond 10.5 seconds. The outer command
returned exit code 0 after natural process exit. Artifact SHA256 is recorded in
the transcript. The complete build/lint/typecheck/test gate passed 19/19,
including 97 transport tests. The [final mutation gate](final-mutations.txt)
ran all 223 mutations with none surviving. Two independent final source/evidence reviews
reported no remaining must-fix issues. A clean consumer installation of the
packed transport and protocol-types tarballs also imported `connect` successfully
with runtime dependencies installed by npm (`--ignore-scripts`); this checks
package loading, not a production desktop connection. The lockfile change only
promotes the existing `ws` 8.18.3 resolution to a runtime dependency.
These results do not extend the scope beyond the controlled transport peers
described above.

Syntax checks are also available independently:

```sh
node --check docs/proofs/connection-startup-2026-09-06/proof.mjs
bash -n docs/proofs/connection-startup-2026-09-06/demo.sh
```
