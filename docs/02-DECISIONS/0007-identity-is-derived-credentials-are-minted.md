# ADR-0007 — Identity is derived, credentials are minted

**Status:** accepted
**Date:** 2026-08-08
**Carried forward from the prototype unchanged.**

## Context

Jamie's ruling on this, recorded verbatim in the prototype roadmap and treated as binding throughout:

> **"Never give the key to the agent or they'll try it on every door."**

The failure mode it guards against is not malice. It is that an agent handed a general-purpose credential will use it generally — not because it is adversarial, but because a credential that opens many doors is indistinguishable, from inside the agent, from permission to open them.

The prototype landed the corresponding identity rule on day two: **identity is given, not claimed**. A client does not announce who it is. The hub derives the identity from the connection itself.

The admission paths that survived the week:

- **Loopback**, for a client on the same machine as the hub.
- **A WebSocket subprotocol carrying a device id and a per-device secret**, for a client that is not.

Neither path lets a client assert a user. Both let the hub establish one.

A related decision, arrived at by removal: an early design had a **grant key** the agent could present to widen its own scope. It was deleted (amendment A13, issue #72). A key an agent can present is a key an agent can be tricked into presenting.

## Decision

**Three rules, all enforced rather than documented:**

1. **Identity is derived from the connection, never from a claim in the payload.** The transport establishes who; the payload only says what.
2. **Long-lived credentials live in the hub and are never handed to an agent or a client.** What travels is a token minted for one purpose, with a short TTL. See [ADR-0006](0006-hub-holds-no-audio.md) for the voice case, which is the sharpest example: the provider key never leaves the hub even though the audio never enters it.
3. **The tool surface handed to a model is enumerated and read-only by default.** The prototype's minted desktop tool set was exactly `READ_FILE`, `LIST_FILES`, `FILE_STAT`, `GREP`. Adding the ability to launch an application was tracked as its own open issue (#183) rather than slipping in as a convenience — and notably, the *protocol* already exposed `listInstallableApplications` and `launchApplication`, so the restraint was in the tool minting, not in the wire. That separation is the pattern: the protocol may be capable; the minted surface is what the model actually gets.

**Additionally, from the prototype's user-registry work (issue #116):** access is **deny by default**, with a live toggle. A user who has not been admitted is not admitted, and admitting them does not require a restart.

## Consequences

**Good.** A compromised or confused agent cannot widen its own reach, because it holds nothing that would let it. Scope changes are decisions made by the hub in response to a request, which means they are auditable events rather than silent capability growth.

**Cost.** Every capability the agent needs must be explicitly minted, which makes adding capabilities deliberately slow. That is the intended shape — the prototype's launch-application question stayed open for days precisely because the mechanism made "just add it" impossible to do accidentally.

**Risk.** A minting layer can be made permissive by a single well-meaning default. Mitigation: the minted tool list is asserted by test, so widening it is a visible diff in a file whose only job is to name what agents may do.

## Evidence

| Claim | Source |
|---|---|
| "Never give the key to the agent…" | prototype `ROADMAP.md`, quoted verbatim |
| identity given, not claimed | commit `08-02 03:02`, merged as PR #1 / #19 |
| admission via loopback or device subprotocol | hub admission implementation |
| grant key removed | amendment A13, issue #72 |
| minted tool surface = READ_FILE / LIST_FILES / FILE_STAT / GREP | hub token-mint tool list |
| launch capability tracked separately | issue #183, open at pivot |
| protocol already exposes `listInstallableApplications` / `launchApplication` | the **prototype's** schema, 33 methods — not this repository's `protocol/schema.json`, which carries 13 and names the pair `listApplications` / `openApplication` (corrected 2026-08-21; the row read as a citation into our own file) |
| deny-by-default user registry with live toggle | issue #116, closed by PR #144 |
