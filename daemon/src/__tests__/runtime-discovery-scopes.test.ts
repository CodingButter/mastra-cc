import { expect, it } from "vitest";
import type { ListApplicationsResult, QueryElementsResult } from "@mastra-cc/protocol-types";
import { AtspiBackend } from "../backends/atspi/index.js";
import { replayChannel } from "../backends/replay/index.js";
import { OwnershipTable } from "../launch/table.js";
import { handleRequest } from "../server.js";

it("uses a granted runtime listing name as a native scope without granting launch", async () => {
  const visibility = new Set(["yad"]);
  const backend = new AtspiBackend(replayChannel("gtk-dialog"), visibility);
  backend.installedApplications = async () => [{ name: "org.example.Dialog" }];
  const launch = { visibility, permits: new Set<string>(), catalog: {}, table: new OwnershipTable() };
  try {
    const listing = await handleRequest({ type: "request", id: 1, method: "listApplications", params: {} }, backend, launch);
    const applications = (listing.result as ListApplicationsResult).applications ?? [];
    const runtime = applications.find(application => application.running === "answering");
    expect(runtime?.name).toBe("yad");
    expect(runtime?.launchable).toBe(false);
    const query = await handleRequest({ type: "request", id: 2, method: "queryElements", params: { application: runtime?.name } }, backend, launch);
    const result = query.result as QueryElementsResult;
    expect(result).not.toHaveProperty("refusal");
    expect(result.elements?.length).toBeGreaterThan(0);
    expect(result.elements?.every(element => backend.applicationOfElement(element.id) === runtime?.name)).toBe(true);
    const denied = await handleRequest({ type: "request", id: 3, method: "openApplication", params: { name: runtime?.name } }, backend, launch);
    expect(denied.result).toHaveProperty("refusal");
    expect([...visibility]).toEqual(["yad"]);
  } finally {
    await backend.close();
  }
});
