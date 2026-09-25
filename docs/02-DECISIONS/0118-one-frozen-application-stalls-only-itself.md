# ADR-0118: One frozen application stalls only itself

Date: 2026-09-25
Status: Accepted. Proof in [per-target-queues](../proofs/per-target-queues/README.md). Completes the global-chain half of audit item C3; [ADR-0114](0114-the-browser-cannot-hold-the-desk.md) and [ADR-0117](0117-a-silent-application-is-refused-in-time.md) bounded each call.

## Context

Every backend call waited in one daemon-wide queue. A per-call deadline bounds how long a frozen application can hold that queue, but while it is held, every client is held with it, including clients asking about other applications.

## Decision

Calls queue by **target**. The target is the application that owns the request's element, or else the application its scope names.

- On one target, calls run one at a time, in arrival order.
- Calls on different targets do not wait for each other.
- A call that names no single target (an unscoped `queryElements`, `listApplications`) runs on its own spanning queue. Each application it reaches is bounded by the backend's per-call deadline.
- **One connection's requests still run in the order it sent them**, across targets. `serveConnection` dispatches a connection's requests one after another. This keeps ADR-0106's ordering promise to each client.
- **Effects stay exclusive across the desk without a desk-wide queue.** The CC-05 lease lets only one connection drive, and that connection's requests run one after another. So no two effects ever run at once. Only observations from *other* connections run beside the driver's work.
- `DriverAuthority` counts running requests per connection instead of holding one desk-wide slot, so a disconnect still waits until that connection's own work has settled.
- An idle queue is forgotten, so the queue map is bounded by the work in flight.

## Consequences

- With one application frozen, another client's call on a different application, or an unscoped call, answers in milliseconds instead of waiting up to the deadline.
- Backends now serve observations on different applications concurrently. Their shared state (element memory, attribution maps) is only touched synchronously between awaits, so interleaving does not corrupt it. The full daemon suite and the live lanes cover this, but it is a new condition for backend code to respect.
- An unscoped call and a scoped call on the same application may run at once. They share no queue.
