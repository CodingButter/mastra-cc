import type { KeyDeliverySelection } from "./index.js";

// WHICH ROUTE ANSWERS, decided once, at boot, from the platform this daemon is
// running on - never from anything a caller sends, for the same reason the
// accessibility adapter is chosen that way (select.ts there): a wire that
// could pick the route could ask a Linux daemon to answer as a Mac one, and
// the answer would be fiction.
//
// One platform has a measured route today. It was measured rather than
// assumed: on Linux the key is delivered by focusing the element through the
// action it already publishes and emitting on the accessibility registry, and
// the emission form matters - a keysym, not a keycode, because a keycode
// either repeats until released or is silently dropped (segment 04 spike,
// recorded in the plan's progress file).
//
// Every other platform gets `undefined`, which the capability reports as
// not-exposed. That is not a placeholder for work owed: it is the accurate
// statement that no setting on that machine would make this possible in this
// build.
export function selectKeyDelivery(platform: NodeJS.Platform = process.platform): KeyDeliverySelection {
  if (platform === "linux") return { route: "accessibility-registry" };
  return undefined;
}
