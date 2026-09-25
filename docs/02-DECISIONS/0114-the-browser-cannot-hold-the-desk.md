# ADR-0114: The browser cannot hold the desk

Date: 2026-09-23
Status: Accepted. Implemented on `fix/cdp-liveness-and-truth`; proof in [cdp-liveness](../proofs/cdp-liveness/README.md).

## Context

The 2026-09-23 audit ([PROJECT-AUDIT](../audits/2026-09-23/PROJECT-AUDIT.md), C1, C3, H1) found three faults in the Chrome (CDP) backend:

- A page showing `alert()`, or a page stuck in a loop, left every CDP call waiting forever. All requests share one serialised chain, so every client of the daemon waited too.
- The change stream and every effect ran in the page's own JavaScript world. A page script could see the binding, call it, and forge change events.
- Text writes assigned `this.value` and read the same property back. React's value tracker never saw the change, so the daemon reported success while the application state stayed empty.

ADR-0113 says a refusal must say whose fault it is, and daemon faults must not be passed off as something else. These faults did worse than misclass a refusal: they gave no answer at all, or gave a false success.

## Decision

1. **Every wait on the debugging socket is bounded.** HTTP discovery, WebSocket opening and every RPC get a fixed internal deadline of 10 s (`CDP_CALL_DEADLINE_MS`). It is not configurable and not on the wire. One listener per socket and one pending-call map replace the per-call listeners. Late replies are ignored. Closing the socket rejects everything pending and clears the timers.
2. **A page that will not attach in 1.5 s is refused.** On attach the daemon sends `Page.enable` and then `Page.getFrameTree`, each with a 1.5 s deadline. Chrome 151 does not report a dialog that was already open before the daemon attached, and `Page.enable` does not answer while that dialog is open (amendment A1, measured live). A cold attach behind a dialog is therefore refused as `DeadlineExceeded`, with wording that says the page "may be showing a dialog or be busy; nothing was changed by this call". A page that is merely busy for more than 1.5 s at attach is refused the same way. That is the accepted cost.
3. **An open dialog refuses at once.** `Page.javascriptDialogOpening` is handled centrally, whether or not a watch listens. Calls pending on that target reject with `DialogBlockingError`, new calls refuse immediately, and `Page.javascriptDialogClosed` lets calls through again. The daemon never answers or dismisses a dialog; that decision belongs to a person.
4. **Refusals say what is known.** Deadline and dialog outcomes on both effect and observe paths are handler-level refusals, never `BACKEND_UNREADABLE_REFUSAL`. They are classed `DeadlineExceeded` and `BlockedByDialog` in the internal audit vocabulary; `refusalClass` stays off the wire until ADR-0113's schema lands. When the effect call had already been sent, the refusal says its outcome is UNKNOWN and to look before retrying. Otherwise it says nothing was changed.
5. **Daemon code runs in its own world.** The stream binding (`executionContextName`), the document-start script (`worldName`), evaluations, node resolution, event retrieval, teardown and every effect/readback run in an isolated world named `mastra-cc`. It is created per document for the main frame and recreated after navigation or when contexts are cleared. Binding calls are accepted only from that world's context. Scope is main frame only. Chrome resolves a same-origin iframe node into the main-frame world instead of rejecting it (amendment A2), so every injected function first checks `this.ownerDocument === document`. Effects on an iframe element refuse with `EffectUnsupportedError`, and watches on one end. Child-frame support is left for later.
6. **A write is claimed only as far as it was seen.** `setElementText` and numeric writes use the element prototype's native `value` setter and dispatch bubbling `input`/`change`. They then wait at least 20 ms and two animation frames, capped at 50 ms. The 20 ms floor exists because two frames can pass in under 10 ms (measured: a 10 ms revert was missed in 1 of 6 live runs without it); the 50 ms cap exists because background tabs throttle `requestAnimationFrame`. A separate awaited call then rereads the value. Success means **the DOM value was observed equal to the request after the settle window**, compared as exactly `String(requested)`. Anything else is `WriteNotObservedError` naming the value that was seen. This is not proof of application state. A component that reverts after the window, or keeps the DOM value while rejecting the change internally, is outside the guarantee.

## Consequences

- Good: a dialog or stall on one page no longer silences the whole desk. Proof: 3–4 ms dialog refusals while the alert is open, and a 1.5 s refusal on attach.
- Good: a page can no longer see or forge the daemon's instrumentation.
- Good: React-controlled fields get the text, and filtered or reverted writes are refused, naming what the page kept.
- Limitation, accepted: request serialisation is unchanged, so a page that stalls without a dialog still holds other clients for up to 10 s.
- Limitation, accepted: a busy page is refused at attach after 1.5 s, and its refusal cannot say for certain whether a dialog is the cause.
- Limitation: each effect write now takes up to about 50 ms longer, the length of the settle window.

## Evidence

- [cdp-liveness proof](../proofs/cdp-liveness/README.md): eight scenarios RED on base `bb9b89c`, GREEN on the branch.
- Related: [ADR-0113](0113-every-refusal-says-whose-it-is.md).
