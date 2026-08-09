// Throwaway. The one place a language model is reached.
//
// It lives here and nowhere near interpret.mjs, because the phase's whole point
// is that the model plans and the interpreter executes. Keeping the call in a
// single file is also what lets the measurement say honestly whether a model
// ran at all — a token delta measured with no model in the loop is a fabricated
// zero, and the harness refuses to report one.

const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const MODEL = 'deepseek-chat';

export class ModelUnavailable extends Error {}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.disabled]  simulate having no model; every call throws
 */
export const makeModel = ({ disabled = false } = {}) => {
  const usage = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  return {
    usage,
    get ran() {
      return usage.calls > 0;
    },
    async ask(system, user) {
      if (disabled) throw new ModelUnavailable('model disabled for this run');
      const key = process.env.DEEPSEEK_API_KEY;
      if (!key) throw new ModelUnavailable('DEEPSEEK_API_KEY is not set');

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0,
          max_tokens: 1600,
        }),
      });
      if (!res.ok) throw new ModelUnavailable(`model http ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();

      usage.calls++;
      usage.promptTokens += body.usage?.prompt_tokens ?? 0;
      usage.completionTokens += body.usage?.completion_tokens ?? 0;
      usage.totalTokens += body.usage?.total_tokens ?? 0;

      return body.choices?.[0]?.message?.content ?? '';
    },
  };
};

/** Models wrap JSON in prose and fences no matter how firmly asked not to. */
export const extractJson = (text) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  if (start === -1) throw new Error(`no JSON in model reply: ${text.slice(0, 200)}`);
  let depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{' || raw[i] === '[') depth++;
    if (raw[i] === '}' || raw[i] === ']') depth--;
    if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
  }
  throw new Error(`unbalanced JSON in model reply: ${text.slice(0, 200)}`);
};
