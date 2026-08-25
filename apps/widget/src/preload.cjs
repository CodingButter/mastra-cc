const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mastraFace", {
  onState(listener) {
    ipcRenderer.on("face:state", (_event, state) => listener(state));
    ipcRenderer.send("face:ready");
  },
  sendMicrophoneSamples(samples) {
    ipcRenderer.send("face:microphone", samples);
  },
  microphoneFailed(message) {
    ipcRenderer.send("face:microphone-failed", message);
  },
  onProviderAudio(listener) {
    const handler = (_event, chunk) => listener(chunk);
    ipcRenderer.on("face:provider-audio", handler);
    return () => ipcRenderer.removeListener("face:provider-audio", handler);
  },
  onProviderAudioStopped(listener) {
    const handler = () => listener();
    ipcRenderer.on("face:provider-audio-stopped", handler);
    return () => ipcRenderer.removeListener("face:provider-audio-stopped", handler);
  },
});
