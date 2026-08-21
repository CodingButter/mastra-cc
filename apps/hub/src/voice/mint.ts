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

/** What an unreadable 200 becomes: an object with no token name, which is already a case this loop knows how to refuse. */
const UNREADABLE_BODY = Object.freeze({});

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

export const REFUSAL_CODES = ["NO_GOOGLE_ACCOUNT", "CREDENTIAL_REJECTED", "MINT_REFUSED", "UPSTREAM_UNAVAILABLE"] as const;
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

/**
 * ONLY A REJECTED CREDENTIAL IS A REJECTED CREDENTIAL.
 *
 * Review caught this module telling a person to go fix a key that is fine: a
 * 400 from a body format the provider changed, a 403 from an API nobody enabled
 * on the project, a 404 from an endpoint that moved off v1alpha - each of them
 * left the loop and arrived as `CREDENTIAL_REJECTED`, a cause this lane never
 * observed. Worse, a provider-returned 409 collided with this lane's OWN 409,
 * so the one field a client is told to branch on could carry two unrelated
 * meanings. Only the two statuses that actually mean "this credential was not
 * accepted" claim that; everything else says the mint refused and does not
 * invent a reason for it.
 */
function credentialWasRejected(status: number): boolean {
  return status === 401 || status === 403;
}

/** What a status without an attributable cause is worth saying about: the status, and no story around it. */
function mintRefused(log: (line: string) => void, model: string, status: number): DialRefusal {
  log(`voice: refusing a dial for "${model}" - MINT_REFUSED`);
  return sanitised(
    status,
    "MINT_REFUSED",
    "the mint refused this request and the reason is not one this lane can name; the status is the whole of what was observed",
  );
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
          // A 200 IS NOT A PROMISE THAT THE BODY PARSES. A gateway can answer
          // 200 with an HTML error page, and a truncated response is a 200 too.
          // Letting that parse reject would take it out of dial(), whose type
          // says it returns an outcome, and the rejection would carry a stack
          // from the request that had the key in a header - the same reasoning
          // that drops the fetch error whole above. A body nobody can read is a
          // body with no token name in it, so it takes the same path.
          //
          // AND THAT PATH RETRIES, which is a deliberate choice worth naming
          // because it differs from the sibling in models/configure.ts, where
          // an unreadable answer refuses at once. Two reasons. This endpoint
          // mints, so an unreadable 200 may mean a token exists upstream that
          // nobody here ever saw - and the remedy for a token nobody holds is
          // to ask for one that somebody does, not to give up on the dial. The
          // cost of being wrong is bounded by design: each token is single-use
          // with a two-minute window, so an unseen one expires unused, and the
          // loop is capped at MAX_ATTEMPTS. configure.ts has no such loop and
          // no such orphan - a chat completion nobody could read is simply an
          // answer that did not arrive.
          const body = (await response.json().catch(() => UNREADABLE_BODY)) as { name?: unknown };
          if (typeof body.name !== "string" || body.name.length === 0) {
            lastStatus = 502;
            // TWO CAUSES REACH THIS BRANCH AND THEY ARE NOT THE SAME FACT. One
            // says the provider answered something this lane could read and it
            // held no token; the other says the answer never parsed at all,
            // which points at a gateway rather than at the endpoint. Routing
            // them to one outcome is right - both are "no token, try again" -
            // but telling the operator the lane read a body it could not is the
            // defect the digest check just got fixed for: a line that cannot
            // show what it found.
            // Written as a line that can be DELETED rather than a ternary, so
            // the mutation table can express losing the distinction: drop the
            // line below and both causes claim the lane read the body.
            let saw = "no token name in a body it could read";
            if (body === UNREADABLE_BODY) saw = "a body this lane could not read";
            log(`voice: mint attempt ${attempt} for "${model}" answered 200 with ${saw}`);
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
      // One line, and its deletion is the bug it was written to close: without
      // it every non-transient status falls into the sentence below and blames
      // a credential nobody watched fail. That is the mutation
      // `the-refusal-that-blames-the-credential-for-everything`.
      if (!credentialWasRejected(lastStatus)) return mintRefused(log, model, lastStatus);
      log(`voice: refusing a dial for "${model}" - CREDENTIAL_REJECTED`);
      return sanitised(lastStatus, "CREDENTIAL_REJECTED", `the "${VOICE_ACCOUNT}" account's credential was not accepted, and a rejection is not retried`);
    },
  };
}
