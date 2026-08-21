// THE VOICE LANE'S CREDENTIAL.
//
// The arrangement this module exists to make real: the hub mints a token for
// ONE dial, the device dials the provider directly with it, and no audio byte
// ever enters this process (ADR-0006). The long-lived key stays here; the thing
// that leaves is short-lived, single-use, and useless the moment the call ends.
//
// Everything below was measured against the real account rather than assumed -
// the mint response's shape, the status a rejected key returns, and the fact
// that an expired token announces itself when the session CLOSES rather than
// when it is dialled. Where a measurement contradicted a plausible design, the
// measurement won.

/** Where the long-lived provider key lives. The same shape the model configuration uses, for the same reason: one place reads credentials. */
export interface CredentialStore {
  credentialFor(account: string): string | undefined;
}

/** The account a Google credential lives under. A refusal may name this; it may never name what is inside it. */
export const VOICE_ACCOUNT = "google";

const MINT_ENDPOINT = "https://generativelanguage.googleapis.com/v1alpha/auth_tokens";

/**
 * ONE USE. The mint accepts a use count, and one is the only honest number for
 * a token handed to a device for a single dial. Deleting this is the mutation
 * `the-token-that-outlives-its-dial`: the token stops being spent by the call
 * it was minted for.
 */
const SINGLE_USE = 1;

/**
 * The window this hub asks for.
 *
 * THE MINT RESPONSE CARRIES NO READABLE EXPIRY - measured, twice, against the
 * real account: the answer is `{"name": "auth_tokens/..."}` and nothing else,
 * whether or not an expiry is requested. So the hub asks for a short window and
 * relies on the server to enforce it, and it does NOT compute, store or
 * advertise a lifetime of its own. A number nobody can check is not a
 * guarantee, and a hub that told a client "this is good for two minutes" would
 * be reading that number off its own request rather than off the provider's
 * answer.
 */
const REQUESTED_WINDOW_MS = 2 * 60 * 1000;

/** Attempts, total, across one dial's mint. Bounded because ADR-0006 is explicit that a retry loop is how an account gets hammered into a lockout. */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [200, 400] as const;

/** The token, on its way out of the process to the device that will dial with it. It is never logged, never recorded, and never held after this returns. */
export interface DialTicket {
  readonly ok: true;
  readonly token: string;
  readonly model: string;
}

/**
 * A refusal carries a status and a NAMED code. The code is what a client
 * branches on; the sentence is what a person reads. Neither carries the
 * provider's own prose - see `sanitised`.
 */
export interface DialRefusal {
  readonly ok: false;
  readonly status: number;
  readonly code: RefusalCode;
  readonly refusal: string;
}

export const REFUSAL_CODES = ["NO_GOOGLE_ACCOUNT", "CREDENTIAL_REJECTED", "UPSTREAM_UNAVAILABLE"] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

export type DialOutcome = DialTicket | DialRefusal;

/**
 * THE PROVIDER'S TEXT DOES NOT TRAVEL. Google's 401 body is prose about OAuth
 * tokens and login cookies; a different failure's body can quote the request
 * back. Deciding which parts of somebody else's error string are safe is a
 * decision that is wrong the first time they change the format, so the status
 * travels and the prose stays here. This is the same move `models/configure.ts`
 * makes for the same reason.
 */
function sanitised(status: number, code: RefusalCode, remedy: string): DialRefusal {
  return {
    ok: false,
    status,
    code,
    refusal: `voice: the provider answered ${status} (${code}) - ${remedy}; the provider's own message is not carried here`,
  };
}

/**
 * The refusal ADR-0006 names. It is a 409 and not a 401 because nothing was
 * rejected: there is no account to reject anything, and the remedy is a human
 * attaching one rather than anybody retrying anything.
 */
function noGoogleAccount(log: (line: string) => void, model: string): DialRefusal {
  log(`voice: refusing a dial for "${model}" - NO_GOOGLE_ACCOUNT`);
  return {
    ok: false,
    status: 409,
    code: "NO_GOOGLE_ACCOUNT",
    refusal: `voice: 409 NO_GOOGLE_ACCOUNT - no credential is attached to the "${VOICE_ACCOUNT}" account, so no token can be minted for a dial; attach one to that account`,
  };
}

/**
 * A CLOSE IS NOT A DIAL.
 *
 * An expired token was observed announcing itself on the CLOSE of a live
 * session, not at dial time - the dial succeeds, the session runs, and the
 * close carries the expiry. The two are different outcomes with different
 * remedies: an expiry at close means mint again, while a rejection at dial
 * means fix the account. Collapsing them would send a client to a human for a
 * problem the next mint solves.
 */
export type CloseVerdict = "expired-remint" | "closed";

export function verdictOnClose(reason: string): CloseVerdict {
  return /token has expired/i.test(reason) ? "expired-remint" : "closed";
}

/** Only these are worth trying again. A credential rejection is NOT among them, by ADR-0006's explicit instruction. */
function transient(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface VoiceLaneOptions {
  readonly credentials: CredentialStore;
  /** The live-audio model the device will dial. Named by the operator; this module does not choose one. */
  readonly model: string;
  /** Where this lane says what it did. The token is not among the things it says - asserted by the test against this sink, not by reading this file. */
  readonly log: (line: string) => void;
  readonly fetchImplementation?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface VoiceLane {
  /** Mints a token for exactly one dial. Called again for the next dial, because that is what "short-lived" means. */
  dial(): Promise<DialOutcome>;
}

/**
 * ONE MINT PER DIAL.
 *
 * There is deliberately no cache in this closure. ADR-0006 asks for a mint
 * before each dial, and the way to guarantee that is not to guard a stored
 * token but to store none: a token minted at boot and reused is a long-lived
 * credential wearing a short-lived costume, and a lane that cannot remember a
 * token cannot reuse one. The minted token is returned to the caller and
 * referenced by nothing here afterwards.
 */
export function createVoiceLane(options: VoiceLaneOptions): VoiceLane {
  const { credentials, model, log } = options;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return {
    async dial(): Promise<DialOutcome> {
      // BOOT-TIME PRESENCE IS NOT A RUNTIME GUARANTEE. The credential is read
      // here, on the dial, because an account can lose its key, its credits or
      // its standing between boot and now.
      const credential = credentials.credentialFor(VOICE_ACCOUNT);
      // One line, so its deletion is a mutation the table can express: without
      // it the lane dials on behalf of an account that has no credential.
      if (credential === undefined) return noGoogleAccount(log, model);

      let lastStatus = 503;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        let response: Awaited<ReturnType<typeof fetchImplementation>> | undefined;
        try {
          response = await fetchImplementation(MINT_ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": credential },
            body: JSON.stringify({
              uses: SINGLE_USE,
              expireTime: new Date(Date.now() + REQUESTED_WINDOW_MS).toISOString(),
            }),
          });
        } catch {
          // No response at all - DNS, a reset, an abort. The error object is
          // dropped whole rather than logged: a fetch error hangs a cause chain
          // and a stack off itself, and the request that built it had the key
          // in a header.
          lastStatus = 503;
          log(`voice: mint attempt ${attempt} for "${model}" got no answer`);
          if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1] ?? 0);
          continue;
        }

        if (response.ok) {
          const body = (await response.json()) as { name?: unknown };
          if (typeof body.name !== "string" || body.name.length === 0) {
            lastStatus = 502;
            log(`voice: mint attempt ${attempt} for "${model}" answered 200 without a token name`);
            if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1] ?? 0);
            continue;
          }
          // The one line that names a success. It names the model and says a
          // token was minted; it does not say WHICH, because "a token in a log
          // file is a token" (ADR-0006) and this sink is a log file.
          log(`voice: minted a single-use token for a dial of "${model}"`);
          return { ok: true, token: body.name, model };
        }

        lastStatus = response.status;
        // A REJECTED CREDENTIAL IS NOT RETRIED. Deleting this line is the
        // mutation `the-credential-rejection-that-gets-retried`: a 401 falls
        // through into the backoff loop and the lane starts knocking on a door
        // that has already said no.
        if (!transient(response.status)) break;
        log(`voice: mint attempt ${attempt} for "${model}" answered ${response.status}`);
        if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1] ?? 0);
      }

      if (transient(lastStatus)) {
        log(`voice: giving up on a dial of "${model}" after ${MAX_ATTEMPTS} attempts - UPSTREAM_UNAVAILABLE`);
        return sanitised(
          lastStatus,
          "UPSTREAM_UNAVAILABLE",
          `the mint did not succeed in ${MAX_ATTEMPTS} attempts and this lane does not keep trying`,
        );
      }
      log(`voice: refusing a dial for "${model}" - CREDENTIAL_REJECTED`);
      return sanitised(lastStatus, "CREDENTIAL_REJECTED", `the "${VOICE_ACCOUNT}" account's credential was not accepted, and a rejection is not retried`);
    },
  };
}
