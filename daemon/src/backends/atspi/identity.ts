import { createHash } from "node:crypto";
import type { Role } from "@mastra-cc/protocol-types";

// Element identity is DERIVED, never claimed: the bus name plus the object
// path, hashed to twelve hex characters. The native get-id is not used - the
// prototype found three browser frames all claiming the same id. Two objects
// sharing a native id still get distinct identities here because their paths
// differ; the same object read twice gets the same identity because nothing
// here depends on when it was read.

export function deriveId(role: Role, busName: string, objectPath: string): string {
  const prefix = role === "application" ? "app" : role === "window" || role === "dialog" ? "win" : "el";
  const hash = createHash("sha256").update(`${busName}\u0000${objectPath}`).digest("hex").slice(0, 12);
  return `${prefix}-${hash}`;
}
