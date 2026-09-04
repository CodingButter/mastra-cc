import dbus from "dbus-native";
import type { AccessibilityLayer, AccessibilityReport } from "./index.js";

// The one implemented adapter. Everything platform-specific about "is this
// machine's accessibility layer switched on" lives behind this file's export
// and nothing above it names a bus.
//
// The reading is the same one an operator takes by hand: the session-scoped
// accessibility status object publishes a boolean saying whether the layer is
// on. It is NOT the accessibility bus the element backend talks to - that bus
// only exists once the layer is up, so asking it whether the layer is up
// answers the question with the answer. This adapter asks the session bus,
// which is there either way.

const STATUS_SERVICE = "org.a11y.Bus";
const STATUS_PATH = "/org/a11y/bus";
const STATUS_INTERFACE = "org.a11y.Status";
const PROPERTIES = "org.freedesktop.DBus.Properties";

// The single exchange this adapter performs, as a seam, so the tests drive a
// scripted bus instead of the machine's. Mirrors backends/atspi/channel.ts's
// call() shape rather than inventing a second one.
export interface StatusRead {
  (property: string): Promise<unknown>;
}

// The write half, a second seam rather than a flag on the first, so a test can
// drive a bus that answers reads and refuses writes - which is a real machine
// (a session where the status object is read-only), not a hypothetical one.
export interface StatusWrite {
  (property: string, value: boolean): Promise<void>;
}

// dbus-native hands a property back either unwrapped or as a [signature,
// [value]] pair, exactly as the element backend observed live (see nameOf in
// backends/atspi/index.ts). Both shapes are accepted here for the same reason.
function booleanOf(raw: unknown): boolean | undefined {
  const value = Array.isArray(raw) ? (Array.isArray(raw[1]) ? raw[1][0] : raw[1]) : raw;
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  return undefined;
}

export function accessibilityLayer(read: StatusRead, write: StatusWrite = liveStatusWrite()): AccessibilityLayer {
  return {
    acquirable: true,
    async acquire(): Promise<void> {
      // Switch the layer on through the SAME status object the report reads,
      // so the thing acquired and the thing measured are one object and not
      // two that could disagree. Nothing is returned and nothing is claimed:
      // the caller re-reads (ADR-0064 clause 6), and a write that failed
      // surfaces as a throw the server turns into an honest refusal rather
      // than a silent success.
      await write("IsEnabled", true);
      // The second property is not a nicety. IsEnabled alone brings up the
      // bus and the native widget trees; a Chromium-family browser reads
      // ScreenReaderEnabled to decide whether to publish its RENDERER tree at
      // all, so a desk acquired with IsEnabled only shows a browser's window
      // and dialogs with nothing underneath them - measured on the demo
      // container, where discovery over a Google Images page returned the
      // application, four windows and a dialog and not one page control
      // (ADR-0075). A failure here throws with the first write already
      // accepted, and that half state is exactly what the caller's re-read is
      // for: a half-acquired desk reads as a working one right up until an
      // agent goes looking inside a browser.
      await write("ScreenReaderEnabled", true);
    },
    async report(): Promise<AccessibilityReport> {
      let raw: unknown;
      try {
        raw = await read("IsEnabled");
      } catch {
        // A LAYER THAT DOES NOT ANSWER IS NOT A LAYER THAT IS OFF. The two
        // look identical from here - both produce silence - and they are
        // different facts: one is a desk with accessibility switched off, the
        // other is a daemon that could not reach the thing that would know.
        // The reason is deliberately free of platform words: an operator reads
        // it, and what they can act on is that the question went unanswered.
        return { state: "cannot-tell", reason: "this machine's accessibility layer did not answer" };
      }
      const enabled = booleanOf(raw);
      if (enabled === undefined) {
        // It answered something this adapter cannot read as yes or no.
        // Guessing either way would manufacture a measurement out of a parse
        // failure.
        return { state: "cannot-tell", reason: "this machine's accessibility layer answered in a form this daemon could not read" };
      }
      return { state: enabled ? "enabled" : "disabled" };
    },
  };
}

// The live reader. Lazy for the same reason the element channel is lazy:
// constructing the daemon must not touch a bus, so a build that never asks
// never connects.
export function liveStatusRead(): StatusRead {
  let session: ReturnType<typeof dbus.sessionBus> | null = null;
  return (property) =>
    new Promise((resolve, reject) => {
      session ??= dbus.sessionBus();
      session.invoke(
        {
          destination: STATUS_SERVICE,
          path: STATUS_PATH,
          interface: PROPERTIES,
          member: "Get",
          signature: "ss",
          body: [STATUS_INTERFACE, property],
        },
        (err, ...results) => {
          if (err) reject(new Error(`accessibility status read failed: ${JSON.stringify(err)}`));
          else resolve(results[0]);
        },
      );
    });
}

// The live writer, lazy on the same terms as the reader: a daemon that never
// acquires never connects, and a daemon started without the flag never reaches
// here at all because the gate runs first (server.ts).
export function liveStatusWrite(): StatusWrite {
  let session: ReturnType<typeof dbus.sessionBus> | null = null;
  return (property, value) =>
    new Promise((resolve, reject) => {
      session ??= dbus.sessionBus();
      session.invoke(
        {
          destination: STATUS_SERVICE,
          path: STATUS_PATH,
          interface: PROPERTIES,
          member: "Set",
          signature: "ssv",
          body: [STATUS_INTERFACE, property, ["b", value]],
        },
        (err) => {
          if (err) reject(new Error(`accessibility status write failed: ${JSON.stringify(err)}`));
          else resolve();
        },
      );
    });
}
