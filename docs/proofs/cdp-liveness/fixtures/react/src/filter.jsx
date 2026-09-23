import { useState } from "react";
import { createRoot } from "react-dom/client";
// Refuses the letter "l": "hello" settles as "heo".
function App() {
  const [v, setV] = useState("");
  return (<><input id="field" aria-label="Field" value={v} onChange={(e) => setV(e.target.value.replace(/l/g, ""))} /><output id="state">{v}</output></>);
}
createRoot(document.getElementById("root")).render(<App />);
