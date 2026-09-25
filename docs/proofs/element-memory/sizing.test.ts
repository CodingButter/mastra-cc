// Sizing proof (ADR-0116): 500 queries against a page whose every node is new
// each time - 50,100 distinct ids answered. Prints how many the backend still
// holds and the heap it costs. Copy into daemon/src/__tests__/ and run with
// vitest; see README.md.
import { it } from "vitest";
import { CdpBackend } from "../backends/cdp/index.js";
import type { CdpChannel } from "../backends/cdp/channel.js";

it("sizing", async () => {
  let next = 1;
  const channel = {
    exchange: async (e: { kind: string; method?: string }) => {
      if (e.kind === "version") return { Browser: "Chrome/151", webSocketDebuggerUrl: "ws://x" };
      if (e.kind === "list") return [{ id: "T", type: "page", title: "P" }];
      if (e.method === "Accessibility.getFullAXTree") {
        const nodes = Array.from({ length: 100 }, () => {
          const n = next++;
          return { nodeId: String(n), backendDOMNodeId: n, role: { value: "button" }, name: { value: `b${n}` } };
        });
        return { result: { nodes } };
      }
      return { result: {} };
    },
    watch: () => { throw new Error("unused"); },
    close: async () => {},
  } as unknown as CdpChannel;
  const backend = new CdpBackend(channel, "all");
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  for (let q = 0; q < 500; q++) await backend.queryElements({});
  global.gc?.();
  const after = process.memoryUsage().heapUsed;
  const held = (backend as unknown as { answered: { size: number } }).answered.size;
  console.log(`SIZING ids_answered=${next - 1} ids_held=${held} heap_growth_mb=${((after - before) / 1048576).toFixed(1)}`);
});
