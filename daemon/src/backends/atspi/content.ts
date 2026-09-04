import type { ObservableContent, ObservableRange } from "@mastra-cc/protocol-types";
import { INLINE_TEXT_LIMIT } from "../observable-content.js";
import type { Channel } from "./channel.js";

const ACCESSIBLE = "org.a11y.atspi.Accessible";
const PROPERTIES = "org.freedesktop.DBus.Properties";
const TEXT = "org.a11y.atspi.Text";
const VALUE = "org.a11y.atspi.Value";

interface NativeRef {
  busName: string;
  objectPath: string;
}

function unwrapVariant(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  const inner = raw[1];
  return Array.isArray(inner) ? inner[0] : inner;
}

async function propertyOf(channel: Channel, ref: NativeRef, iface: string, name: string): Promise<unknown> {
  const [raw] = await channel.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: PROPERTIES,
    member: "Get",
    signature: "ss",
    body: [iface, name],
  });
  return unwrapVariant(raw);
}

async function numericContent(channel: Channel, ref: NativeRef): Promise<ObservableContent> {
  const value = Number(await propertyOf(channel, ref, VALUE, "CurrentValue"));
  const minimum = Number(await propertyOf(channel, ref, VALUE, "MinimumValue"));
  const maximum = Number(await propertyOf(channel, ref, VALUE, "MaximumValue"));
  if (![value, minimum, maximum].every(Number.isFinite)) return { kind: "unavailable", reason: "unknown" };

  const increment = Number(await propertyOf(channel, ref, VALUE, "MinimumIncrement"));
  const range: ObservableRange = { minimum, maximum };
  if (Number.isFinite(increment) && increment > 0) range.step = increment;
  return { kind: "number", value, range };
}

async function interfacesOf(channel: Channel, ref: NativeRef): Promise<string[]> {
  const [listed] = await channel.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: ACCESSIBLE,
    member: "GetInterfaces",
  });
  return Array.isArray(listed) ? listed.map(String) : [];
}

async function textContent(channel: Channel, ref: NativeRef, offset: number, limit: number): Promise<ObservableContent> {
  const totalLength = Number(await propertyOf(channel, ref, TEXT, "CharacterCount"));
  if (!Number.isSafeInteger(totalLength) || totalLength < 0) return { kind: "unavailable", reason: "unknown" };

  const boundedOffset = Math.min(offset, totalLength);
  const boundedLimit = Math.min(limit, INLINE_TEXT_LIMIT);
  const end = Math.min(boundedOffset + boundedLimit, totalLength);
  const [raw] = await channel.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: TEXT,
    member: "GetText",
    signature: "ii",
    body: [boundedOffset, end],
  });
  const value = [...String(raw ?? "")].slice(0, end - boundedOffset).join("");
  if (boundedOffset === 0 && totalLength <= boundedLimit) return { kind: "text", value };

  return {
    kind: "text-window",
    value,
    offset: boundedOffset,
    length: [...value].length,
    totalLength,
  };
}

export async function readObservableContent(
  channel: Channel,
  ref: NativeRef,
  nativeRole: string,
  offset = 0,
  limit = INLINE_TEXT_LIMIT,
): Promise<ObservableContent> {
  if (nativeRole === "password text") return { kind: "redacted", reason: "protected" };

  let interfaces: string[];
  try {
    interfaces = await interfacesOf(channel, ref);
  } catch {
    return { kind: "unavailable", reason: "unknown" };
  }

  try {
    if (interfaces.includes(TEXT)) return await textContent(channel, ref, offset, limit);
    if (interfaces.includes(VALUE)) return await numericContent(channel, ref);
    return { kind: "unavailable", reason: "not-exposed" };
  } catch {
    return { kind: "unavailable", reason: "unknown" };
  }
}
