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
import { createVoiceLane, REFUSAL_CODES, verdictOnClose, type CredentialStore, type DialOutcome } from "../voice/mint.js";

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

    // The closed set, asserted as a set: a fifth code cannot appear unnoticed.
    expect([...REFUSAL_CODES]).toEqual(["NO_GOOGLE_ACCOUNT", "CREDENTIAL_REJECTED", "MINT_REFUSED", "UPSTREAM_UNAVAILABLE"]);
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

  it("a failure the lane cannot attribute is not blamed on the credential", async () => {
    // Review's catch: every non-transient status left the loop as
    // CREDENTIAL_REJECTED, so a project with the API switched off, a body the
    // provider stopped accepting, or an endpoint that moved all told a person
    // to go fix a key that was never the problem. The 409 is the sharpest of
    // them - it is this lane's OWN status for "no account attached", and a
    // client is told to branch on that field.
    const unattributable = [400, 404, 409, 418];
    for (const status of unattributable) {
      let attempts = 0;
      const captured = sink();
      const lane = createVoiceLane({
        credentials: held,
        model: MODEL,
        log: captured.log,
        fetchImplementation: async () => {
          attempts += 1;
          return respond(status, { error: { code: status, status: "FAILED_PRECONDITION", message: "some prose about the request" } });
        },
        sleep: async () => {
          throw new Error("an unattributable refusal must not reach the backoff");
        },
      });

      const outcome = await lane.dial();

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error("unreachable");
      expect(outcome.status).toBe(status);
      expect(outcome.code).toBe("MINT_REFUSED");
      expect(attempts).toBe(1);
      // The status is the whole of what was observed, so the sentence may not
      // name a cause - and may not carry the provider's prose either.
      expect(outcome.refusal).not.toContain("credential was not accepted");
      expect([outcome.refusal, ...captured.lines].join("\n")).not.toContain("some prose about the request");
    }

    // A 409 from the provider and this lane's own 409 are told apart by the
    // code, which is the field that carries the meaning.
    const noAccountLane = createVoiceLane({
      credentials: { credentialFor: () => undefined },
      model: MODEL,
      log: sink().log,
      fetchImplementation: async () => {
        throw new Error("nothing is dialled when there is no account");
      },
    });
    const noAccount = await noAccountLane.dial();
    expect(noAccount.ok).toBe(false);
    if (noAccount.ok) throw new Error("unreachable");
    expect(noAccount.status).toBe(409);
    expect(noAccount.code).toBe("NO_GOOGLE_ACCOUNT");
  });

  it("a 200 whose body is not a token is an outcome, not a thrown error", async () => {
    // Review's catch: the body was parsed OUTSIDE the try that guards the
    // request, so a gateway answering 200 with an HTML error page rejected out
    // of dial() - past a caller that had handled every refusal code there is,
    // carrying a stack from the request that had the key in a header.
    let attempts = 0;
    const captured = sink();
    const lane = createVoiceLane({
      credentials: held,
      model: MODEL,
      log: captured.log,
      fetchImplementation: async () => {
        attempts += 1;
        return new Response("<html><body>502 Bad Gateway</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
      sleep: async () => {},
    });

    // The assertion is that this RESOLVES. A rejection here is the bug.
    const outcome: DialOutcome = await lane.dial();

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    // An unreadable answer is not an accusation against the credential: the
    // lane saw a 200 and could not read it, which is not evidence about a key.
    expect(outcome.code).not.toBe("CREDENTIAL_REJECTED");
    expect(outcome.code).toBe("UPSTREAM_UNAVAILABLE");
    // Unreadable is transient by treatment - it retried rather than giving up
    // on one bad proxy answer.
    expect(attempts).toBe(3);
    // And nothing of the gateway's page travels, by the same rule that keeps a
    // provider's prose out of a refusal.
    expect([outcome.refusal, ...captured.lines].join("\n")).not.toContain("Bad Gateway");
    // Second review round: routing the unreadable body to the no-token branch
    // made the lane log that it READ a body it could not read. The outcome is
    // right and the sentence was false, which is the same defect the digest
    // check was just fixed for.
    expect(captured.lines.join("\n")).toContain("a body this lane could not read");
    expect(captured.lines.join("\n")).not.toContain("in a body it could read");
  });

  it("a body the lane read and a body it could not are not reported as the same thing", async () => {
    // The two causes reaching the no-token branch are different facts about
    // where the failure is: one is an endpoint answering without a token, the
    // other is something in front of it answering instead. They share an
    // outcome deliberately; sharing a sentence was the defect.
    const captured = sink();
    const lane = createVoiceLane({
      credentials: held,
      model: MODEL,
      log: captured.log,
      // Valid JSON, parses fine, simply carries no token name.
      fetchImplementation: async () =>
        new Response(JSON.stringify({ note: "no token here" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      sleep: async () => {},
    });

    const outcome: DialOutcome = await lane.dial();

    expect(outcome.ok).toBe(false);
    const said = captured.lines.join("\n");
    expect(said).toContain("no token name in a body it could read");
    expect(said).not.toContain("could not read");
  });

  it("a credential the provider forbids is a rejected credential, and is still not retried", async () => {
    // 403 belongs with 401 and not with the unattributable statuses: the
    // provider looked at this key and said no. Same remedy, same no-retry rule.
    let attempts = 0;
    const lane = createVoiceLane({
      credentials: held,
      model: MODEL,
      log: sink().log,
      fetchImplementation: async () => {
        attempts += 1;
        return respond(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "denied" } });
      },
      sleep: async () => {
        throw new Error("a credential rejection must not reach the backoff");
      },
    });

    const outcome = await lane.dial();

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.status).toBe(403);
    expect(outcome.code).toBe("CREDENTIAL_REJECTED");
    expect(attempts).toBe(1);
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

  // BOUNDARY B3, RUNTIME HALF. The source half of B3 - no client scans a
  // credential onto the wire - has no client to scan until M4, so it stays
  // unwired rather than passing vacuously over an empty file set. What CAN be
  // pinned today is the behaviour the boundary exists for: a credential
  // presented by a caller is not honoured. ADR-0007 amendment A13 deleted the
  // prototype's presentable grant key on exactly this reasoning - "a key an
  // agent can present is a key an agent can be tricked into presenting".
  //
  // NOT IN THE MUTATION TABLE, and the reason is a property of the runner
  // rather than an oversight: mutations delete, and honouring a presented
  // credential requires ADDING a parameter and a fallback. So this one was
  // bitten by hand instead - the presented key wired in as `presented ??
  // credentials.credentialFor(...)`, which turned this test and only this test
  // red, and was restored. The type surface is the other half of the guard:
  // `dial()` declares no parameters, so an honest caller cannot pass one.
  it("a credential presented by a caller is ignored, and cannot rescue a dial the hub has no key for", async () => {
    const PRESENTED = "AQ.presented-by-the-caller-999999999999";

    // One: with a key held, the presented one is not the one that travels.
    const headers: string[] = [];
    const lane = createVoiceLane({
      credentials: held,
      model: MODEL,
      log: sink().log,
      fetchImplementation: async (_url, init) => {
        headers.push(String(((init as RequestInit).headers as Record<string, string>)["x-goog-api-key"]));
        return respond(200, { name: mintedName(1) });
      },
    });

    // The surface offers nowhere to put it: `dial` declares no parameters. The
    // cast is the test being adversarial on a client's behalf - TypeScript
    // would stop an honest caller, and this asserts the runtime does too.
    await (lane.dial as (credential?: string) => Promise<unknown>)(PRESENTED);

    expect(headers).toEqual([FICTITIOUS_KEY]);
    expect(lane.dial.length).toBe(0);

    // Two, and this is the half that matters: with NO key held, a presented one
    // does not become the key. The refusal is the same refusal - a caller
    // cannot supply what the hub was not given.
    let called = 0;
    const empty = createVoiceLane({
      credentials: store({}),
      model: MODEL,
      log: sink().log,
      fetchImplementation: async () => {
        called += 1;
        return respond(200, { name: mintedName(2) });
      },
    });

    const outcome = await (empty.dial as (credential?: string) => Promise<DialOutcome>)(PRESENTED);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.code).toBe("NO_GOOGLE_ACCOUNT");
    expect(called).toBe(0);
    expect(outcome.refusal).not.toContain(PRESENTED);
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
