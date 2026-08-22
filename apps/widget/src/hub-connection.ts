import { dialLane, type LaneClient } from "@mastra-cc/transport";

import { applyFrame, INITIAL_FACE_STATE, type FaceState } from "./hiding-model.js";

export { applyFrame, INITIAL_FACE_STATE, type FaceState } from "./hiding-model.js";

// THE FACE'S ONE SOCKET (ADR-0041, ADR-0052).
//
// A client carries a microphone, a speaker, pixels and a socket - and nothing
// else. This module is the socket. It dials the hub's lane and hands frames to
// whatever renders them; it does not decide what they mean, does not call a
// model, and does not reach the daemon.
//
// THE DAEMON IS NOT THIS WIRE. `@mastra-cc/transport` exports both wires now,
// so the daemon client is one import away from here, and ADR-0052 records that
// as the cost of putting the carrier in that package. `connect()` and
// `defaultSocketPath()` are the daemon's, and this package's source test
// asserts the widget names neither.

export interface HubConnection {
  readonly connected: boolean;
  close(): Promise<void>;
}

export async function connectToHub(options: {
  socketPath: string;
  /** Called with the new state after every frame the wire delivered. */
  onState: (state: FaceState) => void;
}): Promise<HubConnection> {
  let state = INITIAL_FACE_STATE;
  let client: LaneClient;
  try {
    client = await dialLane({
      socketPath: options.socketPath,
      deliver: (frame) => {
        state = applyFrame(state, frame);
        options.onState(state);
      },
      // A REFUSED FRAME IS SAID OUT LOUD. A client that drops a frame silently
      // is a client that lies about what it heard, and the vocabulary
      // guarantee is only worth something if somebody can see it fire.
      onRefusal: (reason) => console.warn(reason),
    });
  } catch (cause) {
    // The hub not being up is not the face's fault and must not read as one.
    throw new Error(
      `widget: no hub is listening at ${options.socketPath} - the face has nothing to hear`,
      { cause },
    );
  }
  return {
    get connected() {
      return client.connected;
    },
    close: () => client.close(),
  };
}
