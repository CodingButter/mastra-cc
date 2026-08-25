export type CapturedAudioFormat = Readonly<{
  sampleRate: number;
  channels: number;
  sampleFormat: "s16le";
}>;

export type VoiceCaptureOptions = Readonly<{
  sampleRate: 16_000;
  channels: 1;
  sampleFormat: "s16le";
  silenceFloor: 0.05;
}>;

export const VOICE_CAPTURE_OPTIONS: VoiceCaptureOptions = Object.freeze({
  sampleRate: 16_000,
  channels: 1,
  sampleFormat: "s16le",
  silenceFloor: 0.05,
});

export const UTTERANCE_FRAME_SAMPLES = 320;
export const UTTERANCE_TRAILING_SILENCE_SAMPLES = 9_600;
export const UTTERANCE_MAX_SAMPLES = 192_000;
const UTTERANCE_SPEECH_RMS = 600;

export type UtteranceEndState = Readonly<{
  totalSamples: number;
  trailingSilenceSamples: number;
  speechBegan: boolean;
  ended: boolean;
  reason?: "trailing-silence" | "maximum-duration";
}>;

export function createUtteranceEndState(): UtteranceEndState {
  return { totalSamples: 0, trailingSilenceSamples: 0, speechBegan: false, ended: false };
}

export function advanceUtteranceEnd(state: UtteranceEndState, frame: Int16Array): UtteranceEndState {
  if (state.ended) return state;
  const totalSamples = state.totalSamples + frame.length;
  if (totalSamples >= UTTERANCE_MAX_SAMPLES) {
    return { ...state, totalSamples, ended: true, reason: "maximum-duration" };
  }
  const rms = frame.length === 0 ? 0 : Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
  const speechBegan = state.speechBegan || rms >= UTTERANCE_SPEECH_RMS;
  const trailingSilenceSamples = !speechBegan || rms >= UTTERANCE_SPEECH_RMS ? 0 : state.trailingSilenceSamples + frame.length;
  return {
    totalSamples,
    trailingSilenceSamples,
    speechBegan,
    ended: speechBegan && trailingSilenceSamples >= UTTERANCE_TRAILING_SILENCE_SAMPLES,
    reason: speechBegan && trailingSilenceSamples >= UTTERANCE_TRAILING_SILENCE_SAMPLES ? "trailing-silence" : undefined,
  };
}

export type ProcessedCapture = Readonly<{
  normalized: Int16Array;
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

export function overlappingWakeWindows(normalized: Int16Array): readonly Int16Array[] {
  const windowSamples = VOICE_CAPTURE_OPTIONS.sampleRate * 2;
  const strideSamples = VOICE_CAPTURE_OPTIONS.sampleRate / 2;
  if (normalized.length <= windowSamples) return [normalized];

  const starts: number[] = [];
  for (let start = 0; start + windowSamples <= normalized.length; start += strideSamples) starts.push(start);
  const finalStart = normalized.length - windowSamples;
  if (starts.at(-1) !== finalStart) starts.push(finalStart);
  return starts.map((start) => normalized.slice(start, start + windowSamples));
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

export const LIVE_CAPTURE_ADAPTER = Object.freeze({
  pipeline: normalizeCapturedAudio,
  options: VOICE_CAPTURE_OPTIONS,
});

export function processLiveCapture(raw: Buffer, input: CapturedAudioFormat): ProcessedCapture {
  return {
    normalized: LIVE_CAPTURE_ADAPTER.pipeline(raw, input, LIVE_CAPTURE_ADAPTER.options),
    parameters: { input, output: LIVE_CAPTURE_ADAPTER.options },
  };
}
