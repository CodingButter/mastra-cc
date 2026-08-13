import type { Role } from "@mastra-cc/protocol-types";
import type { BackendChange, ChannelWatch } from "../../backend.js";
import { deriveId } from "../atspi/identity.js";
import { toNeutralRole } from "./roles.js";

// The browser's change stream (ADR-0039). The page pushes; nothing polls.
//
// Three pieces, in this order:
//
//   1. A binding (Runtime.addBinding) gives the page a function to call. The
//      resulting protocol messages carry no request id, which is precisely why
//      the rpc reader discards them - here they are routed instead.
//   2. A document-start script (Page.addScriptToEvaluateOnNewDocument)
//      installs the page-side machinery BEFORE page scripts run, so a
//      navigation cannot land in a document where the machinery is missing.
//   3. The observer is anchored on the WATCHED NODE, resolved through
//      DOM.resolveNode - never on the document. A change outside that subtree
//      is not observed, so it is never reported. Scope is the design; the
//      per-batch collapse below is only a backstop.
//
// What the page may report is identity, role and kind. The page-side source
// has NO code path that reads textContent, nodeValue or an attribute value -
// it cannot report content even if asked to. Content is available exactly one
// way, through attestElement, which runs the visibility gate (ADR-0032).

const BINDING = "__mastraCcChange";

// Installed at document start and in the document already loaded. Reads no
// text and no attribute values anywhere: a MutationRecord's target and node
// lists are references, and only their identity is ever used.
const PAGE_SOURCE = `(() => {
  if (window.__mastraCcStream) return;
  const stash = [];
  const watches = new Map();
  window.__mastraCcStream = {
    take: (index) => { const element = stash[index]; stash[index] = null; return element; },
    stop(watchId) {
      const entry = watches.get(watchId);
      if (!entry) return;
      watches.delete(watchId);
      entry.observer.disconnect();
      entry.rootWatch.disconnect();
    },
    watch(root, watchId) {
      const send = (payload) => {
        const binding = window.${BINDING};
        if (typeof binding === "function") binding(JSON.stringify(payload));
      };
      const observer = new MutationObserver((records) => {
        const seen = new Map();
        const note = (node, kind) => {
          const element = node && node.nodeType === 1 ? node : node && node.parentElement;
          if (!element) return;
          if (!seen.has(element)) seen.set(element, kind);
        };
        for (const record of records) {
          for (const node of record.addedNodes) note(node, "appeared");
          for (const node of record.removedNodes) note(node, "disappeared");
          if (record.type !== "childList") note(record.target, "changed");
        }
        const batch = [];
        for (const [element, kind] of seen) batch.push({ index: stash.push(element) - 1, kind });
        if (batch.length > 0) send({ watchId, batch });
      });
      observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
      const rootWatch = new MutationObserver(() => {
        if (root.isConnected) return;
        rootWatch.disconnect();
        observer.disconnect();
        watches.delete(watchId);
        send({ watchId, ended: true });
      });
      rootWatch.observe(document, { childList: true, subtree: true });
      watches.set(watchId, { observer, rootWatch });
    },
  };
})();`;

export interface CdpWatchAnchor {
  readonly targetId: string;
  readonly backendDOMNodeId?: number;
  readonly nodeId?: string;
  /** the neutral role the walk gave the watched root, echoed on its terminal event */
  readonly role: Role;
  /**
   * Ids this backend has already minted, by backend node id. A change to an
   * element the client has actually seen is reported under the SAME id the
   * walk gave it - otherwise the pointer would name something the client
   * cannot attest.
   */
  readonly known?: (backendNodeId: number) => { id: string; role: Role } | undefined;
}

export interface StreamDeps {
  /** one protocol call on the watched target; resolves to {result} or {error} */
  call(method: string, params: unknown): Promise<unknown>;
  /** every protocol message that answers no request; returns its own removal */
  onProtocolEvent(listener: (method: string, params: Record<string, unknown>) => void): () => void;
}

interface Reply {
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message?: string };
}

function resultOf(reply: unknown): Record<string, unknown> | undefined {
  const { result, error } = (reply ?? {}) as Reply;
  if (error !== undefined) return undefined;
  return result;
}

interface AxNodeReply {
  readonly role?: { readonly value?: unknown };
  readonly backendDOMNodeId?: number;
}

export async function openSubtreeStream(
  deps: StreamDeps,
  anchor: CdpWatchAnchor,
  watchedId: string,
  sink: (change: BackendChange) => void,
): Promise<ChannelWatch> {
  const watchId = `w${Math.random().toString(16).slice(2, 10)}`;
  let open = true;

  const end = (): void => {
    if (!open) return;
    open = false;
    removeListener();
    // The root is gone. The watch says which element it was watching and
    // stops; it is never re-resolved by name onto whatever took its place.
    sink({ id: watchedId, role: anchor.role, kind: "watchEnded" });
  };

  async function idFor(objectId: string): Promise<{ id: string; role: Role } | undefined> {
    // The accessibility tree is the same source the walk reads, so a role read
    // here is the role the walk would have given - which is what makes the
    // derived id the same id.
    const ax = resultOf(await deps.call("Accessibility.getPartialAXTree", { objectId, fetchRelatives: false }));
    const nodes = (ax?.nodes ?? []) as AxNodeReply[];
    const node = [...nodes].reverse().find((candidate) => candidate.backendDOMNodeId !== undefined);
    if (node?.backendDOMNodeId !== undefined) {
      const remembered = anchor.known?.(node.backendDOMNodeId);
      if (remembered !== undefined) return remembered;
      const { role } = toNeutralRole(String(node.role?.value ?? ""));
      return { id: deriveId(role, anchor.targetId, String(node.backendDOMNodeId)), role };
    }
    // A node the accessibility tree will not describe - a removed one, most
    // often - still has a stable backend node id, and the walk may already
    // have named it. If it never did, the client was never told this element
    // existed, and generic is the same answer the walk gives a role it cannot
    // map (ADR-0018 clause 3).
    const described = resultOf(await deps.call("DOM.describeNode", { objectId }));
    const backendNodeId = (described?.node as { backendNodeId?: number } | undefined)?.backendNodeId;
    if (backendNodeId === undefined) return undefined;
    return (
      anchor.known?.(backendNodeId) ?? {
        id: deriveId("generic", anchor.targetId, String(backendNodeId)),
        role: "generic" as Role,
      }
    );
  }

  async function report(index: number, kind: BackendChange["kind"]): Promise<void> {
    const evaluated = resultOf(await deps.call("Runtime.evaluate", {
      expression: `window.__mastraCcStream.take(${index})`,
    }));
    const objectId = (evaluated?.result as { objectId?: string } | undefined)?.objectId;
    if (objectId === undefined) return;
    try {
      const named = await idFor(objectId);
      if (named !== undefined && open) sink({ id: named.id, role: named.role, kind });
    } finally {
      await deps.call("Runtime.releaseObject", { objectId });
    }
  }

  const removeListener = deps.onProtocolEvent((method, params) => {
    if (!open) return;
    if (method === "Page.frameNavigated") {
      // The document the watched node lived in is gone, so the node is too.
      // Ending loudly beats a subscription that quietly watches nothing.
      const frame = params.frame as { parentId?: string } | undefined;
      if (frame?.parentId === undefined) end();
      return;
    }
    if (method !== "Runtime.bindingCalled" || params.name !== BINDING) return;
    let message: { watchId?: string; ended?: boolean; batch?: Array<{ index: number; kind: string }> };
    try {
      message = JSON.parse(String(params.payload));
    } catch {
      return;
    }
    if (message.watchId !== watchId) return;
    if (message.ended === true) {
      end();
      return;
    }
    for (const entry of message.batch ?? []) {
      void report(entry.index, entry.kind as BackendChange["kind"]);
    }
  });

  await deps.call("Runtime.enable", {});
  await deps.call("Page.enable", {});
  await deps.call("DOM.enable", {});
  await deps.call("Runtime.addBinding", { name: BINDING });
  await deps.call("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_SOURCE });
  await deps.call("Runtime.evaluate", { expression: PAGE_SOURCE });

  // The anchor. DOM.resolveNode turns the backend node id the walk recorded
  // into a page object, and the observer is installed ON THAT OBJECT.
  const resolved = resultOf(
    await deps.call(
      "DOM.resolveNode",
      anchor.backendDOMNodeId !== undefined
        ? { backendNodeId: anchor.backendDOMNodeId }
        : { nodeId: Number(anchor.nodeId) },
    ),
  );
  const rootObjectId = (resolved?.object as { objectId?: string } | undefined)?.objectId;
  if (rootObjectId === undefined) {
    removeListener();
    throw new Error(`the watched element "${watchedId}" no longer resolves in the page - nothing to anchor a watch on`);
  }
  await deps.call("Runtime.callFunctionOn", {
    objectId: rootObjectId,
    functionDeclaration: "function (watchId) { window.__mastraCcStream.watch(this, watchId); }",
    arguments: [{ value: watchId }],
  });
  await deps.call("Runtime.releaseObject", { objectId: rootObjectId });

  return {
    async close() {
      if (!open) return;
      open = false;
      removeListener();
      await deps.call("Runtime.evaluate", {
        expression: `(() => { const s = window.__mastraCcStream; if (s && s.stop) s.stop(${JSON.stringify(watchId)}); })()`,
      });
    },
  };
}
