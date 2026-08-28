import type { ObservableContent } from "@mastra-cc/protocol-types";

export const INLINE_TEXT_LIMIT = 4096;

export function observableText(value: string, offset = 0, limit = INLINE_TEXT_LIMIT): ObservableContent {
  const scalars = [...value];
  const boundedOffset = Math.min(offset, scalars.length);
  const boundedLimit = Math.min(limit, INLINE_TEXT_LIMIT);
  if (boundedOffset === 0 && scalars.length <= boundedLimit) return { kind: "text", value };

  const window = scalars.slice(boundedOffset, boundedOffset + boundedLimit).join("");
  const startLine = scalars.slice(0, boundedOffset).join("").split("\n").length;
  return {
    kind: "text-window",
    value: window,
    offset: boundedOffset,
    length: [...window].length,
    totalLength: scalars.length,
    startLine,
    endLine: startLine + window.split("\n").length - 1,
    totalLines: value.split("\n").length,
  };
}
