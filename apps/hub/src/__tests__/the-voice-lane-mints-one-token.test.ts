// ONE TOKEN, ONE DIAL, AND A REFUSAL FOR EVERY WAY IT CAN GO WRONG.
//
// Every one of these is offline against a stubbed provider seam. Live evidence
// against the real account is Phase 4's job, and it is a different kind of
// claim: these tests say the lane behaves this way always, the transcripts say
// the provider behaved that way once. Neither substitutes for the other.
//
// Every credential in this file is fictitious, and the "tokens" the stub mints
// are shaped like the real ones so that the log-sink assertion has something
// real-shaped to fail on.

import { describe, expect, it } from "vitest";
import { createVoiceLane, REFUSAL_CODES, verdictOnClose, type CredentialStore } from "../voice/mint.js";

const FICTITIOUS_KEY = "AQ.not-a-real-key-0000000000000000000000";
const MODEL = "gemini-2.5-flash-native-audio-latest";

function store(accounts: Record<string, string>): CredentialStore {
  return { credentialFor: (account) => accounts[account] };
}

const held = store({ google: FICTITIOUS_KEY });

/** A sink that keeps everything, so a test can ask what the lane said rather than what its source looks like. */
function sink(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line) => lines.push(line) };
}

/** The mint's real answer shape, measured: `{"name": "auth_tokens/<id>"}` and nothing else. */
function mintedName(n: number): string {
  return `auth_tokens/fictitious-${n}-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("the voice lane mints one token", () => {
  it("two dials produce two mints, because a lane that remembers a token is a lane that reuses one", async () => {
    const bodies: string[] = [];
    let minted = 0;
    const lane = createVoiceLane({
      credentials: held,
      model: MODEL,
      log: sink().log,
      fetchImplementation: async (_url, init) => {
        bodies.push(String((init as RequestInit).body));
        minted += 1;
        return respond(200, { name: mintedName(minted) });
      },
    });

    const first = await lane.dial();
    const second = await lane.dial();

    expect(minted).toBe(2);
    expect(first.ok && second.ok).toBe(true);
    // Not merely "two calls happened" - two DIFFERENT tokens came back. A lane
    // that minted twice and handed out the first token twice would pass a call
    // count and fail this.
    expect(first.ok && second.ok && first.token).not.toBe(second.ok && second.token);

    // And each mint asked for a single use and a window. The window is asked
    // for, never asserted about afterwards: the response carries no expiry to
    // check it against, which is why the lane advertises no lifetime.
    for (const body of bodies) {
      const parsed = JSON.parse(body) as { uses: number; expireTime: string };
      expect(parsed.uses).toBe(1);
      expect(Date.parse(parsed.expireTime)).toBeGreaterThan(Date.now());
    }
  });

  it("no account attached is refused as NO_GOOGLE_ACCOUNT, and nothing is dialled to find out", async () => {
    let called = 0;
    const lane = createVoiceLane({
      credentials: store({}),
      model: MODEL,
      log: sink().log,
      fetchImplementation: async () => {
        called += 1;
        return respond(200, { name: mintedName(1) });
      },
    });

    const outcome = await lane.dial();

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.code).toBe("NO_GOOGLE_ACCOUNT");
    expect(outcome.status).toBe(409);
    expect(outcome.refusal).toContain("409 NO_GOOGLE_ACCOUNT");
    // It names the ACCOUNT, which is the one thing an agent may learn about it.
    expect(outcome.refusal).toContain('"google" account');
    expect(called).toBe(0);

    // The closed set, asserted as a set: a fourth code cannot appear unnoticed.
    expect([...REFUSAL_CODES]).toEqual(["NO_GOOGLE_ACCOUNT", "CREDENTIAL_REJECTED", "UPSTREAM_UNAVAILABLE"]);
  });

  it("a rejected credential relays the status, sanitises the provider's text, and is not retried", async () => {
    // Google's real 401 body, as measured against the live endpoint with a bad
    // key. It is here so the sanitisation assertion has the actual prose to
    // fail against rather than an invented placeholder.
    const REAL_401_PROSE = "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.";
    let attempts = 0;
    const captured = sink();
    const lane = createVoiceLane({
      credentials: held,
      model: MODEL,
      log: captured.log,
      fetchImplementation: async () => {
        attempts += 1;
        return respond(401, { error: { code: 401, status: "UNAUTHENTICATED", message: REAL_401_PROSE } });
      },
      sleep: async () => {
        throw new Error("a credential rejection must not reach the backoff");
      },
    });

    const outcome = await lane.dial();

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.status).toBe(401);
    expect(outcome.code).toBe("CREDENTIAL_REJECTED");
    // ONE attempt. ADR-0006: a retry loop around a 401 hammers an account into
    // a lockout, so the loop must not close around this status.
    expect(attempts).toBe(1);

    const everythingSaid = [outcome.refusal, ...captured.lines].join("\n");
    expect(everythingSaid).not.toContain(REAL_401_PROSE);
    expect(everythingSaid).not.toContain("OAuth");
    expect(everythingSaid).not.toContain("login cookie");
  });

  it("a transient failure is retried with bounded backoff and gives up by name", async () => {
    let attempts = 0;
    const waits: number[] = [];
    const captured = sink();
    const lane = createVoiceLane({
      credentials: held,
      model: MODEL,
      log: captured.log,
      fetchImplementation: async () => {
        attempts += 1;
        return respond(503, { error: { code: 503, status: "UNAVAILABLE", message: "The service is currently unavailable." } });
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    const outcome = await lane.dial();

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(outcome.status).toBe(503);
    // BOUNDED, and bounded in both senses: a finite number of attempts, and a
    // backoff that grows. An unbounded lane passes "it retried" and fails this.
    expect(attempts).toBe(3);
    expect(waits).toEqual([200, 400]);
    expect(outcome.refusal).toContain("(UPSTREAM_UNAVAILABLE)");
    expect(captured.lines.at(-1)).toContain("giving up");

    // A transient failure that recovers still yields one token for one dial.
    let second = 0;
    const recovering = createVoiceLane({
      credentials: held,
      model: MODEL,
      log: sink().log,
      fetchImplementation: async () => {
        second += 1;
        return second === 1 ? respond(429, { error: { code: 429 } }) : respond(200, { name: mintedName(9) });
      },
      sleep: async () => {},
    });
    const recovered = await recovering.dial();
    expect(recovered.ok).toBe(true);
    expect(second).toBe(2);
  });

  it("nothing the mint touched appears in any log sink", async () => {
    const captured = sink();
    const lane = createVoiceLane({
      credentials: held,
      model: MODEL,
      log: captured.log,
      fetchImplementation: async () => respond(200, { name: mintedName(1) }),
    });

    const outcome = await lane.dial();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");

    // Vacuity guard: the lane must have SAID something, or this test passes by
    // virtue of an empty sink. A silent lane is not a lane that keeps secrets.
    expect(captured.lines.length).toBeGreaterThan(0);

    const everything = captured.lines.join("\n");
    // The minted token, the long-lived key, and the two shapes either of them
    // takes. By class, not only by literal: any long opaque run of token
    // characters is a finding regardless of which token it came from.
    expect(everything).not.toContain(outcome.token);
    expect(everything).not.toContain(FICTITIOUS_KEY);
    expect(everything).not.toContain("auth_tokens/");
    expect(everything).not.toMatch(/AQ\.[A-Za-z0-9_-]{8,}/);
    expect(everything).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    // It does say what happened, which is the point of a log.
    expect(everything).toContain(MODEL);
  });

  it("an expiry seen at close is a different outcome from a rejection seen at dial", () => {
    // Measured during planning: an expired token does not fail the dial - it
    // surfaces when the session CLOSES. The remedies differ, so the outcomes
    // must, or a client sends a person to fix an account that is fine.
    expect(verdictOnClose("Token has expired.")).toBe("expired-remint");
    expect(verdictOnClose("Request contains an invalid argument.")).toBe("closed");
    expect(verdictOnClose("")).toBe("closed");
  });
});
