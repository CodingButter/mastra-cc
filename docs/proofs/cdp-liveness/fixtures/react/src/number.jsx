import { useState } from "react";
import { createRoot } from "react-dom/client";
// Publishes 0..1000 but keeps only values up to 100; anything above stays at the last kept value.
function App() {
  const [v, setV] = useState("");
  return (<><input id="field" type="number" aria-label="Amount" min="0" max="1000" value={v} onChange={(e) => { if (Number(e.target.value) <= 100) setV(e.target.value); }} /><output id="state">{v}</output></>);
}
createRoot(document.getElementById("root")).render(<App />);
