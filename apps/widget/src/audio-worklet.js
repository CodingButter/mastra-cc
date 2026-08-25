class Pcm16Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;
    for (const sample of channel) {
      this.pending.push(Math.max(-1, Math.min(1, sample)));
    }
    while (this.pending.length >= 320) {
      const out = new Int16Array(320);
      for (let i = 0; i < out.length; i += 1) {
        const sample = this.pending.shift();
        out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}

registerProcessor("mastra-pcm16-capture", Pcm16Capture);
