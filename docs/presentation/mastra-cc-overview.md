# Mastra CC: The Desktop, Native to Agents

Short presentation source. Claims are intentionally limited to what the repository currently implements or explicitly names as roadmap.

---

## 1. The Desktop, Native to Agents

**A truthful, actionable model of a live computer, at the level of meaning rather than pixels.**

Mastra CC turns the desktop into an agent peripheral: observable, interactive, event-driven, and accountable.

---

## 2. Pixels Make Agents Guess

Most computer controllers reduce the desktop to an image and ask a model to reconstruct the interface on every turn.

- Coordinates drift when windows move or layouts change
- Appearance does not reliably reveal state or capability
- The loop is open: act, capture, reinterpret, guess again
- A successful API call is easily mistaken for a successful desktop change

**Mastra CC asks the computer what things are.**

A control is a semantic element with a role, name, state, content, hierarchy, actions, and operations.

---

## 3. Query, Observe, Act, Prove

1. **Query** applications and elements by semantic role and name
2. **Observe** exact text, bounded content, numeric values, state, and available operations
3. **Interact** through element-native actions and typed operations
4. **Prove** effects through platform read-back and fresh observation
5. **Subscribe** to a subtree and let the desktop wake the agent when something changes

The result is a closed loop:

**observe → act → change event → confirm → continue**

---

## 4. A Clean Systems Boundary

**Mastra owns thinking. Mastra CC owns desktop truth.**

- **Mastra agent runtime:** models, loop, memory, workflows, judgment
- **`@mastra-cc/desktop`:** generated tools, agent instructions, signal provider
- **Transport:** one client, Unix socket or WebSocket, schema-digest handshake
- **Daemon:** the only process that touches the desktop, enforces authority, attributes changes, writes receipts
- **Backends:** platform-specific adapters behind one neutral contract

Mastra CC is a peripheral, not another assistant competing with the agent runtime.

---

## 5. Built for Mastra From the Ground Up

- One generated Mastra tool for every protocol method
- Tool schemas and descriptions come from the frozen protocol, not handwritten wrappers
- A native `SignalProvider` pushes desktop changes into an agent thread, with no polling
- One `MastraCC` instance equals one connection and one daemon-side identity
- Shipped instructions teach models how to navigate real desktops, recover, and verify
- The Mastra dependency is isolated to an optional `/mastra` entry point

**It plugs into Mastra's primitives instead of building a parallel agent framework.**

---

## 6. Truth Is a Feature

Mastra CC is designed to prevent false beliefs, not merely produce clicks.

- Protected controls return structured redaction, never secret content
- Partial tree walks refuse instead of pretending absence
- Unsupported operations and missing authority return actionable refusals
- Capability and user authority are separate questions
- Effects are attributed as self, external, or unknown
- Audit receipts are written at the point of effect by the daemon
- High-consequence submission is separated from ordinary editing and activation

**The system would rather say “I cannot truthfully answer” than invent success.**

---

## 7. Runs Where the Desktop Runs

The daemon belongs beside the user session, not beside the model.

- **Bare metal:** local Unix socket, native desktop session
- **Virtual machines:** same daemon and protocol inside the guest
- **Containers:** a real Webtop desktop harness proves semantic read, write, redaction, recreation, and persistence
- **Remote agents:** WebSocket transport reaches a daemon on another machine or namespace
- **Offline verification:** replay backends preserve real tree shapes for deterministic CI

The agent can live elsewhere. Desktop truth stays with the desktop.

---

## 8. Linux Today. A Platform-Neutral Core Tomorrow.

Current live platform support is Linux through AT-SPI, plus a CDP backend for Chrome and Electron surfaces.

The extension seam already exists:

- Neutral roles, states, content, methods, and refusals in the protocol
- A defined backend interface for observe, act, inventory, launch, and subscribe
- Shared backend conformance tests
- A registry that makes each backend explicit
- No Linux or toolkit vocabulary allowed in the public schema

A macOS, Windows, Android, or iOS implementation is a new platform adapter behind the same contract, not a new agent API. Platform consent, lifecycle, and automation constraints still need real engineering and proof.

---

## 9. The Powerful Idea

**Stop teaching agents to imitate a mouse. Give them a computer they can understand.**

Mastra CC makes the desktop:

- **semantic** enough to query
- **truthful** enough to trust
- **actionable** enough to do real work
- **event-driven** enough to stay fast
- **portable** enough to follow the desktop
- **native to Mastra** without owning the thinking

The desktop stops being a picture. It becomes a first-class agent peripheral.

---

## Source map

- Product thesis and boundaries: `README.md:3-45`, `docs/00-PRODUCT.md:10-75`
- Semantic contract and methods: `protocol/schema.json:1-140`, `protocol/schema.json:514-965`
- Mastra tools and instance identity: `packages/desktop/src/mastra.ts:17-152`
- Push signals: `packages/desktop/src/signals.ts:5-159`
- Single transport and dual dials: `packages/transport/src/index.ts:44-156`
- Backend seam and conformance intent: `daemon/src/backend.ts:32-40`, `daemon/src/backends/registry.ts:9-48`
- Authority, audit, and daemon ownership: `daemon/src/server.ts:81-152`
- Container proof: `infra/webtop/README.md:3-26`
- Portability roadmap: `docs/07-ROADMAP.md:322-329`
- Agent operating literacy: `docs/11-AGENT-INSTRUCTIONS.md:20-111`
