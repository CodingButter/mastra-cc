# ADR-0100: One connection owns desktop effects

Date: 2026-09-07
Status: Accepted — bounded connection-ownership slice of CC-05

## Evidence

A serialized request queue does not own a multi-step task. Four real Unix/WebSocket client pairings reproduced two connections alternating effects. The built-server proof repeats all pairings across twelve sessions with a scripted effect sink, not a live desktop.

## Decision

A backend instance has one connection-bound driver authority shared by its Unix and WebSocket listeners. The first non-observe method attempt claims that authority. Claims grant no new capability: existing per-method, application, visibility, raw-input and attestation checks still run. A refused attempt may retain the connection's claim; disconnect releases it when quiescent.

Other connections may invoke observe-class methods under the existing grants. Every non-observe dispatch entry, including launch/restart, caret movement and window navigation, passes the common ownership gate. The gate runs both when the request arrives and when queued work starts. The trusted in-process handleRequest test seam has no connection identity; external peers cannot choose or omit their server-created identity.

Disconnect permanently retires that connection generation and invalidates queued work. If its operation is active, ownership remains reserved until the operation settles; a replacement driver cannot overlap it. There is no lease timeout or automatic replay. The wire shape is unchanged; protocol 1.22.0 describes the new ownership semantics and regenerates bindings.

## Boundaries and next CC-05 slice

This is not a cancellation primitive. An already-running backend operation may still emit input after disconnect; it must settle before authority transfers. Native per-emission cancellation checkpoints, suppression of pending focus restoration on human takeover, explicit human revocation/resumption, and the specialist's complete-task queue remain required follow-up work. Read the desktop afresh after uncertainty; this slice does not enforce an observation watermark.

One authority is shared per backend instance inside this process. Deploy one daemon authority per OS desktop. Separate backend wrappers, other daemon processes and unrelated OS automation are outside this bound; no global exclusivity is claimed. The demo's existing task-control state is not yet replaced by this connection-level gate.

## Verification

[CC-05 proof](../proofs/reliability-remediation/cc05/README.md) covers real Unix and WebSocket listeners, blocked competing methods, continued read-only access, disconnected queued work, and quiescent transfer. Regression and deletion-mutation gates supplement the built-artifact demonstration. Neither native cancellation nor human takeover is claimed proven.
