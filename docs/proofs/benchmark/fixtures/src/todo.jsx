import { useState } from "react";
import { createRoot } from "react-dom/client";
// A controlled-input todo list. Every change to the list is reported to the
// harness, which checks what the page itself ended up holding.
function App() {
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState([]);
  const add = () => {
    if (!draft.trim()) return;
    const next = [...items, draft.trim()];
    setItems(next); setDraft("");
    fetch("/state", { method: "POST", body: JSON.stringify(next) });
  };
  return (<main><h1>Shopping list</h1>
    <input aria-label="New item" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
    <button onClick={add}>Add item</button>
    <ul aria-label="Items">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    <p>{items.length} items</p></main>);
}
createRoot(document.getElementById("root")).render(<App />);
