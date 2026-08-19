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
export const CONFIGURABLE_CAPABILITIES: readonly CapabilityName[] = ["launch", "edit", "activate", "submit"];
export const OBSERVE_SETTING = "the grants file (--grants)";

export interface CapabilityConfiguration {
  /** the fallback answer per capability, for applications with no entry of their own */
  readonly defaults: ReadonlyMap<CapabilityName, boolean>;
  /** per-application answers, keyed by NFKC-normalised name; these beat the defaults */
  readonly applications: ReadonlyMap<string, ReadonlyMap<CapabilityName, boolean>>;
}

/** The configuration a daemon started without a file runs under: it withholds nothing. */
export const WITHHOLDS_NOTHING: CapabilityConfiguration = {
  defaults: new Map(),
  applications: new Map(),
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

// The file: JSON, {"defaults": {"<capability>": bool}, "applications": {"<name>":
// {"<capability>": bool}}}. Both blocks are optional; an unknown top-level key
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
    if (key !== "defaults" && key !== "applications") {
      throw new MalformedCapabilitiesFileError(
        `the capability configuration at ${path} has an unknown top-level key ${JSON.stringify(key)} - the file holds "defaults" and "applications", and nothing here turns enforcement itself off`,
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
  return { defaults, applications };
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
  if (application !== undefined) {
    const perApplication = configuration.applications.get(normalise(application));
    const answer = perApplication?.get(capability);
    if (answer !== undefined) return answer ? undefined : settingName(normalise(application), capability, true);
  }
  const fallback = configuration.defaults.get(capability);
  if (fallback === false) return settingName(application, capability, false);
  return undefined;
}
