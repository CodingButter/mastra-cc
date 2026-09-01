"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, Hand, Loader2, MonitorCog, SendHorizonal } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";
import type { ControlMode, DemoEvent } from "../lib/events";

type Turn =
  | { kind: "you"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "tool"; name: string; params: unknown; summary?: string }
  | { kind: "handover"; reason: string; requestId: string; answered: boolean };

export function Desk({ desktopUrl }: { desktopUrl: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ControlMode>("view");
  const [reason, setReason] = useState<string | undefined>();
  const scroller = useRef<HTMLDivElement>(null);

  // The overlay follows the SERVER's answer, never a local guess: the lock and
  // the agent's waiting tool call are the same fact, and a browser that decided
  // for itself could show INTERACT while the agent was still typing.
  useEffect(() => {
    const source = new EventSource("/api/control");
    source.onmessage = (event) => {
      const state = JSON.parse(event.data) as { mode: ControlMode; reason?: string };
      setMode(state.mode);
      setReason(state.reason);
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const done = useCallback(async (requestId: string) => {
    await fetch("/api/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    setTurns((prior) =>
      prior.map((turn) =>
        turn.kind === "handover" && turn.requestId === requestId ? { ...turn, answered: true } : turn,
      ),
    );
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    const history = [...turns, { kind: "you" as const, text }];
    setTurns(history);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: history
          .filter((turn): turn is Extract<Turn, { kind: "you" | "agent" }> =>
            turn.kind === "you" || turn.kind === "agent",
          )
          .map((turn) => ({ role: turn.kind === "you" ? "user" : "assistant", content: turn.text })),
      }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (reader) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        apply(setTurns, JSON.parse(line) as DemoEvent);
      }
    }
    setBusy(false);
  }, [draft, busy, turns]);

  const yours = mode === "interact";

  return (
    <main className="flex h-screen gap-4 p-4">
      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <MonitorCog className="size-4" /> the desk
          </div>
          <Badge variant={yours ? "live" : "muted"}>
            {yours ? <Hand className="size-3" /> : <Eye className="size-3" />}
            {yours ? "INTERACT" : "VIEW"}
          </Badge>
        </header>
        <div className="relative flex-1">
          <iframe src={desktopUrl} title="desktop" className="size-full border-0" />
          {/* The lock itself. Transparent, absolute, and it swallows every
              pointer and key event - so a person watching an agent work cannot
              fight it for the mouse by accident. */}
          <div
            aria-hidden={!yours}
            className={cn(
              "absolute inset-0 transition-colors",
              yours ? "pointer-events-none" : "bg-background/10 backdrop-brightness-95",
            )}
          />
          {!yours && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-background/85 px-3 py-1 text-xs text-muted-foreground">
              the agent is working — your input is blocked
            </div>
          )}
          {yours && reason && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500/20 px-3 py-1 text-xs text-emerald-200">
              {reason}
            </div>
          )}
        </div>
      </section>

      <section className="flex w-[420px] shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <header className="border-b border-border px-4 py-3 text-sm font-medium text-muted-foreground">
          mastra-cc
        </header>
        <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-4">
          {turns.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask for something on that machine. If a step is yours to do — a sign-in, a password —
              it will hand you the keyboard and wait.
            </p>
          )}
          {turns.map((turn, index) => (
            <Bubble key={index} turn={turn} onDone={done} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> working
            </div>
          )}
        </div>
        <form
          className="flex gap-2 border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="what should it do?"
            disabled={busy}
          />
          <Button type="submit" size="icon" disabled={busy || !draft.trim()} aria-label="send">
            <SendHorizonal />
          </Button>
        </form>
      </section>
    </main>
  );
}

function Bubble({ turn, onDone }: { turn: Turn; onDone: (requestId: string) => void }) {
  if (turn.kind === "you") {
    return (
      <div className="ml-8 rounded-lg bg-primary/15 px-3 py-2 text-sm text-foreground">{turn.text}</div>
    );
  }
  if (turn.kind === "agent") {
    return <div className="whitespace-pre-wrap text-sm text-foreground">{turn.text}</div>;
  }
  if (turn.kind === "tool") {
    return (
      <details className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-mono">{turn.name}</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words">
          {JSON.stringify(turn.params)}
          {turn.summary ? `\n→ ${turn.summary}` : ""}
        </pre>
      </details>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
      <p className="text-emerald-100">{turn.reason}</p>
      <Button
        size="sm"
        className="mt-2"
        disabled={turn.answered}
        onClick={() => onDone(turn.requestId)}
      >
        {turn.answered ? "handed back" : "Done"}
      </Button>
    </div>
  );
}

function apply(setTurns: React.Dispatch<React.SetStateAction<Turn[]>>, event: DemoEvent) {
  setTurns((prior) => {
    const turns = [...prior];
    const last = turns[turns.length - 1];
    switch (event.type) {
      case "text":
        // Deltas append to the agent's current bubble; anything else - a tool
        // call, a handover - closes it, so the transcript reads in the order it
        // happened rather than collecting all prose at the bottom.
        if (last?.kind === "agent") turns[turns.length - 1] = { ...last, text: last.text + event.text };
        else turns.push({ kind: "agent", text: event.text });
        return turns;
      case "tool":
        turns.push({ kind: "tool", name: event.name, params: event.params });
        return turns;
      case "tool-result": {
        for (let i = turns.length - 1; i >= 0; i -= 1) {
          const turn = turns[i];
          if (turn.kind === "tool" && turn.name === event.name && turn.summary === undefined) {
            turns[i] = { ...turn, summary: event.summary };
            break;
          }
        }
        return turns;
      }
      case "control":
        if (event.mode === "interact" && event.requestId) {
          turns.push({
            kind: "handover",
            reason: event.reason ?? "your turn",
            requestId: event.requestId,
            answered: false,
          });
        }
        return turns;
      case "error":
        turns.push({ kind: "agent", text: `— ${event.message}` });
        return turns;
      default:
        return turns;
    }
  });
}
