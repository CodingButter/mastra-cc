// THE MODEL IS NAMED, THE CREDENTIAL IS NOT HANDED OVER, AND THE PROVIDER'S
// PROSE STAYS UPSTREAM.
//
// None of these tests calls a provider. Every credential in this file is
// fictitious. Live provider evidence is Segment 4's job, and a phase that
// needed a live key would fail on a Tuesday for reasons that have nothing to do
// with the code - the Anthropic token in the credential inventory expired the
// evening this was written, which is precisely the point.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDERS, resolveModel, type CredentialStore, type ModelConfiguration } from "../models/configure.js";

const FICTITIOUS = "sk-not-a-real-key-000000000000";

function store(accounts: Record<string, string>): CredentialStore {
  return { credentialFor: (account) => accounts[account] };
}

const EVERY_ROLE: ModelConfiguration = {
  roles: {
    build: "anthropic/claude-opus-5",
    plan: "openai/gpt-5",
    fast: "google/gemini-2.5-flash",
  },
};

const held = store({ anthropic: FICTITIOUS, openai: FICTITIOUS, google: FICTITIOUS });

describe("the model is configured, not guessed", () => {
  it("every provider this hub has can be named in configuration and resolves", () => {
    // The SET, not a sample: a provider silently dropped from PROVIDERS while
    // its role still resolves elsewhere would pass a membership check.
    expect([...PROVIDERS]).toEqual(["anthropic", "openai", "google"]);

    const resolved = Object.keys(EVERY_ROLE.roles).map((role) => resolveModel(EVERY_ROLE, role, held));
    for (const resolution of resolved) expect(resolution).not.toHaveProperty("refusal");

    const providers = resolved.map((r) => ("model" in r ? r.model.provider : undefined));
    expect(new Set(providers)).toEqual(new Set(PROVIDERS));
  });

  it("a role nobody configured is refused by name, and no default is invented", () => {
    const resolution = resolveModel(EVERY_ROLE, "curator", held);
    expect("refusal" in resolution).toBe(true);
    if (!("refusal" in resolution)) return;
    expect(resolution.refusal).toContain('"curator"');
    // The refusal must not name a model, because naming one is how an operator
    // concludes something is configured that isn't.
    expect(resolution.refusal).not.toContain("claude");
    expect(resolution.refusal).not.toContain("gpt");
    expect(resolution.refusal).not.toContain("gemini");
  });

  it("a missing account is refused by its name, and the refusal carries no key material", () => {
    const resolution = resolveModel(EVERY_ROLE, "build", store({ google: FICTITIOUS }));
    expect("refusal" in resolution).toBe(true);
    if (!("refusal" in resolution)) return;
    expect(resolution.refusal).toContain('"anthropic"');
    expect(resolution.refusal).not.toContain(FICTITIOUS);
    // Not even a fragment. A refusal quoting the first eight characters of a key
    // is a refusal that tells an attacker which key it was.
    expect(resolution.refusal).not.toContain(FICTITIOUS.slice(0, 8));
  });

  it("a key in the environment does not satisfy a resolution", () => {
    // The whole environment is offered under every name a provider key is
    // conventionally read from. None of it may count.
    const before = { ...process.env };
    process.env.ANTHROPIC_API_KEY = FICTITIOUS;
    process.env.OPENAI_API_KEY = FICTITIOUS;
    process.env.GOOGLE_API_KEY = FICTITIOUS;
    process.env.GEMINI_API_KEY = FICTITIOUS;
    try {
      for (const role of Object.keys(EVERY_ROLE.roles)) {
        const resolution = resolveModel(EVERY_ROLE, role, store({}));
        expect("refusal" in resolution, `${role} resolved from the environment`).toBe(true);
      }
    } finally {
      process.env = before;
    }
  });

  it("environment fallback is off by absence, not by a flag somebody can set", () => {
    // The test above proves the environment did not satisfy THOSE resolutions.
    // It cannot prove there is no path that reads the environment - a fallback
    // behind a flag defaulted off would pass it, and a flag defaulted off is
    // still a flag a config file that travels can turn on.
    //
    // So the module is read. The guarantee is that no line of it reaches the
    // environment at all, which is not a default and cannot be set.
    const source = readFileSync(join(__dirname, "..", "models", "configure.ts"), "utf8");
    const code = source
      .split("\n")
      .filter((line: string) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code, "the module reads the environment").not.toMatch(/process\.env|import\.meta\.env|getenv/);
    // Not vacuous: the file was found and holds the resolver this suite tests.
    expect(code).toContain("export function resolveModel");
  });

  it("the resolved model hands out no credential, anywhere a caller can reach", () => {
    const resolution = resolveModel(EVERY_ROLE, "build", held);
    expect("model" in resolution).toBe(true);
    if (!("model" in resolution)) return;

    // Walk it. A key on a nested object is still a key handed out, and a shape
    // assertion listing the fields somebody remembered would miss one added
    // later. The whole reachable graph is searched for the credential.
    const seen = new Set<unknown>();
    const found: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (value === null || seen.has(value)) return;
      if (typeof value === "string") {
        if (value.includes(FICTITIOUS)) found.push(path);
        return;
      }
      if (typeof value !== "object") return;
      seen.add(value);
      for (const [key, nested] of Object.entries(value)) walk(nested, `${path}.${key}`);
    };
    walk(resolution.model, "model");
    expect(found, "the credential is reachable from the resolved model").toEqual([]);

    // And the check is not vacuous: the same walk over an object that DOES hold
    // the credential finds it.
    seen.clear();
    walk({ nested: { credential: FICTITIOUS } }, "control");
    expect(found).toEqual(["control.nested.credential"]);
  });

  it("an upstream rejection travels as a status, and the provider's prose stays upstream", async () => {
    const REQUEST_CONTENT = "Reply to Dave about the unpaid invoice";
    const resolution = resolveModel(
      EVERY_ROLE,
      "build",
      held,
      // A provider that quotes the request back in its error - which is the
      // documented behaviour this refusal shape exists for.
      async () =>
        new Response(JSON.stringify({ error: { message: `invalid request: could not parse "${REQUEST_CONTENT}"` } }), {
          status: 400,
        }),
    );
    expect("model" in resolution).toBe(true);
    if (!("model" in resolution)) return;

    const answer = await resolution.model.send({ prompt: REQUEST_CONTENT });
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusal).not.toContain(REQUEST_CONTENT);
    expect(answer.refusal).not.toContain("could not parse");
    // What DOES travel: which provider, which model, what status.
    expect(answer.refusal).toContain("anthropic");
    expect(answer.refusal).toContain("400");
  });

  it("the credential is read at call time, so a rotated account is not called with the old key", async () => {
    const accounts: Record<string, string> = { anthropic: "first-credential" };
    const sent: string[] = [];
    const resolution = resolveModel({ roles: { build: "anthropic/claude-opus-5" } }, "build", {
      credentialFor: (account) => accounts[account],
    }, async (_url, init) => {
      sent.push(String((init?.headers as Record<string, string>)["x-api-key"]));
      return new Response("{}", { status: 200 });
    });
    if (!("model" in resolution)) throw new Error("expected a resolution");

    await resolution.model.send({});
    accounts.anthropic = "second-credential";
    await resolution.model.send({});
    expect(sent).toEqual(["first-credential", "second-credential"]);

    delete accounts.anthropic;
    const answer = await resolution.model.send({});
    expect(answer.ok).toBe(false);
    expect(sent).toHaveLength(2);
  });

  it("a provider that does not answer at all is refused inside the union, not thrown past it", async () => {
    // A transport failure is not an HTTP response, so it has no status, and
    // before this it escaped ProviderAnswer as a rejection - a caller with
    // exhaustive handling of the union would still have crashed. The thrown
    // object is also the one thing here nobody designed for privacy: undici
    // hangs a cause chain and a stack off it, and the request body is reachable
    // from a stack in a way nobody audits.
    const REQUEST = "the account number is 4417 9812 3345";
    const exploded = () => {
      const error = new TypeError("fetch failed");
      (error as { cause?: unknown }).cause = new Error(`connect ECONNREFUSED while sending ${REQUEST}`);
      throw error;
    };
    const resolution = resolveModel(EVERY_ROLE, "fast", held, exploded as never);
    expect("model" in resolution).toBe(true);
    if (!("model" in resolution)) return;

    const answer = await resolution.model.send({ prompt: REQUEST });
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusal).toContain("did not answer");
    // Neither the request nor the error's own words survive.
    expect(answer.refusal).not.toContain(REQUEST);
    expect(answer.refusal).not.toContain("ECONNREFUSED");
    expect(answer.refusal).not.toContain("fetch failed");
    expect(answer.refusal).not.toContain(FICTITIOUS);
  });

  it("a 200 the hub cannot read is refused inside the union too, and the body does not travel", async () => {
    // The same escape as the connection failure above, one line later: the body
    // was parsed outside the guard, so a gateway answering 200 with an HTML
    // page rejected past a caller that had handled every ProviderAnswer.
    const REQUEST = "the account number is 4417 9812 3345";
    const gateway = async () =>
      new Response("<html><body>502 Bad Gateway - upstream refused</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const resolution = resolveModel(EVERY_ROLE, "fast", held, gateway as never);
    expect("model" in resolution).toBe(true);
    if (!("model" in resolution)) return;

    const answer = await resolution.model.send({ prompt: REQUEST });
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusal).toContain("could not read");
    // A misrouted answer is not established to be safe, so none of it travels.
    expect(answer.refusal).not.toContain("Bad Gateway");
    expect(answer.refusal).not.toContain(REQUEST);
    expect(answer.refusal).not.toContain(FICTITIOUS);
  });
});
