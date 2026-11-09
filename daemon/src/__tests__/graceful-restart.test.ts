import { refusalText } from "./refusal-text.js";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { SemanticElement } from "@mastra-cc/protocol-types";
import type { Backend } from "../backend.js";
import type { LaunchCatalog } from "../launch/recipes.js";
import { OwnershipTable } from "../launch/table.js";
import { handleRequest, type LaunchContext } from "../server.js";
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
    catalog: TEST_CATALOG,
    table: new OwnershipTable(),
    ...FAST,
    ...context,
  });
}

function killEverything(table: OwnershipTable) {
  for (const entry of table.entries()) {
    try {
      process.kill(entry.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

function resultOf(response: { result?: unknown }) {
  return response.result as { application?: SemanticElement; blockedBy?: SemanticElement; refusal?: string };
}

describe("who may close a window", () => {
  it("refuses to signal a process it did not open", async () => {
    const foreign = await child(false);
    const backend = desk(() => []);
    // The table owns SOMETHING - just not this. A daemon that reached for
    // whatever it happens to own would take down the wrong program, so the
    // ownership question has to be asked BY NAME.
    const table = new OwnershipTable();
    table.record(foreign.pid, "other-app");
    try {
      const answer = resultOf(await restart("test-app", backend, { table, }));

      expect(refusalText(answer)).toContain("does not signal processes it does not own");
      expect(foreign.alive()).toBe(true);
    } finally {
      foreign.stop();
    }
  });

  it("reports an operating-system signal refusal as unconfirmed, not an application refusal", async () => {
    const owned = await child(true);
    const table = new OwnershipTable();
    table.record(owned.pid, "test-app");
    const backend = desk(() => [element(backend, "application", "test-app")]);
    const realKill = process.kill;
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === owned.pid && signal === "SIGTERM") {
        const error = new Error("operation not permitted") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return realKill(pid, signal);
    });
    try {
      const response = await restart("test-app", backend, { table });
      expect((response.result as { refusal?: { code?: string; message?: string } }).refusal).toMatchObject({
        code: "RestartNotConfirmed",
        message: "the signal could not be delivered; the application is still running",
      });
      expect(owned.alive()).toBe(true);
    } finally {
      kill.mockRestore();
      owned.stop();
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
      const answer = resultOf(await restart("test-app", backend, { table, }));

      // THE case this feature is shaped around (ADR-0065 clause 4). The
      // application said no; the person with unsaved work is the one whose
      // answer counts.
      expect(answer.blockedBy?.id).toBe(dialog.id);
      expect(refusalText(answer)).toContain("does not answer that dialog");
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
      const answer = resultOf(await restart("test-app", backend, { table, }));

      expect(refusalText(answer)).toContain("neither closed nor put anything up");
      expect(refusalText(answer)).toContain("does not escalate because a timer expired");
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
      const pending = restart("test-app", backend, { table, });
      // once it is gone, the relaunch happens; the poll then wants to SEE it
      const appear = setTimeout(() => {
        clearInterval(desktop);
        showing = [element(backend, "application", "test-app")];
      }, 120);
      const answer = resultOf(await pending);
      clearTimeout(appear);

      expect(refusalText(answer)).toBeUndefined();
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

  it("graceful: a dialog that was already open when the signal was sent is not called a refusal", async () => {
    // A dialog seen in the same instant as the SIGTERM proves nothing: a Find
    // box that happened to be up is not the application answering. Only a
    // dialog still there a poll later is an answer. This application takes the
    // signal and goes, with a dialog on the desk the whole time.
    const obliging = await child(false);
    const table = new OwnershipTable();
    table.record(obliging.pid, "test-app");
    // The dialog is up at the instant of the signal and gone by the time the
    // daemon next polls. That ordering is the rule under test, so it is tied
    // to the daemon's own first poll (its ownership check) rather than to a
    // wall-clock timer racing the child's exit - on a slow runner the timer
    // loses that race and the test would call a pre-existing dialog a refusal
    // for reasons that have nothing to do with the daemon.
    let polls = 0;
    const owns = table.owns.bind(table);
    table.owns = (pid: number) => {
      polls += 1;
      return owns(pid);
    };
    const backend = desk(() =>
      polls <= 1
        ? [element(backend, "application", "test-app"), element(backend, "dialog", "Find and Replace", "test-app")]
        : [element(backend, "application", "test-app")],
    );
    try {
      const answer = resultOf(await restart("test-app", backend, { table, }));

      expect(answer.blockedBy).toBeUndefined();
      expect(answer.application?.name).toBe("test-app");
      expect(obliging.alive()).toBe(false);
    } finally {
      obliging.stop();
      killEverything(table);
    }
  });

  it("graceful: an application that leaves the accessibility tree but keeps running is not declared closed", async () => {
    // Absence from the tree is not death. A daemon that read it as death would
    // start a second copy while the first is still holding the person's work,
    // and the ownership table would then have two processes under one name.
    const stubborn = await child(true);
    const table = new OwnershipTable();
    table.record(stubborn.pid, "test-app");
    const backend = desk(() => []); // nothing readable at all
    try {
      const answer = resultOf(await restart("test-app", backend, { table, }));

      expect(refusalText(answer)).toContain("neither closed nor put anything up");
      expect(answer.application).toBeUndefined();
      expect(stubborn.alive()).toBe(true);
      expect(table.entries().filter((entry) => entry.name === "test-app").length).toBe(1);
    } finally {
      stubborn.stop();
    }
  });


  it("rechecks the recorded pid and start time immediately before signalling", async () => {
    const pid = 424_242;
    const racing = {
      ownsName: () => ({ pid, starttime: "recorded", name: "test-app" }),
      owns: () => false,
      entries: () => [],
      record: () => undefined,
      remove: () => undefined,
    } as unknown as OwnershipTable;
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const backend = desk(() => [element(backend, "application", "test-app")]);
    try {
      const response = await restart("test-app", backend, { table: racing });
      expect((response.result as { refusal?: { code?: string } }).refusal?.code).toBe("RestartNotOurs");
      expect(kill.mock.calls.some(([signalled, signal]) => signalled === pid && signal === "SIGTERM")).toBe(false);
    } finally {
      kill.mockRestore();
    }
  });

  it("an application that exits between the ownership check and the signal is started again, not called foreign", async () => {
    // The gap is real: ownsName said yes, and the process was gone a
    // microsecond later. "This daemon did not open that application" would be
    // a refusal derived from a check that never ran - it DID open it, and the
    // close the caller asked for has already happened.
    const gone = await child(false);
    const table = new OwnershipTable();
    table.record(gone.pid, "test-app");
    const stale = table.entries()[0];
    gone.stop();
    while (gone.alive()) await new Promise((r) => setTimeout(r, 5));
    // the table would now answer "not ours" honestly, so the race is staged by
    // holding the answer it WOULD have given an instant earlier
    let ownsNameCalls = 0;
    const racing = Object.assign(Object.create(Object.getPrototypeOf(table)), table, {
      ownsName(name: string) {
        ownsNameCalls += 1;
        return ownsNameCalls === 1 ? stale : OwnershipTable.prototype.ownsName.call(this, name);
      },
      owns: () => false,
    }) as OwnershipTable;
    const backend = desk(() => showing);
    const showing: SemanticElement[] = [element(backend, "application", "test-app")];

    const answer = resultOf(await restart("test-app", backend, { table: racing, }));

    expect(refusalText(answer)).toBeUndefined();
    expect(answer.application?.name).toBe("test-app");
    killEverything(racing);
  });


  it("does not report success when a wrapper relaunch leaves the same application pid", async () => {
    const original = await child(false);
    const table = new OwnershipTable();
    table.record(original.pid, "test-app");
    const entry = table.entries()[0];
    const sameApplication = Object.assign(Object.create(Object.getPrototypeOf(table)), table, {
      ownsName: () => entry,
    }) as OwnershipTable;
    const backend = desk(() => [element(backend, "application", "test-app")]);

    const answer = resultOf(await restart("test-app", backend, { table: sameApplication }));

    expect(refusalText(answer)).toContain("no new owned process replaced");
    expect(answer.application).toBeUndefined();
    killEverything(sameApplication);
  });

  it("restarts by short name an application originally owned under its full id", async () => {
    const obliging = await child(false);
    const table = new OwnershipTable();
    table.record(obliging.pid, "org.example.test-app");
    let showing: SemanticElement[] = [];
    const backend = desk(() => showing) as Backend & { installedApplications: () => Promise<Array<{ name: string; diagnostic: {} }>> };
    backend.installedApplications = async () => [{ name: "org.example.test-app", diagnostic: {} }];
    showing = [element(backend, "application", "org.example.test-app")];
    const desktop = setInterval(() => {
      showing = obliging.alive() ? [element(backend, "application", "org.example.test-app")] : [];
    }, 5);
    const catalog: LaunchCatalog = { "org.example.test-app": { argv: ["sleep", "30"], env: {} } };
    try {
      const pending = handleRequest(
        { type: "request", id: 1, method: "restartApplication", params: { name: "test-app" } },
        backend,
        { catalog, table, ...FAST },
      );
      const appear = setTimeout(() => {
        clearInterval(desktop);
        showing = [element(backend, "application", "org.example.test-app")];
      }, 120);
      const answer = resultOf(await pending);
      clearTimeout(appear);
      expect(refusalText(answer)).toBeUndefined();
      expect(answer.application?.name).toBe("org.example.test-app");
      expect(table.ownsName("org.example.test-app")).toBeDefined();
    } finally {
      clearInterval(desktop);
      obliging.stop();
      killEverything(table);
    }
  });

});
