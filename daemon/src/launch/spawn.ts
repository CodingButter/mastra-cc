import { spawn } from "node:child_process";
import { normalise } from "../backends/atspi/names.js";
import type { LaunchCatalog, LaunchRecipe } from "./recipes.js";
import type { OwnershipTable } from "./table.js";

// The launch primitive: the capability half only (ADR-0019 - authority is
// checked by the caller BEFORE this module is ever consulted). Spawning is an
// argv array, never a shell: wire input selects a catalog key and never
// contributes argv content.

// The refusal names nothing about the filesystem - not the command, not a
// path, not whether anything by that name is installed.
export const NO_RECIPE_REFUSAL = "launch: nothing can be launched by that name";

function findRecipe(name: string, catalog: LaunchCatalog): LaunchRecipe | undefined {
  const wanted = normalise(name);
  for (const [key, recipe] of Object.entries(catalog)) {
    if (normalise(key) === wanted) return recipe;
  }
  return undefined;
}

/**
 * Launch a catalogued application with its accessibility enabling applied at
 * launch time (ADR-0027): the recipe's env is merged over the daemon's own.
 * The pid is recorded in the ownership table before this resolves; the entry
 * is removed when the direct child exits (see table.ts for the intended
 * fails-safe consequence for forking wrappers).
 */
export function launchApplication(
  name: string,
  catalog: LaunchCatalog,
  table: OwnershipTable,
): Promise<{ pid: number }> {
  const recipe = findRecipe(name, catalog);
  if (recipe === undefined) return Promise.reject(new Error(NO_RECIPE_REFUSAL));
  return new Promise((resolve, reject) => {
    const child = spawn(recipe.argv[0], recipe.argv.slice(1), {
      env: { ...process.env, ...recipe.env },
      shell: false,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      const pid = child.pid as number;
      table.record(pid, name);
      // diagnostics only - pids never appear on the wire
      process.stderr.write(`launched ${name} pid ${pid}\n`);
      resolve({ pid });
    });
    child.once("exit", () => {
      if (child.pid !== undefined) table.remove(child.pid);
    });
    child.unref();
  });
}

/**
 * The shutdown-cleanup half of "the daemon owns what it launched": SIGTERM
 * every live process the table still owns. It never signals a process outside
 * the table - owns() re-checks (pid, starttime) liveness, so a recycled pid
 * is never signalled.
 */
export function terminateOwned(table: OwnershipTable): void {
  for (const entry of table.entries()) {
    if (!table.owns(entry.pid)) continue;
    try {
      process.kill(entry.pid, "SIGTERM");
    } catch {
      // exited between the check and the signal - already not ours
    }
  }
}
