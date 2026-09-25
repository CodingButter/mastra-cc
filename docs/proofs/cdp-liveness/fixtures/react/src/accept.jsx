import { useState } from "react";
import { createRoot } from "react-dom/client";
// Accepts every edit into state and renders it.
function App() {
  const [v, setV] = useState("");
  return (<><input id="field" aria-label="Field" value={v} onChange={(e) => setV(e.target.value)} /><output id="state">{v}</output></>);
}
createRoot(document.getElementById("root")).render(<App />);
