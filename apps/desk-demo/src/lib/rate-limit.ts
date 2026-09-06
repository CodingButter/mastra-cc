// A RATE LIMIT IS NOT THE END OF AN ERRAND.
//
// Measured 2026-09-05 against Gemini: the quota that stops a desk errand is
// input tokens per minute per model (quotaId
// GenerateContentPaidTierInputTokensPerModelPerMinute, 3,000,000), and a turn
// on this desk resends its whole transcript on every step, so thirty to
// seventy steps is enough to spend a minute's allowance. The provider says so
// clearly - HTTP 429 with a RetryInfo of about a minute - but the failure
// arrives in the MIDDLE of a stream that has already produced tool calls, and
// the framework ends that stream quietly. What the person saw was a turn that
// stopped mid-errand with no final message and no error: the agent looked like
// it had given up, when it had been cut off.
//
// This lives in the demo rather than in the daemon on purpose. The desk knows
// nothing about which model is driving it or what that model's billing plan
// allows, and a daemon that slept because a language provider was busy would
// be answering for something it cannot see.

/** The provider's own words for "you are going too fast, come back later". */
export function isRateLimited(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const bag = error as { statusCode?: unknown; message?: unknown };
  if (bag.statusCode === 429) return true;
  const text = typeof bag.message === "string" ? bag.message : "";
  return /rate limit|too many requests|quota exceeded|resource_exhausted/i.test(text);
}

/**
 * How long the provider asked us to wait, in milliseconds, as IT said it -
 * `"retryDelay": "57s"` in the RetryInfo detail Google attaches to a 429.
 * A guess would either sleep too little and burn the next window on a second
 * refusal, or sleep too long and waste the errand's time, so the provider's
 * own number is preferred and the fallback is only for a provider that gives
 * none. The fallback is a minute because these windows are per minute.
 */
/**
 * A FAULT ON THE WAY TO THE MODEL IS NOT A DECISION BY THE MODEL.
 *
 * Measured 2026-09-05, twice in three wallpaper errands: the stream ended at
 * step 41 and step 80 with `UND_ERR_HEADERS_TIMEOUT` - the provider never sent
 * response headers in time - and the turn stopped mid-errand with the desk
 * half-driven. That is the same shape as the rate limit this file was written
 * for, and it deserves the same answer: the desk was not touched by the
 * failure, so the errand can be picked up where it stood. Only faults that say
 * they are transient are resumed; a refused key or a bad request still ends the
 * turn loudly, because retrying those would only hide them.
 */
export function isTransientFault(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const bag = error as { isRetryable?: unknown; statusCode?: unknown };
  if (bag.isRetryable === true) return true;
  if (typeof bag.statusCode === "number" && bag.statusCode >= 500) return true;
  return /headers timeout|UND_ERR_|ETIMEDOUT|ECONNRESET|socket hang up|fetch failed/i.test(messageOf(error));
}

/** Either kind of interruption the turn knows how to wait out and resume. */
export function isResumable(error: unknown): boolean {
  return isRateLimited(error) || isTransientFault(error);
}

export function retryDelayMs(error: unknown, fallback = 60_000): number {
  // A network fault carries no RetryInfo and no quota window to wait out; the
  // connection simply failed, so the wait is short by design.
  if (!isRateLimited(error) && isTransientFault(error)) return 2_000;
  const text = messageOf(error);
  const asked = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text) ?? /retry in (\d+(?:\.\d+)?)s/i.exec(text);
  if (asked === null) return fallback;
  const seconds = Number(asked[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  // A second of headroom: the window is measured on the provider's clock, not
  // ours, and coming back one millisecond early costs a whole further window.
  return Math.min(seconds * 1000 + 1_000, 5 * 60_000);
}

function messageOf(error: unknown): string {
  if (error === null || typeof error !== "object") return String(error ?? "");
  const bag = error as { message?: unknown; responseBody?: unknown };
  return `${typeof bag.message === "string" ? bag.message : ""} ${
    typeof bag.responseBody === "string" ? bag.responseBody : ""
  }`;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
