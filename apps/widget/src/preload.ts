import { contextBridge, ipcRenderer } from "electron";

import type { FaceState } from "./hiding-model.js";

contextBridge.exposeInMainWorld("mastraFace", {
  onState(listener: (state: FaceState) => void): void {
    ipcRenderer.on("face:state", (_event, state: FaceState) => listener(state));
  },
});
