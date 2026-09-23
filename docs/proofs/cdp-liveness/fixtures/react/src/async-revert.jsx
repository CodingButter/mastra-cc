import { useState } from "react";
import { createRoot } from "react-dom/client";
// Takes the edit, then puts the field back 10 ms later - inside the settle window.
function App() {
  const [v, setV] = useState("");
  return (<><input id="field" aria-label="Field" value={v} onChange={(e) => { setV(e.target.value); setTimeout(() => setV(""), 10); }} /><output id="state">{v}</output></>);
}
createRoot(document.getElementById("root")).render(<App />);
