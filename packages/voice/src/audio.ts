export type CapturedAudioFormat = Readonly<{
  sampleRate: number;
  channels: number;
  sampleFormat: "s16le";
}>;

export type VoiceCaptureOptions = Readonly<{
  sampleRate: 16_000;
  channels: 1;
  sampleFormat: "s16le";
  fingerprintBins: 16;
  silenceFloor: 0.05;
}>;

export const VOICE_CAPTURE_OPTIONS: VoiceCaptureOptions = Object.freeze({
  sampleRate: 16_000,
  channels: 1,
  sampleFormat: "s16le",
  fingerprintBins: 16,
  silenceFloor: 0.05,
});

export type ProcessedCapture = Readonly<{
  normalized: Int16Array;
  fingerprint: readonly number[];
  parameters: Readonly<{
    input: CapturedAudioFormat;
    output: VoiceCaptureOptions;
  }>;
}>;

function decodeMono(raw: Buffer, format: CapturedAudioFormat): number[] {
  if (
    format.sampleFormat !== "s16le" ||
    !Number.isInteger(format.sampleRate) ||
    format.sampleRate <= 0 ||
    !Number.isInteger(format.channels) ||
    format.channels <= 0 ||
    raw.byteLength % (format.channels * 2) !== 0
  ) {
    return [];
  }

  const frames = raw.byteLength / (format.channels * 2);
  return Array.from({ length: frames }, (_, frame) => {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += raw.readInt16LE((frame * format.channels + channel) * 2);
    }
    return Math.round(sum / format.channels);
  });
}

export function normalizeCapturedAudio(
  raw: Buffer,
  input: CapturedAudioFormat,
  options: VoiceCaptureOptions = VOICE_CAPTURE_OPTIONS,
): Int16Array {
  const mono = decodeMono(raw, input);
  if (mono.length === 0) return new Int16Array();
  if (input.sampleRate === options.sampleRate) return Int16Array.from(mono);

  const outputLength = Math.floor((mono.length * options.sampleRate) / input.sampleRate);
  return Int16Array.from({ length: outputLength }, (_, index) => {
    const source = (index * input.sampleRate) / options.sampleRate;
    const left = Math.min(Math.floor(source), mono.length - 1);
    const right = Math.min(left + 1, mono.length - 1);
    const fraction = source - left;
    return Math.round(mono[left] + (mono[right] - mono[left]) * fraction);
  });
}

function phraseSamples(frames: Int16Array, silenceFloor: number): Int16Array {
  let peak = 0;
  for (const sample of frames) peak = Math.max(peak, Math.abs(sample));
  if (peak === 0) return new Int16Array();

  const threshold = peak * silenceFloor;
  let start = 0;
  while (start < frames.length && Math.abs(frames[start]) < threshold) start += 1;
  let end = frames.length - 1;
  while (end >= start && Math.abs(frames[end]) < threshold) end -= 1;
  return frames.slice(start, end + 1);
}

export function modelInputWindow(normalized: Int16Array): Float32Array {
  const phrase = phraseSamples(normalized, VOICE_CAPTURE_OPTIONS.silenceFloor);
  const output = new Float32Array(32_000);
  if (phrase.length === 0) return output;
  const peak = phrase.reduce((largest, sample) => Math.max(largest, Math.abs(sample)), 0);
  const sourceStart = Math.max(0, Math.floor((phrase.length - output.length) / 2));
  const copied = phrase.subarray(sourceStart, sourceStart + output.length);
  const targetStart = Math.max(0, Math.floor((output.length - copied.length) / 2));
  const scale = 0.95 / peak;
  for (let index = 0; index < copied.length; index += 1) output[targetStart + index] = copied[index]! * scale;
  return output;
}

export function fingerprintFrames(
  normalized: Int16Array,
  options: VoiceCaptureOptions = VOICE_CAPTURE_OPTIONS,
): readonly number[] {
  const phrase = phraseSamples(normalized, options.silenceFloor);
  if (phrase.length === 0) return [];

  const peak = phrase.reduce((largest, sample) => Math.max(largest, Math.abs(sample)), 0);
  return Array.from({ length: options.fingerprintBins }, (_, bin) => {
    const start = Math.floor((bin * phrase.length) / options.fingerprintBins);
    const end = Math.max(start + 1, Math.floor(((bin + 1) * phrase.length) / options.fingerprintBins));
    let energy = 0;
    for (let index = start; index < Math.min(end, phrase.length); index += 1) {
      const scaled = phrase[index] / peak;
      energy += scaled * scaled;
    }
    return Math.sqrt(energy / Math.max(1, end - start));
  });
}

export const ENROLMENT_CAPTURE_ADAPTER = Object.freeze({
  pipeline: normalizeCapturedAudio,
  options: VOICE_CAPTURE_OPTIONS,
});

export const LIVE_CAPTURE_ADAPTER = Object.freeze({
  pipeline: normalizeCapturedAudio,
  options: VOICE_CAPTURE_OPTIONS,
});

function processCapture(
  adapter: typeof ENROLMENT_CAPTURE_ADAPTER,
  raw: Buffer,
  input: CapturedAudioFormat,
): ProcessedCapture {
  const normalized = adapter.pipeline(raw, input, adapter.options);
  return {
    normalized,
    fingerprint: fingerprintFrames(normalized, adapter.options),
    parameters: { input, output: adapter.options },
  };
}

export function processEnrolmentCapture(raw: Buffer, input: CapturedAudioFormat): ProcessedCapture {
  return processCapture(ENROLMENT_CAPTURE_ADAPTER, raw, input);
}

export function processLiveCapture(raw: Buffer, input: CapturedAudioFormat): ProcessedCapture {
  return processCapture(LIVE_CAPTURE_ADAPTER, raw, input);
}
