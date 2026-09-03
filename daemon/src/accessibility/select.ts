import { type AccessibilityLayer, unsupportedPlatform } from "./index.js";
import { accessibilityLayer, liveStatusRead } from "./linux-atspi.js";

// WHICH ADAPTER ANSWERS, decided once, at boot, from the platform this daemon
// is running on - never from anything a caller sends. A wire that could pick
// the adapter would be a wire that could ask a Linux daemon to answer as a Mac
// one, and the answer would be fiction.
//
// One implemented platform today. The others are not lied about: they get an
// adapter that says cannot-tell and names the platform, which is the honest
// shape of "this build has no way to look" (see index.ts).
export function selectAccessibilityLayer(platform: NodeJS.Platform = process.platform): AccessibilityLayer {
  if (platform === "linux") return accessibilityLayer(liveStatusRead());
  return unsupportedPlatform(platform);
}
