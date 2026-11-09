import type { AccessibilityLayer, AccessibilityReport } from "./index.js";

export const ACCESSIBILITY_CANNOT_TELL_DIAGNOSTIC =
  "mastra-cc: accessibility state cannot be determined for the AT-SPI session";
export const ACCESSIBILITY_UNAVAILABLE_DIAGNOSTIC =
  "mastra-cc: accessibility could not be enabled for the AT-SPI session";

export const ACCESSIBILITY_STARTUP_ATTEMPTS = 5;
export const ACCESSIBILITY_STARTUP_RETRY_MS = 100;

type ServingMode = "serve" | "query" | "resolve";

export interface AccessibilityStartupOptions<T> {
  readonly backend: string;
  readonly mode: ServingMode;
  readonly accessibility: AccessibilityLayer;
  readonly start: () => Promise<T>;
  readonly attempts?: number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function startAfterAccessibility<T>(options: AccessibilityStartupOptions<T>): Promise<T> {
  if (options.backend !== "atspi" || options.mode !== "serve") return options.start();

  const attempts = options.attempts ?? ACCESSIBILITY_STARTUP_ATTEMPTS;
  const wait = options.wait ?? sleep;
  let last: AccessibilityReport | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await options.accessibility.report();
    if (last.state === "enabled") return options.start();

    if (last.state === "disabled" && options.accessibility.acquirable) {
      try {
        await options.accessibility.acquire();
        last = await options.accessibility.report();
        if (last.state === "enabled") return options.start();
      } catch {
        // Retry the complete report/acquire/read-back sequence. A write may have
        // landed partially, so only the next report decides what state exists.
      }
    }

    if (attempt + 1 < attempts) await wait(ACCESSIBILITY_STARTUP_RETRY_MS);
  }

  if (last?.state === "cannot-tell") throw new Error(ACCESSIBILITY_CANNOT_TELL_DIAGNOSTIC);
  throw new Error(ACCESSIBILITY_UNAVAILABLE_DIAGNOSTIC);
}
