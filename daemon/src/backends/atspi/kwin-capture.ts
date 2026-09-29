import { spawn } from "node:child_process";
import { CancelledAtBoundaryError, cancellationSignal } from "../../cancellation.js";
import type { RawScreen } from "./capture.js";

const HELPER = "/usr/local/libexec/mastra-cc-kwin-capture";
const HEADER_LIMIT = 4096;
const PIXEL_LIMIT = 16 * 1024 * 1024;
export class KwinAcquisitionError extends Error {}
export class KwinFrameError extends Error {}

export function captureRoute(value = process.env.MASTRA_CC_ATSPI_CAPTURE): "xwd" | "kwin" {
  if (value === undefined || value === "") return "xwd";
  if (value === "kwin") return "kwin";
  throw new Error("MASTRA_CC_ATSPI_CAPTURE must be unset or exactly kwin");
}

export function decodeKwinFrame(frame: Buffer): RawScreen {
  const invalid = () => new KwinFrameError("invalid KWin helper frame");
  if (frame.length < 4) throw invalid();
  const length = frame.readUInt32BE(0);
  if (length === 0 || length > HEADER_LIMIT || frame.length < 4 + length) throw invalid();
  let header;
  try { header = JSON.parse(frame.subarray(4, 4 + length).toString("utf8")); } catch { throw invalid(); }
  if (!header || typeof header !== "object" || Array.isArray(header)) throw invalid();
  const { width, height, stride, bytes, layout } = header;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0 ||
      !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > PIXEL_LIMIT ||
      stride !== width * 3 || bytes !== stride * height || header.version !== 1 || header.format !== "RGB" ||
      header.x !== 0 || header.y !== 0 || header.scale !== 1 || !layout ||
      layout.outputs !== 1 || layout.x !== 0 || layout.y !== 0 || layout.scale !== 1 ||
      layout.width !== width || layout.height !== height || typeof layout.name !== "string" || layout.name.length === 0 ||
      frame.length !== 4 + length + bytes) throw invalid();
  return { width, height, originX: 0, originY: 0, pixels: frame.subarray(4 + length) };
}

/** A dedicated process group belongs to this acquisition, never to another request. */
export async function grabKwinPixels(): Promise<RawScreen> {
  const signal = cancellationSignal();
  if (signal?.aborted) throw new CancelledAtBoundaryError(0, 1);
  return new Promise((resolve, reject) => {
    const child = spawn(HELPER, [], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let diagnostic = "";
    let failure: Error | undefined;
    let closed = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const killGroup = (kind: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, kind); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") failure ??= new KwinFrameError("cannot terminate KWin helper group");
      }
    };
    const finish = () => {
      if (!closed || escalation !== undefined) return;
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else {
        try { resolve(decodeKwinFrame(Buffer.concat(chunks, size))); } catch (error) { reject(error); }
      }
    };
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      chunks.length = 0;
      killGroup("SIGTERM");
      // Do not cancel escalation when the leader exits: descendants can retain pipes.
      escalation = setTimeout(() => {
        killGroup("SIGKILL");
        escalation = undefined;
        finish();
      }, 500);
    };
    const abort = () => stop(new CancelledAtBoundaryError(0, 1));
    const deadline = setTimeout(() => stop(new KwinAcquisitionError("KWin acquisition exceeded ten seconds")), 10_000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (piece: Buffer) => {
      if (failure) return;
      size += piece.length;
      if (size > 4 + HEADER_LIMIT + PIXEL_LIMIT) return stop(new KwinFrameError("KWin helper exceeded output limit"));
      chunks.push(piece);
    });
    child.stderr.on("data", (piece: Buffer) => {
      if (failure) return;
      if (Buffer.byteLength(diagnostic) + piece.length > 8192) return stop(new KwinFrameError("KWin helper exceeded diagnostic limit"));
      diagnostic += piece.toString();
    });
    child.on("error", () => stop(new KwinAcquisitionError("KWin helper could not start")));
    // A leader can exit while descendants retain the capture pipes or run with
    // closed stdio. Its private group must not outlive acquisition.
    child.on("exit", () => killGroup("SIGKILL"));
    child.on("close", (code) => {
      closed = true;
      if (!failure && code !== 0) {
        const message = diagnostic.trim().split("\n").find(line => line.startsWith("capture:")) ?? "KWin helper failed";
        const unavailable = /NoAuthorized|unsupported|geometry disagree|dimensions disagree|layout changed|DBus failure/.test(message);
        stop(unavailable ? new KwinAcquisitionError(message) : new KwinFrameError(message));
      }
      finish();
    });
  });
}
