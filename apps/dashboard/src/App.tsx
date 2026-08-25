import { Settings2 } from "lucide-react";

export function App() {
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">MASTRA <span>ALPHA</span></div>
      <nav aria-label="Dashboard"><a className="active" href="/"><Settings2 size={16}/> Dashboard</a></nav>
    </aside>
    <main>
      <header><p>CONTROL</p><h1>Mastra dashboard</h1><span>Voice wake settings are managed by the local widget.</span></header>
    </main>
  </div>;
}
