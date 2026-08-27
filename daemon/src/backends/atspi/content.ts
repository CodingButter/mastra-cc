import type { ObservableContent, ObservableRange } from "@mastra-cc/protocol-types";
import type { Channel } from "./channel.js";

const ACCESSIBLE = "org.a11y.atspi.Accessible";
const PROPERTIES = "org.freedesktop.DBus.Properties";
const TEXT = "org.a11y.atspi.Text";
const VALUE = "org.a11y.atspi.Value";
const INLINE_TEXT_LIMIT = 4096;

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
  const increment = Number(await propertyOf(channel, ref, VALUE, "MinimumIncrement"));
  const range: ObservableRange = { minimum, maximum };
  if (Number.isFinite(increment) && increment > 0) range.step = increment;
  return { kind: "number", value, range };
}

function textContent(value: string, offset = 0, limit = INLINE_TEXT_LIMIT): ObservableContent {
  const scalars = [...value];
  if (offset === 0 && scalars.length <= limit) return { kind: "text", value };

  const window = scalars.slice(offset, offset + Math.min(limit, INLINE_TEXT_LIMIT)).join("");
  const prefix = scalars.slice(0, offset).join("");
  const startLine = prefix.split("\n").length;
  return {
    kind: "text-window",
    value: window,
    offset,
    length: [...window].length,
    totalLength: scalars.length,
    startLine,
    endLine: startLine + window.split("\n").length - 1,
    totalLines: value.split("\n").length,
  };
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

async function textOf(channel: Channel, ref: NativeRef): Promise<string> {
  const [raw] = await channel.call({
    destination: ref.busName,
    path: ref.objectPath,
    iface: TEXT,
    member: "GetText",
    signature: "ii",
    body: [0, -1],
  });
  return String(raw ?? "");
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
    if (interfaces.includes(TEXT)) return textContent(await textOf(channel, ref), offset, limit);
    if (interfaces.includes(VALUE)) return await numericContent(channel, ref);
    return { kind: "unavailable", reason: "not-exposed" };
  } catch {
    return { kind: "unavailable", reason: "unknown" };
  }
}
