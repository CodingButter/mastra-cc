// THE HUB'S MODEL CONFIGURATION.
//
// Jamie asked for models "settable just like we do for mastracode", across
// Anthropic, OpenAI and Google. Mastracode's settings carry per-role model
// defaults - a build model, a plan model, a fast model - each a single
// "provider/model" string, with the background roles overridable separately.
// That shape is mirrored here rather than invented, because a configuration
// whose shape the operator already knows is one they can set without reading
// this file.
//
// What this module does NOT do is hand anybody a credential. Resolution
// returns a client that CAN call the provider; the key it calls with stays
// inside the closure that built it (ADR-0007: "never give the key to the agent
// or they'll try it on every door"). The test beside this file asserts that by
// walking the returned object, not by reading this comment.

/** The three providers this milestone configures. Adding a fourth is an edit here and a red test. */
export const PROVIDERS = ["anthropic", "openai", "google"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * A role is a job the hub needs a model for. The names are the hub's, not the
 * provider's: an operator swaps the model behind a role without anything that
 * uses the role knowing.
 */
export type Role = string;

/** `provider/model`, exactly as mastracode's settings carry it. */
export type ModelSpecifier = `${Provider}/${string}`;

export interface ModelConfiguration {
  /** Role name to `provider/model`. A role absent from this map is not configured, and that is a refusal - never a default. */
  readonly roles: Readonly<Record<Role, ModelSpecifier>>;
}

/**
 * Where credentials come from. The hub owns this, and the hub is the only thing
 * that reads it.
 *
 * `allowEnvironmentFallback` is deliberately not a parameter. The factory's
 * credential store carries it as a flag defaulted to false, and its own comment
 * says why: "server-shell credentials never leak into tenants". A flag defaulted
 * off is still a flag somebody can turn on from a config file that travels; the
 * fallback is not implemented here at all, so there is nothing to turn on. A
 * provider key sitting in this process's environment cannot satisfy a
 * resolution, because no line of this module reads the environment.
 */
export interface CredentialStore {
  /** The credential for a named account, or undefined if the account has none. Never called by anything but this module. */
  credentialFor(account: string): string | undefined;
}

export interface ResolvedModel {
  readonly role: Role;
  readonly provider: Provider;
  readonly model: string;
  /** The account the credential came from, so a caller can say WHICH account answered. The credential itself is not here. */
  readonly account: string;
  /**
   * Calls the provider. The credential is read at call time from the store, not
   * captured at resolution: the factory's store re-resolves authoritatively
   * before use so "a slightly stale snapshot can never send an expired token
   * upstream", and a client built once at boot and used all day is exactly that
   * stale snapshot.
   */
  send(body: unknown): Promise<ProviderAnswer>;
}

export type ProviderAnswer = { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly refusal: string };

export type Resolution = { readonly model: ResolvedModel } | { readonly refusal: string };

const ENDPOINT: Record<Provider, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/responses",
  google: "https://generativelanguage.googleapis.com/v1beta/models",
};

// Each provider names its own credential header. Getting this wrong is a 401
// that looks like an expired key, so the three are written out rather than
// guessed from a pattern.
const AUTHORISATION: Record<Provider, (credential: string) => Record<string, string>> = {
  anthropic: (credential) => ({ "x-api-key": credential, "anthropic-version": "2023-06-01" }),
  openai: (credential) => ({ authorization: `Bearer ${credential}` }),
  google: (credential) => ({ "x-goog-api-key": credential }),
};

/** The account each provider's credential lives under. One name, so a refusal can say it. */
const ACCOUNT: Record<Provider, string> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
};

function parse(specifier: string): { provider: Provider; model: string } | undefined {
  const cut = specifier.indexOf("/");
  if (cut < 1) return undefined;
  const provider = specifier.slice(0, cut);
  const model = specifier.slice(cut + 1);
  if (model.length === 0) return undefined;
  if (!(PROVIDERS as readonly string[]).includes(provider)) return undefined;
  return { provider: provider as Provider, model };
}

/**
 * THE UPSTREAM ERROR NEVER TRAVELS.
 *
 * A provider that rejects a call answers with prose, and that prose has been
 * known to quote the request back - which for this hub means an element's name,
 * a user's typed text, whatever the agent put in the prompt. Sanitising it would
 * mean deciding which parts of somebody else's error string are safe, and that
 * decision is wrong the first time a provider changes its format.
 *
 * So the status travels and the prose does not. This is the same move the daemon
 * makes one rung down: a raw system error is normalised to a constant before it
 * reaches the wire, because "the desktop could not be read" is a true sentence
 * that carries nothing.
 */
function upstreamRefusal(provider: Provider, model: string, status: number): string {
  return `refused upstream: ${provider} answered ${status} for "${model}" - the provider's own message is not carried here, because a provider's error text can quote the request back and the request is the user's`;
}

/**
 * The provider did not answer at all - DNS, a reset connection, an abort. A
 * status would be a lie here, because there was no response to have one, and
 * "did not answer" is the one true thing that can be said without carrying the
 * error object's stack anywhere.
 */
function unreachableRefusal(provider: Provider, model: string): string {
  return `refused upstream: ${provider} did not answer for "${model}" - the request never reached a response, and the connection error is not carried here`;
}

function unconfiguredRole(role: Role): string {
  return `no model is configured for the role "${role}" - the hub does not choose one for you; name it in the configuration as provider/model`;
}

function noCredential(account: string, role: Role): string {
  return `no credential is attached to the "${account}" account, so the role "${role}" cannot be resolved - attach one to that account; this hub does not read provider keys from the environment`;
}

export function resolveModel(
  configuration: ModelConfiguration,
  role: Role,
  credentials: CredentialStore,
  fetchImplementation: typeof fetch = fetch,
): Resolution {
  const specifier = configuration.roles[role];
  // No default. A role nobody configured resolving to a model nobody chose is
  // how a cheap model ends up doing a careful job, quietly, for a month. One
  // line, so deleting it is a mutation the table can express.
  if (specifier === undefined) return { refusal: unconfiguredRole(role) };

  const parsed = parse(specifier);
  if (parsed === undefined) {
    return {
      refusal: `the role "${role}" names "${specifier}", which is not provider/model for a provider this hub has - the providers are ${PROVIDERS.join(", ")}`,
    };
  }

  const { provider, model } = parsed;
  const account = ACCOUNT[provider];
  // Names the account, and nothing else. An agent that reads this refusal learns
  // which account to ask a human about, and learns nothing about any credential.
  if (credentials.credentialFor(account) === undefined) return { refusal: noCredential(account, role) };

  return {
    model: {
      role,
      provider,
      model,
      account,
      async send(body: unknown): Promise<ProviderAnswer> {
        // Read at call time, never captured. See ResolvedModel.send.
        const credential = credentials.credentialFor(account);
        if (credential === undefined) {
          return {
            ok: false,
            refusal: `the "${account}" account no longer has a credential - it had one when this role was resolved, and does not now`,
          };
        }
        let response: Awaited<ReturnType<typeof fetchImplementation>>;
        try {
          response = await fetchImplementation(ENDPOINT[provider], {
            method: "POST",
            headers: { "content-type": "application/json", ...AUTHORISATION[provider](credential) },
            body: JSON.stringify(body),
          });
        } catch {
          // A CONNECTION FAILURE IS AN ANSWER, and it belongs inside the union
          // rather than escaping past it as a rejection: a caller that handles
          // every case of ProviderAnswer has handled this one too. The thrown
          // error itself is dropped whole. It is the one object in this module
          // nobody designed with "the request is the user's" in mind - undici
          // hangs a cause chain and a stack off it, and a request body is
          // reachable from a stack in a way nobody audits.
          return { ok: false, refusal: unreachableRefusal(provider, model) };
        }
        if (!response.ok) return { ok: false, refusal: upstreamRefusal(provider, model, response.status) };
        return { ok: true, body: await response.json() };
      },
    },
  };
}
