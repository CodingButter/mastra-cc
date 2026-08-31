import { afterEach, expect, it } from "vitest";
import { SCHEMA_DIGEST } from "@mastra-cc/protocol-types";
import {
  type MockDaemon,
  mockSocketDaemon,
  mockWebSocketDaemon,
} from "../../../transport/src/__tests__/mock-daemon.js";
import { connect } from "../index.js";

// C4, asked of THIS package rather than of the transport underneath it.
//
// The transport already refuses a daemon whose schema digest differs, and is
// tested for it. What is untested there is whether the refusal survives the
// trip through a wrapper: a connect() that caught and re-threw, or logged and
// returned a client anyway, would leave an agent talking to a daemon it does
// not understand, and every test in the transport would still be green.
//
// The mock peers are imported from packages/transport, not rebuilt here. That
// is deliberate: B5 forbids socket code outside that package, and a test that
// hand-rolled its own listener to check the refusal would itself be the second
// dial the pin exists to prevent.

const WRONG_DIGEST = "f".repeat(64);
const daemons: MockDaemon[] = [];

afterEach(() => {
  for (const daemon of daemons.splice(0)) daemon.close();
});

for (const [dial, start] of [
  ["a socket dial", mockSocketDaemon],
  ["a URL dial", mockWebSocketDaemon],
] as const) {
  it(`refuses over ${dial}, naming both digests`, async () => {
    const daemon = await start(WRONG_DIGEST);
    daemons.push(daemon);

    const attempt = connect(
      daemon.socketPath !== undefined ? { socketPath: daemon.socketPath } : { url: daemon.url },
    );

    // Both digests, so the operator can see WHICH pair disagrees rather than
    // being told only that something does.
    await expect(attempt).rejects.toThrow(new RegExp(`${SCHEMA_DIGEST}[\\s\\S]*${WRONG_DIGEST}`));
  });
}
