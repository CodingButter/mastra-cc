import { describe, expect, it } from "vitest";
import type { BackendChange } from "../../../backend.js";
import { deriveId } from "../../atspi/identity.js";
import { openSubtreeStream, type StreamDeps } from "../subtree-stream.js";

// The browser stream, offline. No browser is started: the protocol calls are
// recorded and answered by hand, and the page's push is fed in as the event it
// would arrive as. What is being tested is the daemon's half - where the
// observer is installed, what is reported, and what happens when the watched
// root dies - not Chromium's.

const TARGET = "TARGET-1";
const ROOT_NODE = 40;
const CHILD_NODE = 41;

function harness(options: { axRole?: string; resolves?: boolean } = {}) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const listeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  const changes: BackendChange[] = [];

  const deps: StreamDeps = {
    async call(method, params) {
      calls.push({ method, params: (params ?? {}) as Record<string, unknown> });
      switch (method) {
        case "DOM.resolveNode":
          return options.resolves === false ? { error: { message: "No node with given id found" } } : { result: { object: { objectId: "OBJ-ROOT" } } };
        case "Runtime.evaluate":
          return { result: { result: { objectId: "OBJ-CHANGED" } } };
        case "Accessibility.getPartialAXTree":
          return {
            result: {
              nodes: [{ role: { value: options.axRole ?? "button" }, backendDOMNodeId: CHILD_NODE }],
            },
          };
        default:
          return { result: {} };
      }
    },
    onProtocolEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const push = (method: string, params: Record<string, unknown>) => {
    for (const listener of [...listeners]) listener(method, params);
  };

  return { calls, changes, deps, push, listenerCount: () => listeners.size };
}

const watchedId = deriveId("generic", TARGET, String(ROOT_NODE));

async function open(h: ReturnType<typeof harness>, known?: (backendNodeId: number) => { id: string; role: "button" } | undefined) {
  return openSubtreeStream(
    h.deps,
    { targetId: TARGET, backendDOMNodeId: ROOT_NODE, role: "generic", known },
    watchedId,
    (change) => h.changes.push(change),
  );
}

/** the payload the page-side binding sends, as the protocol delivers it */
function bindingCall(h: ReturnType<typeof harness>, payload: unknown) {
  const install = h.calls.find((c) => c.method === "Runtime.callFunctionOn");
  const watchId = (install?.params.arguments as Array<{ value: string }>)[0].value;
  h.push("Runtime.bindingCalled", {
    name: "__mastraCcChange",
    payload: JSON.stringify({ watchId, ...(payload as object) }),
  });
}

describe("the browser subtree stream", () => {
  it("anchors the observer on the resolved node, never on the document", async () => {
    const h = harness();
    await open(h);

    const resolve = h.calls.find((c) => c.method === "DOM.resolveNode");
    expect(resolve?.params).toEqual({ backendNodeId: ROOT_NODE });

    // The observer is installed by calling a function ON the resolved object.
    // Installing it by evaluating against the document would watch the whole
    // page and then filter, which is not the same thing: an unscoped observer
    // sees changes the client never asked about, and scope is the defence.
    const install = h.calls.find((c) => c.method === "Runtime.callFunctionOn");
    expect(install?.params.objectId).toBe("OBJ-ROOT");
    expect(String(install?.params.functionDeclaration)).toContain("watch(this,");

    const evaluated = h.calls.filter((c) => c.method === "Runtime.evaluate").map((c) => String(c.params.expression));
    expect(evaluated.some((expression) => expression.includes("document.body"))).toBe(false);
  });

  it("observes the anchored root's subtree, so a change outside it is never seen in the first place", async () => {
    const h = harness();
    await open(h);
    const source = String(h.calls.find((c) => c.method === "Page.addScriptToEvaluateOnNewDocument")?.params.source);
    // The change observer is pointed at the anchored root. Changes outside it
    // are not observed - not observed-then-filtered, which would mean the page
    // had to look at them first.
    expect(source).toContain("observer.observe(root, { childList: true, subtree: true");
    expect(source).not.toContain("observer.observe(document");
    // And nothing in the page's half reads content: it could not report text
    // even if it were asked to (ADR-0032 clause 2).
    for (const forbidden of ["textContent", "innerText", "nodeValue", "getAttribute", "innerHTML"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("installs the page machinery before page scripts run, so a navigation cannot drop it silently", async () => {
    const h = harness();
    await open(h);
    const documentStart = h.calls.find((c) => c.method === "Page.addScriptToEvaluateOnNewDocument");
    expect(documentStart).toBeDefined();
    expect(String(documentStart?.params.source)).toContain("MutationObserver");
  });

  it("reports a change under the id the walk already minted for that node", async () => {
    const h = harness();
    const minted = { id: deriveId("button", TARGET, String(CHILD_NODE)), role: "button" as const };
    await open(h, (backendNodeId) => (backendNodeId === CHILD_NODE ? minted : undefined));

    bindingCall(h, { batch: [{ index: 0, kind: "appeared" }] });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(h.changes).toEqual([{ id: minted.id, role: "button", kind: "appeared" }]);
  });

  it("says nothing about a push that names a different watch", async () => {
    const h = harness();
    await open(h);
    h.push("Runtime.bindingCalled", {
      name: "__mastraCcChange",
      payload: JSON.stringify({ watchId: "w-somebody-else", batch: [{ index: 0, kind: "changed" }] }),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.changes).toEqual([]);
  });

  it("ends the watch exactly once when the root leaves the document, naming the element it was watching", async () => {
    const h = harness();
    await open(h);

    bindingCall(h, { ended: true });
    bindingCall(h, { ended: true });
    bindingCall(h, { batch: [{ index: 0, kind: "changed" }] });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(h.changes).toEqual([{ id: watchedId, role: "generic", kind: "watchEnded" }]);
    // and it stopped listening: a closed watch is not merely quiet, it is off
    expect(h.listenerCount()).toBe(0);
  });

  it("ends the watch when the page navigates away from the document the root lived in", async () => {
    const h = harness();
    await open(h);
    h.push("Page.frameNavigated", { frame: { id: "FRAME-1" } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.changes).toEqual([{ id: watchedId, role: "generic", kind: "watchEnded" }]);
  });

  it("ignores a subframe navigation, which does not take the watched root with it", async () => {
    const h = harness();
    await open(h);
    h.push("Page.frameNavigated", { frame: { id: "FRAME-2", parentId: "FRAME-1" } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.changes).toEqual([]);
  });

  it("refuses to open a watch on an element that no longer resolves in the page", async () => {
    const h = harness({ resolves: false });
    await expect(open(h)).rejects.toThrow(/no longer resolves in the page/);
    // and it left nothing listening behind it
    expect(h.listenerCount()).toBe(0);
  });

  it("stops reporting once closed", async () => {
    const h = harness();
    const watch = await open(h);
    await watch.close();
    bindingCall(h, { batch: [{ index: 0, kind: "changed" }] });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.changes).toEqual([]);
  });
});
