import type {
  AttestElementParams,
  AttestElementResult,
  QueryElementsParams,
  QueryElementsResult,
} from "@mastra-cc/protocol-types";

// The backend seam: one defined interface, per-platform implementations that
// must implement every method, conformance enforced by the shared suite in
// __tests__/backend-conformance.test.ts - every backend that ever exists is
// registered into that suite and run through it.

export interface Backend {
  readonly name: string;
  queryElements(params: QueryElementsParams): Promise<QueryElementsResult>;
  attestElement(params: AttestElementParams): Promise<AttestElementResult>;
  close(): Promise<void>;
}

export const BACKEND_METHODS = ["queryElements", "attestElement", "close"] as const;
