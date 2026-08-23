import { Check, Mic, RotateCcw, Settings2, Volume2 } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

import { advanceWakeWalkthrough, initialWakeWalkthrough } from "./wake-walkthrough.js";

function bootstrap(): Readonly<{ nonce: string; port: number }> | undefined {
  const values = new URLSearchParams(location.hash.slice(1));
  const nonce = values.get("bootstrap");
  const port = Number(values.get("controlPort"));
  if (nonce === null || !Number.isSafeInteger(port) || port <= 0) return undefined;
  history.replaceState(null, "", location.pathname);
  return { nonce, port };
}

export function App() {
  const [state, dispatch] = useReducer(advanceWakeWalkthrough, initialWakeWalkthrough);
  const [control, setControl] = useState<Readonly<{ base: string }> | undefined>();
  const sequence = useRef(1);

  async function command(body: Record<string, unknown>) {
    if (control === undefined) throw new Error("The widget control channel is disconnected.");
    const response = await fetch(`${control.base}/control/command`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, id: sequence.current++ }),
    });
    if (!response.ok) throw new Error("The widget rejected the enrolment command.");
    return (await response.json()) as Record<string, unknown>;
  }

  useEffect(() => {
    const launch = bootstrap();
    if (launch === undefined) {
      dispatch({ type: "failed", message: "Open wake enrolment from the running widget." });
      return;
    }
    const base = `http://127.0.0.1:${launch.port}`;
    void fetch(`${base}/control/bootstrap`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce: launch.nonce }),
    }).then((response) => {
      if (!response.ok) throw new Error();
      setControl({ base });
    }).catch(() => dispatch({ type: "failed", message: "The widget control channel could not be authorized." }));
  }, []);

  useEffect(() => {
    if (control === undefined) return;
    const timer = setInterval(() => void command({ type: "heartbeat" }).catch(() => dispatch({ type: "failed", message: "The widget disconnected." })), 2_000);
    return () => clearInterval(timer);
  }, [control]);

  useEffect(() => {
    if (state.phase === "cue") {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      oscillator.connect(context.destination);
      oscillator.frequency.value = 660;
      oscillator.start();
      oscillator.stop(context.currentTime + 0.18);
      oscillator.addEventListener("ended", () => { void context.close(); dispatch({ type: "cue-complete" }); });
    }
    if (state.phase === "countdown") {
      const timer = setTimeout(() => dispatch({ type: "countdown-complete" }), 1_500);
      return () => clearTimeout(timer);
    }
    if (state.phase === "capturing") {
      const takeId = `take-${crypto.randomUUID()}`;
      void command({ type: "capture", takeId }).then(() => dispatch({ type: "capture-complete", takeId })).catch((error: unknown) => dispatch({ type: "failed", message: error instanceof Error ? error.message : "Capture failed." }));
    }
  }, [state.phase]);

  async function publish() {
    dispatch({ type: "publish" });
    try {
      const result = await command({ type: "publish", takeIds: state.takes.map((take) => take.takeId) });
      dispatch({ type: "published", revision: Number(result.revision) });
    } catch (error) {
      dispatch({ type: "failed", message: error instanceof Error ? error.message : "Publication failed." });
    }
  }

  async function reset() {
    try { await command({ type: "reset" }); } catch { /* reset is locally final even if the session already expired */ }
    setControl(undefined);
    dispatch({ type: "reset" });
    dispatch({ type: "failed", message: "Enrolment was reset. Reopen it from the widget to begin again." });
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">MASTRA <span>ALPHA</span></div>
      <nav aria-label="Dashboard"><a className="active" href="/wake-enrolment"><Settings2 size={16}/> Wake enrolment</a></nav>
    </aside>
    <main>
      <header><p>VOICE</p><h1>Teach Mastra your wake phrase</h1><span>Five clean takes. Audio stays on this device.</span></header>
      <section className="panel" aria-live="polite">
        <div className="orb"><Mic size={38}/></div>
        <h2>{state.phase === "complete" ? "Wake phrase enrolled" : "Say “Hey Mastra”"}</h2>
        <p className="status">{state.error ?? ({ idle: "The widget will cue each recording and advance automatically.", cue: "Listen for the cue…", countdown: "Get ready…", capturing: "Speak now", ready: "All five takes are ready to publish.", publishing: "Publishing securely…", complete: `Template revision ${state.revision} is active.`, error: "Enrolment is closed." }[state.phase])}</p>
        <div className="takes">{[0,1,2,3,4].map((slot) => { const take = state.takes.find((item) => item.slot === slot); return <div className={take ? "take done" : "take"} key={slot}><span>{take ? <Check size={16}/> : slot + 1}</span><b>Take {slot + 1}</b>{take && state.phase === "ready" ? <button aria-label={`Re-record take ${slot + 1}`} onClick={() => dispatch({ type: "rerecord", slot })}><RotateCcw size={14}/></button> : null}</div>; })}</div>
        <div className="actions">
          {state.phase === "idle" ? <button className="primary" disabled={control === undefined} onClick={() => dispatch({ type: "start" })}><Volume2 size={16}/> Start five-take enrolment</button> : null}
          {state.phase === "ready" ? <button className="primary" onClick={() => void publish()}>Publish wake phrase</button> : null}
          {state.phase !== "idle" && state.phase !== "complete" ? <button className="secondary" onClick={() => void reset()}>Reset</button> : null}
        </div>
      </section>
    </main>
  </div>;
}
