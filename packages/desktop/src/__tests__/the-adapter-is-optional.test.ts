import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { METHOD_DESCRIPTORS, METHOD_NAMES } from "@mastra-cc/protocol-types";
import { AtspiBackend, replayChannel, startServer } from "@mastra-cc/daemon";
import { connect } from "../index.js";
import { desktopTools } from "../mastra.js";

type DaemonServer = Awaited<ReturnType<typeof startServer>>;

const started: DaemonServer[] = [];
afterEach(async () => {
  for (const server of started.splice(0)) await new Promise((r) => server.close(r));
});

async function daemonOnATape(): Promise<string> {
  const socketPath = join(mkdtempSync(join(tmpdir(), "mastra-cc-adapter-")), "daemon.sock");
  started.push(
    await startServer({ socketPath, backend: new AtspiBackend(replayChannel("gtk-dialog"), "all") }),
  );
  return socketPath;
}

// THE ADAPTER IS A SUBPATH, NOT A DEPENDENCY.
//
// @mastra/core is a peer. The interesting failure is not "do the tools work" -
// it is a stray import that drags an agent framework into a runtime that never
// asked for one, which nobody notices until an install fails on someone else's
// machine.
describe("the Mastra adapter", () => {
  it("builds one tool per protocol method, described by the contract itself", async () => {
    const client = await connect({ socketPath: await daemonOnATape() });
    try {
      const tools = desktopTools(client);
      expect(Object.keys(tools).sort()).toEqual([...METHOD_NAMES].sort());
      for (const method of METHOD_NAMES) {
        expect(tools[method].id).toBe(method);
        // The description is GENERATED, not written here: comparing it to the
        // generated descriptor is what stops a hand-edited sentence drifting
        // away from the protocol it describes.
        expect(tools[method].description).toBe(METHOD_DESCRIPTORS[method].description);
        // The schema is the generated one, checked by what it ACCEPTS and
        // REFUSES rather than by object identity: the framework wraps whatever
        // it is handed, so identity would test the wrapper, not the contract.
        const schema = METHOD_DESCRIPTORS[method].params as {
          properties: Record<string, { type: string; enum?: string[] }>;
          required: string[];
        };
        const sample: Record<string, unknown> = {};
        for (const field of schema.required) {
          const spec = schema.properties[field];
          sample[field] = spec.enum ? spec.enum[0] : spec.type === "number" ? 0 : "el-0123456789ab";
        }
        const standard = (tools[method].inputSchema as { ["~standard"]: { validate: (v: unknown) => { issues?: unknown } } })["~standard"];
        expect(standard.validate(sample).issues).toBeUndefined();
        if (schema.required.length > 0) {
          expect(standard.validate({}).issues).toBeDefined();
        }
      }
    } finally {
      client.close();
    }
  });

  it("calls the daemon through the one client when a tool executes", async () => {
    const client = await connect({ socketPath: await daemonOnATape() });
    try {
      const tools = desktopTools(client);
      const execute = tools.queryElements.execute;
      if (!execute) throw new Error("the tool has no execute");
      const answer = (await execute({ role: "dialog" }, {} as never)) as { elements: unknown[] };
      expect(Array.isArray(answer.elements)).toBe(true);
    } finally {
      client.close();
    }
  });

  // C5. The base entry is what a runtime without an agent framework installs;
  // it is imported here in a child process whose resolution of @mastra/core is
  // broken on purpose, so an import added to src/index.ts tomorrow fails this
  // rather than failing a stranger's install.
  it("keeps the peer out of the base entry's module graph", () => {
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      // `from "x"`, a bare `import "x"`, and `import("x")` are all imports; a
      // guard that read only the first shape would miss the side-effect import,
      // which is exactly how a peer sneaks into a base entry.
      for (const match of source.matchAll(/from\s+"([^"]+)"|import\s+"([^"]+)"|import\("([^"]+)"\)/g)) {
        const specifier = match[1] ?? match[2] ?? match[3];
        if (!specifier) continue;
        expect(specifier.startsWith("@mastra/")).toBe(false);
        if (specifier.startsWith(".")) {
          walk(join(dirname(file), specifier.replace(/\.js$/, ".ts")));
        }
      }
    };
    walk(new URL("../index.ts", import.meta.url).pathname);
    // A guard that walked nothing would pass vacuously.
    expect(seen.size).toBeGreaterThan(0);
  });
});
