import { mkdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import {
  SCHEMA_DIGEST,
  PRIORITIES,
  PROTOCOL_VERSION,
  type Attribution,
  type ChangeEvent,
  type OpenApplicationResult,
  type Priority,
  type SemanticElement,
  type SubscribeElementResult,
  type UnsubscribeElementResult,
} from "@mastra-cc/protocol-types";
import {
  type Backend,
  type BackendChange,
  type BackendSubscription,
  UnknownSubscriptionError,
  UnwatchableElementError,
  WatchUnsupportedError,
} from "./backend.js";
import { normalise } from "./backends/atspi/names.js";
import { isVisible, type Visibility } from "./grants.js";
import { CATALOG, type LaunchCatalog } from "./launch/recipes.js";
import { findRecipe, launchApplication, NO_RECIPE_REFUSAL } from "./launch/spawn.js";
import { OwnershipTable } from "./launch/table.js";

// The daemon's socket server: newline-delimited JSON, digest handshake first,
// then requests dispatched through the effect-class gate. Accessibility access
// is serialised regardless of what Phase 6 measures - serialising is what
// makes an audit record attributable (docs/07-ROADMAP.md:92), and that reason
// is independent of whether concurrency is safe.

// Everything the launch path needs beyond the backend. The permit set is the
// AUTHORITY half (session-scoped, from --permit); the catalog is the
// CAPABILITY half (ADR-0019: different questions, different parties). The
// default context carries no permits, so a server started without them
// refuses every launch.
export interface LaunchContext {
  permits: ReadonlySet<string>;
  catalog: LaunchCatalog;
  table: OwnershipTable;
  /** bounded poll for the launched application to appear in the tree */
  pollBudgetMs?: number;
  pollIntervalMs?: number;
}

const NO_PERMITS: LaunchContext = { permits: new Set(), catalog: CATALOG, table: new OwnershipTable() };

// ONE constant for both the unknown name and the unpermitted name. The
// byte-equality IS the security property (ADR-0008 rule 6): a refusal must
// never reveal whether an application is installed on this machine.
export const UNAVAILABLE_REFUSAL = "no application by that name is available to this session";

export const ALREADY_RUNNING_REFUSAL =
  "that application is already running and was not opened by this daemon - launching a second copy is refused; the running copy must be closed first";

// Two browser identities cannot run at once through this daemon: the browser
// backend dials ONE debugging endpoint (backends/cdp/channel.ts), so a second
// profile would fight the first for it. ALREADY_RUNNING_REFUSAL cannot serve
// here - it says "was not opened by this daemon", which would be a lie about a
// browser this daemon launched itself (ADR-0038). Nothing is killed to make
// room (ADR-0027). Keep this on ONE line: a byte-comparison test copies it.
export const ONE_BROWSER_IDENTITY_REFUSAL = "refused by the launch gate: another browser identity opened by this daemon is already using the browser's debugging endpoint - one browser identity at a time; close it before opening another";

// A spawn that fails after authority and catalog both passed. The constant
// names nothing about the command or the filesystem - a raw spawn error would
// leak argv[0], which is platform vocabulary the wire must never carry (B10).
export const COULD_NOT_START_REFUSAL = "the application could not be started";

// A backend that throws while serving a method becomes THIS constant on the
// wire - never the raw error (the M2.1 lesson, commit 98ac7fd: a system error
// leaks transport and platform vocabulary). For the browser backend this is
// the everyday case, not the exotic one: an unreachable debugging endpoint is
// a browser this session cannot read.
export const BACKEND_UNREADABLE_REFUSAL = "the desktop could not be read by this session's backend";

// The scope gate (ADR-0037). Schema 1.2.0 defines the edit, activate and
// submit classes' element methods so a client can ask about them and hear a
// refusal that names itself - "not a method of the schema" cannot distinguish
// "not built yet" from "hidden". The handlers below are pure refusals: they
// never touch a backend (the Backend seam does not even carry these methods),
// and each constant names the check that ran, the method's class, and what
// would change the answer. Authority is checked before capability (ADR-0019),
// so submitElement's refusal is the scope gate's - never a claim about the
// attestation's validity, even though the contract requires one (ADR-0021:
// waiving it is inexpressible on the wire).
export const EDIT_SCOPE_REFUSAL =
  'refused by the scope gate: "editElement" is edit-class and this session holds no edit authority for any application - the grants surface for this class arrives with a later milestone, and until it does this method always refuses';

export const ACTIVATE_SCOPE_REFUSAL =
  'refused by the scope gate: "activateElement" is activate-class and this session holds no activate authority for any element - the grants surface for this class arrives with a later milestone, and until it does this method always refuses';

export const SUBMIT_SCOPE_REFUSAL =
  'refused by the scope gate: "submitElement" is submit-class and this session holds no submit authority for any application - authority is checked before the attestation is ever examined, the grants surface for this class arrives with a later milestone, and until it does this method always refuses';

// The change stream (ADR-0039). Both subscription methods are observe-class:
// a watch reads and cannot cause anything. They are on the wire before either
// route can serve them, on ADR-0037's reasoning - the contract is the thing
// being frozen, and a method that does not exist cannot be refused honestly.
// Until a backend can watch a subtree, these name the check that ran and what
// would change the answer; the behaviour arrives route by route, and the
// refusal for a route that will never serve it stays exactly here.
// A watch on an id this session's backend never answered. ONE constant for
// "no such element" and "an element inside an application this session cannot
// see": the byte-equality is the security property (ADR-0008 rule 6,
// ADR-0036), exactly as it is for an unavailable application.
export const SUBSCRIBE_UNKNOWN_REFUSAL =
  'refused by the change stream: no element with that id was ever answered by this daemon - a watch is established on something this session has read, and nothing else';

// A watch is per-connection state: the connection that asked is the one that
// is fed, and the watch dies with it. A subscribe arriving outside a
// connection has nowhere to be delivered, and an event with no listener is a
// watch that says nothing.
export const SUBSCRIBE_NO_CONNECTION_REFUSAL =
  'refused by the change stream: "subscribeElement" was called outside a connection - a watch is per-connection state, and there is nowhere to deliver its events';

export const SUBSCRIBE_PRIORITY_REFUSAL =
  `refused by the change stream: "priority" must be one of ${PRIORITIES.join(", ")} - the daemon carries the label back unread, but it will not carry one the schema does not define`;

export const SUBSCRIBE_UNSUPPORTED_REFUSAL =
  'refused by the change stream: "subscribeElement" is defined by the schema but this session\'s backend cannot yet watch an element for changes - the watch would be accepted and then say nothing, which is indistinguishable from a quiet desktop, so it is refused instead';

export const UNSUBSCRIBE_UNKNOWN_REFUSAL =
  'refused by the change stream: "unsubscribeElement" was given a subscription this connection does not hold - a watch is per-connection state, and ending one that was never established would report a change of state that did not happen';

// ---------------------------------------------------------------------------
// The change stream's server half (ADR-0039).
//
// A backend reports SHAPES - which element, what role, what kind of change -
// and states which application the watched root lives in. It cannot know what
// verb the daemon has in flight, so it never states an attribution. The server
// can know, because every backend call goes through the serialised chain
// below: at most one verb is open at a time.

interface Cause {
  causeId: string;
  /** the application the verb names, once the verb is allowed to name one */
  application?: string;
}

// The verb currently open in the serialised chain, or undefined for a quiet
// daemon. Observe-class methods never set it: reading causes nothing, so a
// change that arrives during a read was not caused by the read.
let inFlight: Cause | undefined;

function mintCauseId(): string {
  return `cause-${randomBytes(6).toString("hex")}`;
}

// A verb names its target once it is allowed to: openApplication does so only
// after the permit check has passed, because resolving a name against the
// catalog before authority would be the capability probe ADR-0019 forbids.
// Until a verb names one, every concurrent change is unattributed - the daemon
// abstains rather than guessing.
function causeNames(application: string): void {
  if (inFlight !== undefined) inFlight = { causeId: inFlight.causeId, application };
}

export interface AttributionStamp {
  attribution: Attribution;
  causeId?: string;
}

// The whole attribution rule, in one place. Three answers, and the third one
// is the point (ADR-0039, ADR-0032 clause 4).
export function attribute(changeApplication: string, cause: Cause | undefined = inFlight): AttributionStamp {
  if (cause !== undefined) {
    if (cause.application !== undefined && normalise(cause.application) === normalise(changeApplication)) {
      return { attribution: "self", causeId: cause.causeId };
    }
    // ADR-0039: a verb is open, but nothing binds THIS change to it - it
    // happened somewhere the verb does not reach. The honest answer is that we
    // do not know which it was, and the daemon says so instead of picking the
    // likelier story. Never external (that claims we know it was not us),
    // never self (that claims it was).
    return { attribution: "unattributed" };
  }
  // Nothing was in flight, so nothing of ours caused it. That is news, not an
  // alarm: it is recorded and never flagged.
  return { attribution: "external" };
}

interface OpenSubscription {
  readonly id: string;
  readonly priority: Priority;
  readonly application: string;
  readonly backendSubscription: BackendSubscription;
  /** false once the root vanished and the watch ended itself */
  alive: boolean;
}

// One connection's watches. The book belongs to the socket: it is created when
// the connection is accepted and emptied when it closes, and no watch outlives
// the client that asked for it.
export class SubscriptionBook {
  private readonly open = new Map<string, OpenSubscription>();
  constructor(
    private readonly emit: (event: ChangeEvent) => void,
    // Visibility is re-checked where events are STAMPED, not only where
    // subscriptions are created: a grant is a statement about now, and an
    // application that has left the visible set must stop being narrated
    // mid-watch (ADR-0036).
    private readonly visibility: Visibility = "all",
  ) {}

  async subscribe(backend: Backend, id: string, priority: Priority): Promise<string> {
    // The sink is installed before the subscription id exists, so it captures
    // the id by closure once it does. A change arriving in that window is
    // delivered, not dropped: the client asked to watch, and the daemon does
    // not decide the first change was less real than the rest.
    let subscriptionId = "";
    const backendSubscription = await backend.subscribeElement(id, (change: BackendChange) => {
      if (subscriptionId === "") return;
      this.deliver(subscriptionId, change);
    });
    subscriptionId = backendSubscription.subscriptionId;
    this.open.set(subscriptionId, {
      id,
      priority,
      application: backendSubscription.application,
      backendSubscription,
      alive: true,
    });
    return subscriptionId;
  }

  private deliver(subscriptionId: string, change: BackendChange): void {
    const entry = this.open.get(subscriptionId);
    if (entry === undefined || !entry.alive) return;
    // An application outside the visible set is ABSENT, not filtered-with-a-
    // notice: nothing is emitted at all, which is byte-identical to the quiet
    // desktop an ungranted application is supposed to look like.
    if (!isVisible(this.visibility, entry.application)) return;
    const stamp = attribute(entry.application);
    this.emit({
      subscriptionId,
      id: change.id,
      role: change.role,
      kind: change.kind,
      attribution: stamp.attribution,
      ...(stamp.causeId === undefined ? {} : { causeId: stamp.causeId }),
      priority: entry.priority,
      at: Date.now(),
    });
    if (change.kind === "watchEnded") {
      // The root is gone. The watch ends here and says which element it was
      // watching; it is NEVER re-anchored by name onto whatever took the
      // element's place (ADR-0038's lesson, ADR-0039).
      entry.alive = false;
      void entry.backendSubscription.close();
    }
  }

  async end(subscriptionId: string): Promise<boolean> {
    const entry = this.open.get(subscriptionId);
    if (entry === undefined) throw new UnknownSubscriptionError(subscriptionId);
    this.open.delete(subscriptionId);
    // Ending a watch that already ended itself is not an error: the answer
    // says the watch is not running, which is the state the caller wanted
    // either way.
    if (!entry.alive) return false;
    await entry.backendSubscription.close();
    return true;
  }

  async closeAll(): Promise<void> {
    for (const entry of this.open.values()) {
      if (entry.alive) await entry.backendSubscription.close();
    }
    this.open.clear();
  }

  get size(): number {
    return this.open.size;
  }
}

async function subscribeElement(
  params: { id?: unknown; priority?: unknown },
  backend: Backend,
  book: SubscriptionBook | undefined,
): Promise<SubscribeElementResult> {
  if (book === undefined) return { refusal: SUBSCRIBE_NO_CONNECTION_REFUSAL };
  const id = typeof params.id === "string" ? params.id : "";
  const priority = params.priority;
  if (typeof priority !== "string" || !(PRIORITIES as readonly string[]).includes(priority)) {
    return { refusal: SUBSCRIBE_PRIORITY_REFUSAL };
  }
  try {
    const subscriptionId = await book.subscribe(backend, id, priority as Priority);
    // The id is echoed so a client holding several watches can bind this
    // answer to the request that asked for it without keeping its own book.
    return { subscription: { subscriptionId, id, priority: priority as Priority } };
  } catch (error) {
    if (error instanceof UnwatchableElementError) return { refusal: SUBSCRIBE_UNKNOWN_REFUSAL };
    if (error instanceof WatchUnsupportedError) return { refusal: SUBSCRIBE_UNSUPPORTED_REFUSAL };
    throw error;
  }
}

async function unsubscribeElement(
  params: { subscriptionId?: unknown },
  book: SubscriptionBook | undefined,
): Promise<UnsubscribeElementResult> {
  const subscriptionId = typeof params.subscriptionId === "string" ? params.subscriptionId : "";
  if (book === undefined) return { refusal: UNSUBSCRIBE_UNKNOWN_REFUSAL };
  try {
    return { ended: await book.end(subscriptionId) };
  } catch (error) {
    if (error instanceof UnknownSubscriptionError) return { refusal: UNSUBSCRIBE_UNKNOWN_REFUSAL };
    throw error;
  }
}

// The dispatch table names every method the daemon serves, its effect class,
// and WHEN its enforcement runs. B11 (tools/pins/b11.mjs, wired in this same
// commit) reads this table from source and asserts every non-observe entry is
// marked "before-call" - result-time enforcement is legitimate only for
// observe, because filtering a response does not unsend the email. The
// enforcement TIMING itself is pinned by the ordering test in
// __tests__/launch-authority.test.ts; the pin and the test together are B11.
// Keep each entry on ONE line: b11.mjs parses entries line-by-line, and a
// multi-line entry would silently escape its scrutiny.
type Handler = (params: unknown, backend: Backend, launch: LaunchContext, book?: SubscriptionBook) => Promise<unknown>;
const DISPATCH: Record<string, { effectClass: string; enforcement: string; handler: Handler }> = {
  queryElements: { effectClass: "observe", enforcement: "at-result", handler: (p, b) => b.queryElements((p ?? {}) as never) },
  attestElement: { effectClass: "observe", enforcement: "at-result", handler: (p, b) => b.attestElement((p ?? {}) as never) },
  subscribeElement: { effectClass: "observe", enforcement: "at-result", handler: (p, b, _l, k) => subscribeElement((p ?? {}) as never, b, k) },
  unsubscribeElement: { effectClass: "observe", enforcement: "at-result", handler: (p, _b, _l, k) => unsubscribeElement((p ?? {}) as never, k) },
  openApplication: { effectClass: "activate", enforcement: "before-call", handler: (p, b, l) => openApplication((p ?? {}) as { name?: string }, b, l) },
  editElement: { effectClass: "edit", enforcement: "before-call", handler: async () => ({ refusal: EDIT_SCOPE_REFUSAL }) },
  activateElement: { effectClass: "activate", enforcement: "before-call", handler: async () => ({ refusal: ACTIVATE_SCOPE_REFUSAL }) },
  submitElement: { effectClass: "submit", enforcement: "before-call", handler: async () => ({ refusal: SUBMIT_SCOPE_REFUSAL }) },
};

const POLL_BUDGET_MS = 10_000; // how long a launched app gets to become readable
const POLL_INTERVAL_MS = 250;

// A backend read that throws here means "no daemon-visible application by
// that name" - not a refusal. For the CDP backend that is literally true: a
// browser without its debug port is invisible to this backend, so unreachable
// and not-running are the same observation. This tolerance covers BOTH call
// sites (the pre-spawn already-running check and the post-spawn poll, where a
// per-tick exception is "not ready yet" within the poll budget) - without it,
// opening the browser while the browser is down would refuse instead of
// launching.
// The appears-as join (ADR-0038). A composed profile identity launches a
// browser that still calls itself "chrome" in the semantic tree, because the
// browser reports its own product name whichever profile it opened
// (backends/cdp/index.ts). So the tree is queried under the name the recipe
// says it will answer to, never the catalog key.
function treeNameOf(name: string, catalog: LaunchCatalog): string {
  return normalise(findRecipe(name, catalog)?.appearsAs ?? name);
}

async function findApplication(backend: Backend, name: string): Promise<SemanticElement | undefined> {
  try {
    const { elements } = await backend.queryElements({ role: "application", name });
    return elements.find((el) => el.role === "application" && normalise(el.name) === normalise(name));
  } catch {
    return undefined;
  }
}

// The launch handler. Order is the contract (ADR-0019): AUTHORITY first -
// the permit set is consulted before the catalog, the tree, or anything else,
// and an unpermitted name never reaches a capability probe, because the probe
// itself would leak that the application exists. Runs inside the serialised
// chain like every other operation.
async function openApplication(
  params: { name?: string },
  backend: Backend,
  launch: LaunchContext,
): Promise<OpenApplicationResult> {
  const name = typeof params.name === "string" ? params.name : "";
  if (!launch.permits.has(normalise(name))) {
    return { refusal: UNAVAILABLE_REFUSAL };
  }
  const budget = launch.pollBudgetMs ?? POLL_BUDGET_MS;
  const interval = launch.pollIntervalMs ?? POLL_INTERVAL_MS;
  const treeName = treeNameOf(name, launch.catalog);
  // Past the authority gate, this launch can say what it is acting on: a
  // change inside this application while the launch runs is ours (ADR-0039).
  causeNames(treeName);
  // The identity conflict guard (ADR-0038). It runs after authority and
  // BEFORE the already-running check below, and the order is the point: a
  // running chrome-work answers to the tree name "chrome", so the check below
  // would call our own browser one we did not open. Catalog keys are iterated
  // rather than table.entries(), because ownsName re-verifies (pid, starttime)
  // and so cannot fire on a process that has exited.
  for (const key of Object.keys(launch.catalog)) {
    if (normalise(key) === normalise(name)) continue;
    if (treeNameOf(key, launch.catalog) !== treeName) continue;
    if (launch.table.ownsName(key) !== undefined) return { refusal: ONE_BROWSER_IDENTITY_REFUSAL };
  }
  // Idempotent re-open: a live entry of ours wins - no second spawn, no
  // refusal, even when a foreign same-name copy is also running (the by-name
  // tree match cannot distinguish the two copies per element at this
  // segment's name-only granularity; M2.4's pid join will).
  if (launch.table.ownsName(name) === undefined) {
    const running = await findApplication(backend, treeName);
    if (running !== undefined) {
      // Running, and not ours: refuse, never kill (ADR-0027 - the asking
      // surface arrives with a later milestone).
      return { refusal: ALREADY_RUNNING_REFUSAL };
    }
    try {
      await launchApplication(name, launch.catalog, launch.table);
    } catch (error) {
      // The no-recipe refusal is already honest and leak-free; anything else
      // (a spawn failure) is normalised to a constant so a raw system error
      // never reaches the wire.
      const message = (error as Error).message;
      return { refusal: message === NO_RECIPE_REFUSAL ? message : COULD_NOT_START_REFUSAL };
    }
  }
  const deadline = Date.now() + budget;
  for (;;) {
    const application = await findApplication(backend, treeName);
    if (application !== undefined) return { application };
    if (Date.now() >= deadline) {
      return {
        refusal: `the application was opened but did not become readable within ${budget}ms - refusing to pretend it is ready`,
      };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

interface Request {
  type: "request";
  id: number;
  method: string;
  params?: unknown;
}

export interface HandledResponse {
  type: "response";
  id: number;
  result?: unknown;
  refusal?: string;
}

// Serialise every backend call: one at a time, in arrival order.
let chain: Promise<unknown> = Promise.resolve();
function serialised<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

export async function handleRequest(
  request: Request,
  backend: Backend,
  launch: LaunchContext = NO_PERMITS,
  book?: SubscriptionBook,
): Promise<HandledResponse> {
  const entry = DISPATCH[request.method];
  if (!entry) {
    return {
      type: "response",
      id: request.id,
      refusal:
        `refused by the effect-class gate: "${request.method}" is not a method of ` +
        `schema v${PROTOCOL_VERSION} - the daemon serves what the schema defines and nothing else`,
    };
  }
  // A non-observe entry without before-call enforcement is unrepresentable in
  // the table above (B11 reads the source to keep it that way); this check is
  // the runtime backstop with the same refusal shape.
  if (entry.effectClass !== "observe" && entry.enforcement !== "before-call") {
    return {
      type: "response",
      id: request.id,
      refusal: `refused by the effect-class gate: "${request.method}" is ${entry.effectClass}-class but not marked for before-call enforcement`,
    };
  }
  try {
    const result = await serialised<unknown>(async () => {
      // An effect-class verb is a cause: it gets an id, and it is open for
      // exactly as long as it runs. Observe-class methods are not causes, so
      // they leave the daemon quiet and changes during them read as external.
      inFlight = entry.effectClass === "observe" ? undefined : { causeId: mintCauseId() };
      try {
        return await entry.handler(request.params, backend, launch, book);
      } finally {
        inFlight = undefined;
      }
    });
    return { type: "response", id: request.id, result };
  } catch {
    // Whatever the backend threw stays on this side of the wire; the client
    // gets one honest constant, never the raw error (98ac7fd's lesson).
    return { type: "response", id: request.id, refusal: BACKEND_UNREADABLE_REFUSAL };
  }
}

export function startServer(options: {
  socketPath: string;
  backend: Backend;
  launch?: LaunchContext;
  /** the observe set composed at boot; events are filtered against it at emission */
  visibility?: Visibility;
}): Promise<Server> {
  const { socketPath, backend, launch, visibility = "all" } = options;
  mkdirSync(dirname(socketPath), { recursive: true });
  rmSync(socketPath, { force: true });

  const server = createServer((socket) => {
    let buffer = "";
    let helloDone = false;
    // The server-initiated direction (ADR-0039). An event answers nothing, so
    // it carries no id - a client that is not listening ignores it, and a
    // client that is gets it without having asked twice.
    const book = new SubscriptionBook((event) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify({ type: "event", event })}\n`);
    }, visibility);
    // A watch belongs to the connection that asked for it. When the socket
    // goes, the watches go with it - closed at the BACKEND, not merely
    // forgotten here: a forgotten watch is still being fed.
    const teardown = () => {
      void book.closeAll();
    };
    socket.on("close", teardown);
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.trim()) continue;
        let message: { type: string; digest?: string; id?: number; method?: string; params?: unknown };
        try {
          message = JSON.parse(line);
        } catch {
          socket.write(`${JSON.stringify({ type: "refusal", refusal: "daemon: not a JSON line" })}\n`);
          continue;
        }
        if (!helloDone) {
          if (message.type !== "hello" || typeof message.digest !== "string") {
            socket.write(`${JSON.stringify({ type: "refusal", refusal: "daemon: hello with a schema digest must come first" })}\n`);
            socket.end();
            return;
          }
          if (message.digest !== SCHEMA_DIGEST) {
            socket.write(
              `${JSON.stringify({
                type: "refusal",
                refusal:
                  `daemon: refused at connect - this daemon speaks schema digest ${SCHEMA_DIGEST} ` +
                  `but the transport was built against schema digest ${message.digest} (digest-agreement check)`,
              })}\n`,
            );
            socket.end();
            return;
          }
          helloDone = true;
          socket.write(`${JSON.stringify({ type: "hello", digest: SCHEMA_DIGEST, version: PROTOCOL_VERSION })}\n`);
          continue;
        }
        if (message.type === "request" && typeof message.id === "number" && typeof message.method === "string") {
          void handleRequest(message as Request, backend, launch, book).then((response) => {
            if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
          });
        } else {
          // Valid JSON that is not a well-formed request gets a named refusal,
          // never silence - a swallowed line leaves the client's promise
          // pending forever, which is a hang, not a refusal.
          socket.write(
            `${JSON.stringify({
              type: "refusal",
              refusal: 'daemon: a message after hello must be {type:"request", id:number, method:string} - refusing a malformed line',
            })}\n`,
          );
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}
