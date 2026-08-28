import type { ObservableContent, ObservableRange } from "@mastra-cc/protocol-types";

interface AxValue {
  readonly value?: unknown;
}

export interface ContentAxNode {
  readonly role?: AxValue;
  readonly value?: AxValue;
  readonly properties?: ReadonlyArray<{ readonly name?: string; readonly value?: AxValue }>;
}

function property(node: ContentAxNode, name: string): unknown {
  return node.properties?.find((candidate) => candidate.name === name)?.value?.value;
}

function numericProperty(node: ContentAxNode, name: string): number | undefined {
  const value = Number(property(node, name));
  return Number.isFinite(value) ? value : undefined;
}

export function needsProtectedClassification(node: ContentAxNode): boolean {
  if (property(node, "protected") === true) return false;
  const value = node.value?.value;
  return typeof value === "string" && value.length > 0 && /^[•●◦·*]+$/u.test(value);
}

export function readObservableContent(
  node: ContentAxNode,
  offset = 0,
  limit = 4096,
  protectedByBackingNode = false,
): ObservableContent {
  if (protectedByBackingNode || property(node, "protected") === true) {
    return { kind: "redacted", reason: "protected" };
  }

  const role = String(node.role?.value ?? "");
  const rawValue = node.value?.value;
  const minimum = numericProperty(node, "valuemin");
  const maximum = numericProperty(node, "valuemax");

  if (minimum !== undefined && maximum !== undefined) {
    const value = Number(rawValue ?? property(node, "valuetext"));
    if (!Number.isFinite(value)) return { kind: "unavailable", reason: "unknown" };
    const range: ObservableRange = { minimum, maximum };
    return { kind: "number", value, range };
  }

  if (rawValue !== undefined && (role === "textField" || property(node, "editable") === true)) {
    const value = String(rawValue);
    const scalars = [...value];
    if (offset === 0 && scalars.length <= limit) return { kind: "text", value };
    const window = scalars.slice(offset, offset + Math.min(limit, 4096)).join("");
    const startLine = scalars.slice(0, offset).join("").split("\n").length;
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

  return { kind: "unavailable", reason: "not-exposed" };
}
