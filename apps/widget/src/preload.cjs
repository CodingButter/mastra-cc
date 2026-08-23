const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mastraFace", {
  onState(listener) {
    ipcRenderer.on("face:state", (_event, state) => listener(state));
    ipcRenderer.send("face:ready");
  },
});
