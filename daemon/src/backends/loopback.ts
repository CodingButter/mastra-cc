import { createHash } from "node:crypto";
import type { SemanticElement } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";

// WIRE DOUBLE - NOT AN ACCESSIBILITY FIXTURE. This backend exists so Phase 3
// can prove the socket, the digest handshake, and the dispatch path with the
// desktop deliberately absent, making any Phase 4 failure unambiguously an
// accessibility failure. It answers one synthetic element and nothing else.
// It is DELETED in Phase 5, when the replay backend (built from captured
// recordings of a real tree) takes over the no-desktop lane. Do not grow it.

const ID = `el-${createHash("sha256").update("loopback:the demo button").digest("hex").slice(0, 12)}`;

const THE_ELEMENT: SemanticElement = {
  id: ID,
  role: "button",
  name: "the demo button",
  states: ["enabled", "visible"],
  actions: ["press"],
};

export class LoopbackBackend implements Backend {
  readonly name = "loopback";

  async queryElements(params: { role?: string; name?: string; limit?: number }) {
    const matches =
      (params.role === undefined || params.role === THE_ELEMENT.role) &&
      (params.name === undefined || params.name.normalize("NFKC") === THE_ELEMENT.name);
    const elements = matches ? [THE_ELEMENT] : [];
    return { elements: elements.slice(0, params.limit ?? elements.length) };
  }

  async attestElement(params: { id: string }) {
    if (params.id === THE_ELEMENT.id) return { element: THE_ELEMENT };
    return { refusal: `no element with id "${params.id}" - nothing to attest` };
  }

  async close() {}
}
