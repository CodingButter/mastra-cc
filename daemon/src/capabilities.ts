import { existsSync, readFileSync } from "node:fs";
import { CAPABILITY_NAMES, type CapabilityName } from "@mastra-cc/protocol-types";
import { normalise } from "./backends/atspi/names.js";

// The capability configuration (ADR-0043 clause 4): the user configures what
// the daemon may do, per application and globally, and the daemon enforces it.
// No agent ever decides what it is capable of - it is told, and the telling is
// backed by a refusal before the call that NAMES the setting a person would
// change (ADR-0008 clause 5, ADR-0042: a refusal that cannot be acted on is a
// wall, not an answer).
//
// The shape is grants.ts's, deliberately rather than approximately: raw JSON
// read from disk, application names NFKC-normalised AT LOAD, composed once at
// boot, and a file that cannot be parsed failing startup loudly with a named
// error instead of silently becoming "no configuration". The operator meant
// something.
//
// WHAT THIS LAYER IS. It SUBTRACTS from what a session was already given; it
// never adds. Authority (--permit, --allow) and visibility (the grants file,
// --grant) are session-scoped and already deny by default, so a second silent
// deny-by-default here would mean an operator who granted a class still got
// nothing, with no setting to name as the reason. So the stated default is
// that configuration withholds NOTHING, and every one of those defaults is
// configurable through the "defaults" block below. A daemon started without a
// configuration file behaves exactly as it did before this file existed, which
// is a property the tests assert directly rather than infer.
//
// WHAT IS NOT CONFIGURABLE. Nothing here can switch enforcement off. There is
// no key for it, an unknown key is refused by name, and the mechanisms that
// make configuration mean anything - attestation before a submit, the audit of
// what was touched, refusals naming their check, the person outranking the
// agent - are not policies and have no setting. A permission system with a
// disable switch is a permission system that lies.

export class MalformedCapabilitiesFileError extends Error {}

// `observe` is deliberately NOT configurable here. It already has exactly one
// setting - the grants file (ADR-0036) - and a second mechanism for the same
// capability would mean two places to read and a real chance they disagree. A
// file naming it is refused, and the refusal says where observe is configured
// instead of quietly accepting a key that would enforce nothing.
// `rawInput` IS configurable here, and being in this list is not what makes it
// off. It is off because --allow composes an empty set when the flag is absent
// (server.ts, ADR-0066 clause 2), which is the session layer denying by
// default exactly as it always has. This layer still withholds NOTHING by
// default - the invariant above is intact - and its entry here is the second,
// independent setting: an operator who armed a session with the flag can still
// take raw input away from one application by name, and the refusal says which
// of the two settings was responsible.
export const CONFIGURABLE_CAPABILITIES: readonly CapabilityName[] = ["launch", "edit", "activate", "submit", "rawInput"];
export const OBSERVE_SETTING = "the grants file (--grants)";

// Restart authority is NOT in CONFIGURABLE_CAPABILITIES, and the reason is the
// same shape as the OBSERVE_SETTING note above: those are booleans answering
// "may this session do this to this application", and the entries in the two
// capability blocks are parsed and refused as such, by name, at load
// (readCapabilityBlock below). Restarting is a four-level choice about what the
// daemon may do to the operator's own processes - "no", "no, but here is the
// setting", "ask the application and take no for an answer", "take it down" -
// and a boolean cannot say which of the two acting levels was meant. So it gets
// its own sibling section in the same file, with the same parsing discipline,
// and its own named setting.
export const RESTART_LEVELS = ["refuse", "ask", "graceful", "force"] as const;
export type RestartLevel = (typeof RESTART_LEVELS)[number];

/**
 * The level a daemon with no configuration runs under: today's behavior, which
 * is a flat refusal (server.ts:248 - the running copy must be closed by a
 * person). Every acting level is something an operator asked for in writing.
 */
export const RESTART_DEFAULT: RestartLevel = "refuse";

export interface RestartConfiguration {
  /** the level for applications with no entry of their own */
  readonly fallback: RestartLevel;
  /** per-application levels, keyed by NFKC-normalised name; these beat the fallback */
  readonly applications: ReadonlyMap<string, RestartLevel>;
}

export interface CapabilityConfiguration {
  /** what the operator permits the daemon to do to a running application */
  readonly restart: RestartConfiguration;
  /** the fallback answer per capability, for applications with no entry of their own */
  readonly defaults: ReadonlyMap<CapabilityName, boolean>;
  /** per-application answers, keyed by NFKC-normalised name; these beat the defaults */
  readonly applications: ReadonlyMap<string, ReadonlyMap<CapabilityName, boolean>>;
}

/** The configuration a daemon started without a file runs under: it withholds nothing. */
export const WITHHOLDS_NOTHING: CapabilityConfiguration = {
  defaults: new Map(),
  applications: new Map(),
  // Except this: withholding nothing from a SESSION is not the same as handing
  // out authority over the operator's processes, which no session ever had.
  restart: { fallback: RESTART_DEFAULT, applications: new Map() },
};

function readCapabilityBlock(path: string, where: string, raw: unknown): Map<CapabilityName, boolean> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new MalformedCapabilitiesFileError(
      `the capability configuration at ${path} has a ${where} that is not an object of capability settings - refusing to guess what was meant`,
    );
  }
  const block = new Map<CapabilityName, boolean>();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const capability = normalise(key) as CapabilityName;
    if (!CAPABILITY_NAMES.includes(capability)) {
      // A typo that silently configured nothing would look exactly like a
      // daemon that ignores its configuration - the same reason --allow
      // rejects an unknown class rather than shrugging (main.ts).
      throw new MalformedCapabilitiesFileError(
        `the capability configuration at ${path} names ${JSON.stringify(key)} in ${where}, which is not a capability - the capabilities are ${CONFIGURABLE_CAPABILITIES.join(", ")}`,
      );
    }
    if (!CONFIGURABLE_CAPABILITIES.includes(capability)) {
      throw new MalformedCapabilitiesFileError(
        `the capability configuration at ${path} names ${JSON.stringify(key)} in ${where}, which is configured by ${OBSERVE_SETTING} instead - one capability, one setting`,
      );
    }
    if (typeof value !== "boolean") {
      throw new MalformedCapabilitiesFileError(
        `the capability configuration at ${path} gives ${JSON.stringify(key)} in ${where} a value that is not true or false - a permission that cannot be read must not be guessed at`,
      );
    }
    block.set(capability, value);
  }
  return block;
}

function readRestartLevel(path: string, where: string, raw: unknown): RestartLevel {
  const level = typeof raw === "string" ? (normalise(raw) as RestartLevel) : undefined;
  if (level === undefined || !RESTART_LEVELS.includes(level)) {
    throw new MalformedCapabilitiesFileError(
      `the capability configuration at ${path} gives ${where} the restart level ${JSON.stringify(raw)}, which is not one of ${RESTART_LEVELS.join(", ")} - the operator meant something, and guessing between "ask the application" and "take it down" is not a guess anyone should make`,
    );
  }
  return level;
}

function readRestartSection(path: string, raw: unknown): RestartConfiguration {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new MalformedCapabilitiesFileError(
      `the capability configuration at ${path} has a "restart" that is not {"default": <level>, "applications": {...}} - refusing to guess what was meant`,
    );
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "default" && key !== "applications") {
      throw new MalformedCapabilitiesFileError(
        `the capability configuration at ${path} has an unknown key ${JSON.stringify(key)} in "restart" - the section holds "default" and "applications"`,
      );
    }
  }
  const fallback = record.default === undefined ? RESTART_DEFAULT : readRestartLevel(path, '"restart".default', record.default);
  const applications = new Map<string, RestartLevel>();
  if (record.applications !== undefined) {
    if (typeof record.applications !== "object" || record.applications === null || Array.isArray(record.applications)) {
      throw new MalformedCapabilitiesFileError(
        `the capability configuration at ${path} has a "restart".applications that is not an object of application names - refusing to guess what was meant`,
      );
    }
    for (const [name, level] of Object.entries(record.applications as Record<string, unknown>)) {
      // Normalised at load, the same rule the capability blocks and the grants
      // use - a second normalisation rule would silently disagree with them.
      applications.set(normalise(name), readRestartLevel(path, `"restart".applications entry ${JSON.stringify(name)}`, level));
    }
  }
  return { fallback, applications };
}

// The file: JSON, {"defaults": {"<capability>": bool}, "applications": {"<name>":
// {"<capability>": bool}}, "restart": {"default": <level>, "applications":
// {"<name>": <level>}}}. Every block is optional; an unknown top-level key
// is refused, because a configuration whose meaning was misspelled must not
// read as a configuration that permits everything.
export function loadCapabilitiesFile(path: string): CapabilityConfiguration {
  if (!existsSync(path)) {
    // The file's absence withholds nothing: the session gates are the ones
    // that deny by default, and this layer only ever subtracts from them.
    return WITHHOLDS_NOTHING;
  }
  const text = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MalformedCapabilitiesFileError(
      `the capability configuration at ${path} is not valid JSON - a permissions file that cannot be parsed must not silently become "everything is allowed"`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new MalformedCapabilitiesFileError(
      `the capability configuration at ${path} must be {"defaults": {...}, "applications": {...}} - refusing to guess what was meant`,
    );
  }
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "defaults" && key !== "applications" && key !== "restart") {
      throw new MalformedCapabilitiesFileError(
        `the capability configuration at ${path} has an unknown top-level key ${JSON.stringify(key)} - the file holds "defaults", "applications" and "restart", and nothing here turns enforcement itself off`,
      );
    }
  }
  const defaults = record.defaults === undefined ? new Map<CapabilityName, boolean>() : readCapabilityBlock(path, '"defaults"', record.defaults);
  const applications = new Map<string, ReadonlyMap<CapabilityName, boolean>>();
  if (record.applications !== undefined) {
    if (typeof record.applications !== "object" || record.applications === null || Array.isArray(record.applications)) {
      throw new MalformedCapabilitiesFileError(
        `the capability configuration at ${path} has an "applications" that is not an object of application names - refusing to guess what was meant`,
      );
    }
    for (const [name, block] of Object.entries(record.applications as Record<string, unknown>)) {
      // Normalised AT LOAD, exactly as grants entries are, so membership
      // checks never see raw file bytes (the M0.5 lesson).
      applications.set(normalise(name), readCapabilityBlock(path, `"applications" entry ${JSON.stringify(name)}`, block));
    }
  }
  const restart = record.restart === undefined ? WITHHOLDS_NOTHING.restart : readRestartSection(path, record.restart);
  return { defaults, applications, restart };
}

/**
 * The level in force for an application, and the setting that says so. The
 * setting is returned whatever the level is, including the permissive ones,
 * because an operator reading an audit line asks the same question either way:
 * which line of my file decided this.
 */
export function restartLevelFor(
  configuration: CapabilityConfiguration,
  application?: string,
): { level: RestartLevel; setting: string } {
  return restartLevelForAny(configuration, application === undefined ? [] : [application]);
}

// The same question across an entry's SEVERAL names. One installed entry
// answers to its full id and to the short name a person types, so an operator
// who wrote `restart.applications["kate"]` meant the editor, whichever name a
// caller reaches it by. When more than one of the entry's names is configured,
// the MOST restrictive level wins: this layer only ever subtracts, and a
// resolution step that let the permissive spelling outrank the restrictive one
// would be widening what a configuration authorises through a name change.
const RESTRICTIVENESS: Record<RestartLevel, number> = { refuse: 0, ask: 1, graceful: 2, force: 3 };

export function restartLevelForAny(
  configuration: CapabilityConfiguration,
  applications: Iterable<string>,
): { level: RestartLevel; setting: string } {
  let chosen: { level: RestartLevel; setting: string } | undefined;
  for (const application of applications) {
    const named = configuration.restart.applications.get(normalise(application));
    if (named === undefined) continue;
    if (chosen === undefined || RESTRICTIVENESS[named] < RESTRICTIVENESS[chosen.level]) {
      chosen = { level: named, setting: `restart.applications[${JSON.stringify(normalise(application))}]` };
    }
  }
  return chosen ?? { level: configuration.restart.fallback, setting: "restart.default" };
}

function settingName(application: string | undefined, capability: CapabilityName, perApplication: boolean): string {
  return perApplication && application !== undefined
    ? `applications[${JSON.stringify(application)}].${capability}`
    : `defaults.${capability}`;
}

// The one question this layer answers: does the user's configuration withhold
// this capability here, and if so which setting says so? Returns the setting's
// name - never a boolean - because a refusal that does not name the setting is
// the wall ADR-0042 exists to remove. An application the caller could not name
// (an id this daemon never answered) is decided by the defaults alone: the
// per-application answer needs an application, and inventing one would attach
// a user's setting to something they never configured.
export function withheldBy(
  configuration: CapabilityConfiguration,
  capability: CapabilityName,
  application?: string,
): string | undefined {
  return withheldByAny(configuration, capability, application === undefined ? [] : [application]);
}

// The same question across an entry's SEVERAL names (see restartLevelForAny
// above for why). An explicit per-application `false` under ANY of the names
// withholds and names that setting; an explicit `true` under any name allows,
// unless a `false` elsewhere outranks it - restrictive wins, because this
// layer subtracts and name resolution must never widen it. Only when no name
// is configured does the defaults block answer.
export function withheldByAny(
  configuration: CapabilityConfiguration,
  capability: CapabilityName,
  applications: Iterable<string>,
): string | undefined {
  let allowed = false;
  for (const application of applications) {
    const answer = configuration.applications.get(normalise(application))?.get(capability);
    if (answer === false) return settingName(normalise(application), capability, true);
    if (answer === true) allowed = true;
  }
  if (allowed) return undefined;
  return configuration.defaults.get(capability) === false ? settingName(undefined, capability, false) : undefined;
}
