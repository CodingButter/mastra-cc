import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { SemanticElement } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import { WITHHOLDS_NOTHING, type CapabilityConfiguration } from "../capabilities.js";
import type { LaunchCatalog } from "../launch/recipes.js";
import { OwnershipTable } from "../launch/table.js";
import { UNAVAILABLE_REFUSAL, handleRequest, type LaunchContext } from "../server.js";
import { observeOnlyEffects } from "./support/observe-only.js";

// RESTART ON THE WIRE (ADR-0065). Segment 03 phase 1 pinned what the daemon
// would SAY; this file pins what it DOES - which processes it signals, which
// signal it sends at which level, and the one case the whole feature is shaped
// around: an application that answers the close request with a dialog and is
// left alone.
//
// Real child processes throughout. A restart that is proven against a mocked
// kill is a restart proven against nothing.

const FAST = { pollBudgetMs: 400, pollIntervalMs: 20 };

interface Child {
  pid: number;
  alive: () => boolean;
  stop: () => void;
}

// A process that dies when asked (SIGTERM's default disposition), and one that
// refuses to - the two halves of "graceful means the application may say no".
async function child(refusesToClose: boolean): Promise<Child> {
  const script = refusesToClose
    ? "process.on('SIGTERM', () => {}); console.log('ready'); setTimeout(() => {}, 30000)"
    : "console.log('ready'); setTimeout(() => {}, 30000)";
  const spawned = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
  // Waiting for the process to SAY it is ready, not for the spawn to return:
  // a SIGTERM that arrives before the handler is installed kills a process
  // whose whole job in this file is to survive one.
  await new Promise((resolve, reject) => {
    spawned.stdout.once("data", resolve);
    spawned.once("error", reject);
  });
  spawned.stdout.destroy();
  spawned.unref();
  const pid = spawned.pid as number;
  return {
    pid,
    alive: () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    stop: () => {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    },
  };
}

function configured(level: string): CapabilityConfiguration {
  return { ...WITHHOLDS_NOTHING, restart: { fallback: level as never, applications: new Map() } };
}

const TEST_CATALOG: LaunchCatalog = { "test-app": { argv: ["sleep", "30"], env: {} } };

// A desk that answers whatever the test says is on it right now. `showing` is
// re-read on every query, so a test can close a window mid-restart the way a
// real application would.
function desk(showing: () => SemanticElement[]): Backend {
  const owner = new Map<string, string>();
  return {
    name: "restart-desk",
    ...observeOnlyEffects,
    queryElements: async ({ role, name }: { role?: string; name?: string }) => ({
      elements: showing().filter(
        (element) => (role === undefined || element.role === role) && (name === undefined || element.name === name),
      ),
    }),
    attestElement: async () => ({}),
    readElementContent: async () => ({}),
    subscribeElement: async () => ({}),
    unsubscribeElement: async () => undefined,
    applicationOfElement: (id: string) => owner.get(id),
    close: () => undefined,
    // dialogs in these tests belong to test-app; the map is written by element()
    __own: owner,
  } as unknown as Backend;
}

function element(backend: Backend, role: string, name: string, application?: string): SemanticElement {
  const id = `el-${role}-${name}`;
  if (application !== undefined) (backend as unknown as { __own: Map<string, string> }).__own.set(id, application);
  return { id, role, name, states: [], actions: [], content: { kind: "unavailable", reason: "not published" } } as unknown as SemanticElement;
}

function restart(name: string, backend: Backend, context: Partial<LaunchContext>) {
  return handleRequest({ type: "request", id: 1, method: "restartApplication", params: { name } }, backend, {
    permits: new Set(["test-app"]),
    catalog: TEST_CATALOG,
    table: new OwnershipTable(),
    ...FAST,
    ...context,
  });
}

function resultOf(response: { result?: unknown }) {
  return response.result as { application?: SemanticElement; blockedBy?: SemanticElement; refusal?: string };
}

describe("who may close a window", () => {
  it("a session that may not launch the application may not restart it either", async () => {
    const backend = desk(() => []);
    const answer = resultOf(await restart("test-app", backend, { permits: new Set(), capabilities: configured("force") }));

    // Byte-identical to the launch refusal: restarting starts an application,
    // so it is refused by the same authority and says the same thing.
    expect(answer.refusal).toBe(UNAVAILABLE_REFUSAL);
    expect(answer.application).toBeUndefined();
  });

  it("an unconfigured daemon refuses and names the setting - nothing is signalled", async () => {
    const spared = await child(false);
    const table = new OwnershipTable();
    table.record(spared.pid, "test-app");
    const backend = desk(() => []);
    try {
      const answer = resultOf(await restart("test-app", backend, { table }));

      expect(answer.refusal).toContain("restart.default");
      expect(spared.alive()).toBe(true);
    } finally {
      spared.stop();
    }
  });

  it("refuses to signal a process it did not open", async () => {
    const foreign = await child(false);
    const backend = desk(() => []);
    // The table owns SOMETHING - just not this. A daemon that reached for
    // whatever it happens to own would take down the wrong program, so the
    // ownership question has to be asked BY NAME.
    const table = new OwnershipTable();
    table.record(foreign.pid, "other-app");
    try {
      const answer = resultOf(await restart("test-app", backend, { table, capabilities: configured("force") }));

      expect(answer.refusal).toContain("does not signal processes it does not own");
      expect(foreign.alive()).toBe(true);
    } finally {
      foreign.stop();
    }
  });

  it("graceful: an application that puts up an unsaved-work dialog is left running, and the dialog is reported", async () => {
    const stubborn = await child(true);
    const table = new OwnershipTable();
    table.record(stubborn.pid, "test-app");
    const backend = desk(() => showing);
    const dialog = element(backend, "dialog", "Close Document", "test-app");
    const showing: SemanticElement[] = [element(backend, "application", "test-app"), dialog];
    try {
      const answer = resultOf(await restart("test-app", backend, { table, capabilities: configured("graceful") }));

      // THE case this feature is shaped around (ADR-0065 clause 4). The
      // application said no; the person with unsaved work is the one whose
      // answer counts.
      expect(answer.blockedBy?.id).toBe(dialog.id);
      expect(answer.refusal).toContain("does not answer that dialog");
      expect(answer.application).toBeUndefined();
      // And nothing escalated: graceful never becomes force because the
      // application was inconvenient.
      expect(stubborn.alive()).toBe(true);
    } finally {
      stubborn.stop();
    }
  });

  it("graceful: an application that is still there with no dialog is reported unconfirmed, not restarted", async () => {
    const stubborn = await child(true);
    const table = new OwnershipTable();
    table.record(stubborn.pid, "test-app");
    const backend = desk(() => showing);
    const showing: SemanticElement[] = [element(backend, "application", "test-app")];
    try {
      const answer = resultOf(await restart("test-app", backend, { table, capabilities: configured("graceful") }));

      expect(answer.refusal).toContain("neither closed nor put anything up");
      expect(answer.refusal).toContain("does not escalate because a timer expired");
      expect(answer.application).toBeUndefined();
      expect(stubborn.alive()).toBe(true);
    } finally {
      stubborn.stop();
    }
  });

  it("graceful: an application that closes is started again, and the answer is read back from the desk", async () => {
    const obliging = await child(false);
    const table = new OwnershipTable();
    table.record(obliging.pid, "test-app");
    let showing: SemanticElement[] = [];
    const backend = desk(() => showing);
    showing = [element(backend, "application", "test-app")];
    // The desk goes empty as soon as the process is gone, and the relaunched
    // copy appears once the spawn has happened - which is the only thing that
    // clears the second poll.
    const desktop = setInterval(() => {
      showing = obliging.alive() ? [element(backend, "application", "test-app")] : [];
    }, 5);
    try {
      const pending = restart("test-app", backend, { table, capabilities: configured("graceful") });
      // once it is gone, the relaunch happens; the poll then wants to SEE it
      const appear = setTimeout(() => {
        clearInterval(desktop);
        showing = [element(backend, "application", "test-app")];
      }, 120);
      const answer = resultOf(await pending);
      clearTimeout(appear);

      expect(answer.refusal).toBeUndefined();
      expect(answer.application?.name).toBe("test-app");
      expect(obliging.alive()).toBe(false);
      // and it did start something again: the table owns the new process
      expect(table.ownsName("test-app")).toBeDefined();
    } finally {
      clearInterval(desktop);
      obliging.stop();
      for (const entry of table.entries()) {
        try {
          process.kill(entry.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  });

  it("force: an application that refuses SIGTERM is taken down, because the operator wrote that down", async () => {
    const stubborn = await child(true);
    const table = new OwnershipTable();
    table.record(stubborn.pid, "test-app");
    let showing: SemanticElement[] = [];
    const backend = desk(() => showing);
    const desktop = setInterval(() => {
      showing = stubborn.alive() ? [element(backend, "application", "test-app")] : [];
    }, 5);
    try {
      const pending = restart("test-app", backend, { table, capabilities: configured("force") });
      const appear = setTimeout(() => {
        clearInterval(desktop);
        showing = [element(backend, "application", "test-app")];
      }, 120);
      const answer = resultOf(await pending);
      clearTimeout(appear);

      expect(answer.refusal).toBeUndefined();
      expect(answer.application?.name).toBe("test-app");
      // The SIGTERM-proof process is gone: only SIGKILL does that, and only
      // "force" sends it.
      expect(stubborn.alive()).toBe(false);
    } finally {
      clearInterval(desktop);
      stubborn.stop();
      for (const entry of table.entries()) {
        try {
          process.kill(entry.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  });
});
