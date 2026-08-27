import type { TransportClient } from "@mastra-cc/transport";

export interface LaunchApplicationRequest {
  readonly name: string;
}

export type LaunchApplicationResult = Awaited<ReturnType<TransportClient["openApplication"]>>;

// Trusted orchestration chooses when to request this identity; the daemon still
// owns every authority, capability, catalog, process, audit, and refusal decision.
// This direct transport seam is deliberately never part of model tool minting.
export async function launchApplication(
  client: TransportClient,
  { name }: LaunchApplicationRequest,
): Promise<LaunchApplicationResult> {
  return await client.openApplication({ name });
}
