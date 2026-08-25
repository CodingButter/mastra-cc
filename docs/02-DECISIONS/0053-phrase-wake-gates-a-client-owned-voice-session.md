# ADR-0053 — Phrase wake gates a client-owned voice session

**Status:** accepted
**Date:** 2026-08-25
**Supersedes:** ADR-0005's speaker-enrolment admission design. ADR-0005's rejection of transcription-as-wake and ADR-0006's client-to-provider topology remain accepted.

## Context

Speaker-specific template matching did not generalize reliably enough for the intended interaction: wake Mastra, ask naturally, continue talking, then explicitly dismiss it. Identity was also the wrong question. The system needs reasonable confidence that the phrase was spoken, followed by strong confidence that the complete opening was addressed to Mastra.

A separate hub classifier created a second model call and a dead period between capture and conversation. It also required provisional audio to cross the hub solely to make the same conversational decision the realtime model must immediately understand again.

## Decision

1. The client runs phrase-only wake detection locally. No transcription or speaker identity participates in wake.
2. After wake, the client buffers one bounded, complete opening in memory. Chromium owns the one microphone through `getUserMedia` with echo cancellation and noise suppression; an AudioWorklet emits aligned 16 kHz PCM frames.
3. The client requests one short-lived, single-use provider dial from the hub. The hub receives no provisional or realtime audio.
4. The client opens one constrained Gemini Live session, locally hands off the buffered opening once as paced frames, marks the opening complete, and withholds live microphone continuation until admission. This is a client-ownership guarantee, not provider-receipt acknowledgement.
5. The realtime session initially exposes exactly two conversational controls: `admit_conversation` and `stop_listening`. It must remain silent for incidental, ambiguous, addressed-elsewhere, or dismissed speech. One valid terminal control wins; malformed, conflicting, duplicate, absent, timed-out, or failed decisions close provisionally and return to armed idle.
6. Provider audio is suppressed before admission. On admission, the same session continues and the existing microphone source attaches. Follow-up speech requires no wake or second admission decision.
7. Gemini has no desktop tools or execution authority. It sends requests to the background orchestrator and receives sanitized status signals. The orchestrator owns execution, retries, authorization, and truth. Background signals never interrupt model speech; priority controls delivery at the next safe boundary.
8. Actual user speech alone refreshes the 60-second inactivity clock. Heartbeat, pong, model output, admission work, transcription revisions, and generic traffic do not.
9. `never mind` and `stop` close the conversation exactly once and return to phrase-only armed idle. Dismissal neither cancels unrelated work nor disarms wake.
10. Authorization for sensitive operations remains at the execution boundary. Conversational admission never grants authority to act.
11. The lane event vocabulary remains exactly `progress`, `answer`, `voice_opened`, and `voice_closed`. Dial minting and session control are correlated carrier requests, not events.

## Ownership

- **Client:** phrase detector, provisional buffer, utterance boundary, Chromium capture/playback graph, provider socket, admission state, signal-delivery scheduling, and audio zeroization.
- **Hub:** single-use dial minting, global voice-session lifecycle, inactivity clock, orchestrator execution, authorization, and sanitized result signals.
- **Provider:** conversational admission and admitted realtime dialogue through the two-control fence; no desktop execution.

The bundled widget uses the local Unix lane and needs no pairing. Future phone and browser clients use the same capability over an authenticated network carrier. Reachability grants neither identity nor authority.

## Consequences

**Good.** Wake no longer depends on biometric enrolment. The opening is heard once by the realtime model that continues the conversation, eliminating the duplicate classifier and its dead-end caption. The hub returns to holding no audio. Chromium AEC prevents provider playback from cannibalizing the microphone while retaining real barge-in.

**Cost.** Phrase acceptance can create a short-lived provider session for incidental speech. The constrained instruction and two-control fence therefore carry the high-confidence admission policy, with a local timeout and fail-closed terminal state.

**Cost.** The client owns more realtime lifecycle behavior: paced opening delivery, provider failure cleanup, playback cancellation, microphone framing, and non-interrupting signal scheduling.

**Security boundary.** The realtime model can admit or stop a conversation and request background work. It cannot execute desktop operations, report success without an orchestrator signal, approve sensitive work, expand scope, mint daemon authority, or waive attestation.

## Evidence

- phrase-only wake and biometric removal: commit `79d2054`
- bounded provisional capture and zeroization: commit `2f72dd8`
- original hub classifier, now removed: commit `042117f`
- active follow-up, dismissal, and speech-only inactivity: commit `bee503a`
- Phase 6 product/tests/docs commit records the single-session admission pivot, priority signal scheduler, Chromium AEC graph, fail-closed provider lifecycle, and removal of the obsolete directedness wire
- failed biometric measurements remain preserved; supersession does not erase them
