// Most tests assert WHAT a refusal says. Since ADR-0113 a refusal is an
// object carrying its owner and code; this reads the sentence out of either
// a response or a result, so those tests keep asserting the sentence.
export function refusalText(answer: unknown): string | undefined {
  if (answer === null || typeof answer !== "object") return undefined;
  const a = answer as { refusal?: unknown; result?: { refusal?: unknown } };
  const r = a.refusal ?? a.result?.refusal;
  if (r === undefined) return undefined;
  if (typeof r === "string") return r;
  return (r as { message: string }).message;
}

/** The refusal's code, or undefined when the answer is not a refusal. */
export function refusalCode(answer: unknown): string | undefined {
  if (answer === null || typeof answer !== "object") return undefined;
  const a = answer as { refusal?: { code?: string }; result?: { refusal?: { code?: string } } };
  return (a.refusal ?? a.result?.refusal)?.code;
}

/** The refusal's owner - agent, world or daemon - or undefined. */
export function refusalOwner(answer: unknown): string | undefined {
  if (answer === null || typeof answer !== "object") return undefined;
  const a = answer as { refusal?: { class?: string }; result?: { refusal?: { class?: string } } };
  return (a.refusal ?? a.result?.refusal)?.class;
}
