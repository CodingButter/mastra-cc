// The one vocabulary the server streams and the browser renders.
//
// Deliberately not an agent-framework wire format: this demo streams four kinds
// of thing, and inventing a fifth should require editing this list.

export type ControlMode = "view" | "interact";

export type DemoEvent =
  | { type: "text"; text: string }
  | { type: "tool"; callId: string; name: string; params: unknown }
  | { type: "tool-result"; callId: string; name: string; summary: string }
  /** The agent asked for the keyboard. The desk unlocks and the browser shows a Done button. */
  | { type: "control"; mode: ControlMode; reason?: string; requestId?: string }
  | { type: "done" }
  | { type: "error"; message: string };
