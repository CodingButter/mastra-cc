import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnershipTable, registry, startServer, type Backend, type LaunchContext } from "@mastra-cc/daemon";
import { connect, type TransportClient } from "@mastra-cc/transport";
import { launchApplication } from "../orchestrator/launch.js";
import { mintToolSurface, type Tool } from "../tools/mint.js";

const EXPECTED_MODEL_TOOLS = ["attestElement", "listApplications", "queryElements"];
const UNAVAILABLE_REFUSAL =
  "refused by the launch gate: no application by that name is one this session may launch - listApplications names every application this machine has, each capability's state, and the setting behind every refusal";
const CAPABILITY_REFUSAL =
  'refused by the capability configuration: "openApplication" is launch-class and this machine\'s owner turned it off - the setting defaults.launch withholds it, and changing that setting is what would allow it';
const liveTables: OwnershipTable[] = [];
const clients: TransportClient[] = [];
const servers: Server[] = [];

async function daemonClient(launch: LaunchContext, backend: Backend = registry.replay({ visibility: "all" })): Promise<TransportClient> {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-orchestrator-launch-")), "daemon.sock");
  const server = await startServer({
    socketPath,
    backend,
    launch,
    visibility: new Set(["yad", "gmail"]),
  });
  const client = await connect({ socketPath });
  liveTables.push(launch.table);
  servers.push(server);
  clients.push(client);
  return client;
}

function observingClient(client: TransportClient): {
  readonly client: TransportClient;
  readonly openApplication: ReturnType<typeof vi.fn>;
} {
  const openApplication = vi.fn(client.openApplication);
  const forbidden = new Set(["listApplications", "queryElements", "attestElement"]);
  return {
    openApplication,
    client: new Proxy(client, {
      get(target, property, receiver) {
        if (property === "openApplication") return openApplication;
        if (typeof property === "string" && forbidden.has(property)) {
          return () => {
            throw new Error(`orchestration called forbidden transport method ${property}`);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }),
  };
}

function names(surface: ReadonlyMap<string, Tool>): string[] {
  return [...surface.keys()].sort();
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const table of liveTables.splice(0)) {
    for (const entry of table.entries()) {
      try {
        process.kill(entry.pid, "SIGTERM");
      } catch {
        // The defanged child may already have exited; there is nothing left to clean.
      }
    }
  }
});

describe("the orchestrator launches only through the daemon gate", () => {
  it("delegates one permitted identity exactly once and returns the daemon success unchanged", async () => {
    const table = new OwnershipTable();
    const replay = registry.replay({ visibility: "all" });
    let applicationReads = 0;
    const backend = new Proxy(replay, {
      get(target, property, receiver) {
        if (property !== "queryElements") return Reflect.get(target, property, receiver);
        return async (params: Parameters<Backend["queryElements"]>[0]) => {
          if (params.role === "application" && params.name === "yad" && applicationReads++ === 0) {
            return { elements: [] };
          }
          return await target.queryElements(params);
        };
      },
    });
    const raw = await daemonClient({
      permits: new Set(["yad"]),
      catalog: { yad: { argv: ["sleep", "30"], env: {} } },
      table,
      pollBudgetMs: 20,
      pollIntervalMs: 1,
    }, backend);
    const observed = observingClient(raw);

    const result = await launchApplication(observed.client, { name: "yad" });

    expect(observed.openApplication).toHaveBeenCalledOnce();
    expect(observed.openApplication).toHaveBeenCalledWith({ name: "yad" });
    expect(result.refusal).toBeUndefined();
    expect(result.application).toMatchObject({ role: "application", name: "yad" });
    expect(table.entries()).toHaveLength(1);
  });

  it("returns the daemon's byte-exact unpermitted refusal without touching the recipe", async () => {
    const table = new OwnershipTable();
    const raw = await daemonClient({
      permits: new Set(),
      catalog: { gmail: { argv: ["sleep", "30"], env: {} } },
      table,
    });
    const observed = observingClient(raw);

    const result = await launchApplication(observed.client, { name: "gmail" });

    expect(observed.openApplication).toHaveBeenCalledOnce();
    expect(result).toEqual({ refusal: UNAVAILABLE_REFUSAL });
    expect(result.refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(table.entries()).toHaveLength(0);
  });

  it("returns the daemon's capability refusal unchanged without touching the recipe", async () => {
    const table = new OwnershipTable();
    const raw = await daemonClient({
      permits: new Set(["yad"]),
      catalog: { yad: { argv: ["sleep", "30"], env: {} } },
      table,
      capabilities: {
        defaults: new Map([["launch", false]]),
        applications: new Map(),
      },
    });
    const observed = observingClient(raw);

    const result = await launchApplication(observed.client, { name: "yad" });

    expect(observed.openApplication).toHaveBeenCalledOnce();
    expect(result).toEqual({ refusal: CAPABILITY_REFUSAL });
    expect(result.refusal).toBe(CAPABILITY_REFUSAL);
    expect(table.entries()).toHaveLength(0);
  });

  it("keeps launch absent from the exact model-minted surface", async () => {
    const client = await daemonClient({ permits: new Set(), catalog: {}, table: new OwnershipTable() });
    const surface = mintToolSurface({ client });

    expect(names(surface)).toEqual(EXPECTED_MODEL_TOOLS);
    expect(surface.has("openApplication")).toBe(false);
  });
});
