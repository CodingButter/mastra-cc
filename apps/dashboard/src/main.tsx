import "@mastra/playground-ui/theme.css";
import "@mastra/playground-ui/style.css";
import "./style.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
