export interface FaceAudioBridge {
  sendMicrophoneSamples(samples: ArrayBuffer): void;
  microphoneFailed(message: string): void;
  onProviderAudio(listener: (chunk: Uint8Array) => void): () => void;
  onProviderAudioStopped(listener: () => void): () => void;
}

export async function startRendererAudio(bridge: FaceAudioBridge): Promise<() => Promise<void>> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const capture = new AudioContext({ sampleRate: 16_000 });
  const playback = new AudioContext({ sampleRate: 24_000 });
  if (capture.sampleRate !== 16_000 || playback.sampleRate !== 24_000) {
    stream.getTracks().forEach((track) => track.stop());
    await Promise.all([capture.close(), playback.close()]);
    throw new Error(`unsupported audio rates: capture=${capture.sampleRate}, playback=${playback.sampleRate}`);
  }
  await capture.audioWorklet.addModule("./audio-worklet.js");

  const source = capture.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(capture, "mastra-pcm16-capture");
  const sink = capture.createGain();
  sink.gain.value = 0;
  node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => bridge.sendMicrophoneSamples(event.data);
  source.connect(node);
  node.connect(sink);
  sink.connect(capture.destination);

  let playCursor = 0;
  let playbackQueue = Promise.resolve();
  let playbackGeneration = 0;
  const playing = new Set<AudioBufferSourceNode>();
  const stopProviderAudio = () => {
    playbackGeneration += 1;
    for (const output of playing) output.stop();
    playing.clear();
    playCursor = playback.currentTime;
  };
  const unsubscribeProviderAudioStopped = bridge.onProviderAudioStopped(stopProviderAudio);
  const unsubscribeProviderAudio = bridge.onProviderAudio((chunk) => {
    const generation = playbackGeneration;
    playbackQueue = playbackQueue.then(async () => {
      if (generation !== playbackGeneration) return;
      const sampleCount = Math.floor(chunk.byteLength / 2);
      if (sampleCount === 0) return;
      if (playback.state !== "running") await playback.resume();
      const samples = new Float32Array(sampleCount);
      const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      for (let i = 0; i < sampleCount; i += 1) samples[i] = view.getInt16(i * 2, true) / 0x8000;
      const buffer = playback.createBuffer(1, samples.length, 24_000);
      buffer.copyToChannel(samples, 0);
      const output = playback.createBufferSource();
      output.buffer = buffer;
      output.connect(playback.destination);
      output.onended = () => playing.delete(output);
      playing.add(output);
      const at = Math.max(playback.currentTime, playCursor);
      output.start(at);
      playCursor = at + buffer.duration;
    }).catch((error) => bridge.microphoneFailed(`playback failed: ${String(error)}`));
  });

  return async () => {
    unsubscribeProviderAudio();
    unsubscribeProviderAudioStopped();
    stream.getTracks().forEach((track) => track.stop());
    stopProviderAudio();
    await Promise.all([capture.close(), playback.close()]);
  };
}
