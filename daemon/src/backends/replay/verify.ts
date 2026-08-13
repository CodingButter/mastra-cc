import { liveChannel } from "../atspi/channel.js";
import { exchangeKey } from "../atspi/channel.js";
import { loadTape } from "./index.js";

// --verify-tape: replay a tape against the LIVE bus and report every exchange
// whose reply changed. A corpus that has gone stale must be discovered, not
// trusted - but drift is the world changing, not a bug, so this reports and
// never fails on drift alone. It is a release-gate check run on a desktop
// machine (docs/proofs/README.md lists it with its cadence); it is not a CI
// step, because CI has no bus.

export interface VerifyReport {
  total: number;
  unchanged: number;
  drifted: number;
  samples: string[];
}

export async function verifyTape(fixture: string, log: (line: string) => void): Promise<VerifyReport> {
  // Only the exchanges are replayed against the live bus: a recorded event is
  // something the desktop volunteered, and there is no request to re-issue.
  const exchanges = loadTape(fixture).exchanges;
  const live = liveChannel();
  let unchanged = 0;
  const samples: string[] = [];
  try {
    for (const entry of exchanges) {
      try {
        const reply = await live.call(entry);
        if (JSON.stringify(reply) === JSON.stringify(entry.reply)) {
          unchanged += 1;
        } else if (samples.length < 5) {
          samples.push(`reply changed: ${exchangeKey(entry)}`);
        }
      } catch {
        if (samples.length < 5) samples.push(`no longer answers: ${exchangeKey(entry)}`);
      }
    }
  } finally {
    await live.close();
  }
  const drifted = exchanges.length - unchanged;
  log(`verify-tape: ${exchanges.length} exchange(s) replayed against the live bus - ${unchanged} unchanged, ${drifted} drifted`);
  for (const sample of samples) log(`verify-tape:   ${sample}`);
  if (drifted > 0) {
    log(
      "verify-tape: drift is the desktop changing, not a bug - if the corpus should follow, re-capture and record the diff",
    );
  }
  return { total: exchanges.length, unchanged, drifted, samples };
}
