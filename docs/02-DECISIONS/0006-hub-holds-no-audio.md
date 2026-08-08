# ADR-0006 — The hub holds no audio

**Status:** accepted
**Date:** 2026-08-08
**Carried forward from the prototype unchanged.**

## Context

The obvious architecture for a voice assistant with a central brain is: microphone → brain → provider → brain → speaker. It is obvious, it is easy to build, and it is wrong here for three reasons.

**Privacy.** A hub that relays audio is a device that holds a recording of everything said in the room, however briefly. That is a fundamentally different object to reason about, to secure, and to explain to a person than a hub that holds text.

**Latency.** Every hop through the hub adds delay to a conversational turn, where delay is the whole quality bar.

**Topology.** The product is *one brain, many clients* — a phone on the couch, a tray widget on the desk. Relaying every device's audio through one process makes the hub a bottleneck sized by the number of ears rather than by the amount of thinking.

The prototype resolved this by inverting who dials. The **device** opens the connection to the voice provider directly. The **hub** mints a short-lived token for that specific session and hands it over. The provider key itself never leaves the hub, and no audio ever enters it.

The supporting mechanics, all of which are load-bearing and were arrived at by fixing bugs:

- **Mint before each dial**, not once per boot. A token has a short TTL and a new-session window; a stale token is a redial failure, not a reused credential.
- **No provider account attached → an honest refusal.** `409 NO_GOOGLE_ACCOUNT` rather than a mysterious silence.
- **Redial only on transient errors**, with a bounded backoff schedule. A credential rejection is not transient and must not be retried in a loop.
- **A token in a log file is a token.** The token handler in the prototype carries that comment because the temptation to log the mint response for debugging is constant.

## Decision

**No audio byte ever enters the hub process. Devices dial the voice provider directly using a short-lived token minted by the hub, per session.**

Enforced by:

- **Boundary B2:** a source-level test over the hub package asserting no audio API import, no audio buffer type, and no provider audio endpoint URL.
- **Boundary B3:** clients hold no long-lived provider credential; a runtime test asserts that a client presenting its own key is refused.
- **Mint discipline:** one mint per dial, TTL enforced server-side, and the mint response never logged.

**The hub still owns everything that is not audio:** which provider, which voice, the session lifecycle, the lane events, and the text of what was said once the provider returns it.

## Consequences

**Good.** The privacy claim is structural rather than procedural — the hub cannot leak audio it never receives. Latency is one hop. Adding a fourth listening device costs the hub a token mint, not a stream.

**Cost.** Token minting is now on the critical path of every conversation, so its failure modes are conversational failure modes. This is why the refusals are explicit (`409 NO_GOOGLE_ACCOUNT`) and why the retry schedule is bounded and only for transient classes.

**Cost.** Provider selection is constrained to providers that support a client-side ephemeral credential. The prototype shipped two provider integrations under this model, so the constraint is real but not narrow.

**Accepted limitation.** The provider sees the audio. This architecture protects the audio from *us*, not from the provider the user chose. That should be said plainly in the product's own consent copy rather than implied.

## Evidence

| Claim | Source |
|---|---|
| hub = brain, zero audio; devices dial directly with a minted token | prototype architecture, maintained throughout |
| mint before each dial | mouth implementation; redial path |
| short TTL and new-session window | token mint constants |
| `409 NO_GOOGLE_ACCOUNT` on missing credential | hub mint route |
| bounded retry, transient only | mouth redial policy with a fixed backoff schedule |
| "a token in a log file is a token" | widget `connection.js` mint handler comment |
| second provider integration under the same model | PR #216 (closes issue #170), OpenAI realtime provider |
| device-side consent gesture | `getUserMedia` at ears-start; see [ADR-0005](0005-wake-is-enrolment-first-fingerprinting.md) |
