import type { ObservableContent, ObservableRange } from "@mastra-cc/protocol-types";
import { observableText } from "../observable-content.js";

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
  const role = String(node.role?.value ?? "");
  return role === "textField" || role === "textbox" || property(node, "editable") === true || property(node, "editable") === "plaintext";
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

  if (rawValue !== undefined && (role === "textField" || role === "textbox" || property(node, "editable") === true || property(node, "editable") === "plaintext")) {
    return observableText(String(rawValue), offset, limit);
  }

  return { kind: "unavailable", reason: "not-exposed" };
}
