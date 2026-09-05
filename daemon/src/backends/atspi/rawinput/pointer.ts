// DELIVERING A POINTER PRESS. The second file in the raw-input class, and it is
// here for the same reason the first one is: this is a route that reaches the
// desktop WITHOUT an interface the element published, so pin B8 fences it to
// this directory and nowhere else in the tree (ADR-0046 decision 8, ADR-0078).
//
// What makes it different from a screen-coordinate pointer - the thing this
// project spent its first year refusing to build - is that no coordinate ever
// crosses the wire. The caller names an ELEMENT and, if it wants, a fraction of
// that element's own rectangle. The rectangle is read from the platform HERE, at
// the moment of the press, out of the same Component interface every other verb
// in this backend already leans on. A coordinate that came from the caller would
// be a click on a place; a coordinate computed from bounds read a millisecond
// earlier is a click on a thing, and the daemon can say afterwards what thing it
// was.
//
// `GenerateMouseEvent` takes absolute screen pixels and a name, and like the
// keyboard half it answers `()` to a press that landed and to a press that went
// nowhere. So nothing here reports success. The caller reads the element back
// and compares (ADR-0047, ADR-0067 clause 5).

const DEVICE_EVENT_CONTROLLER = "org.a11y.atspi.DeviceEventController";
const REGISTRY_BUS = "org.a11y.atspi.Registry";
const REGISTRY_PATH = "/org/a11y/atspi/registry/deviceeventcontroller";
const COMPONENT_IFACE = "org.a11y.atspi.Component";

// The coordinate space asked of GetExtents. 0 is SCREEN, 1 is WINDOW. The
// number is written here rather than imported because there is no binding to
// import it from, and the distinction is load-bearing: a window-relative
// rectangle handed to an absolute press is a click at the wrong end of the
// desk. Named, so that a reader can see which of the two was chosen.
const COORD_TYPE_SCREEN = 0;

// The gesture names this platform's mouse route accepts. "b1c" is button one,
// click; "d" is the double. They are a closed set here for the same reason the
// keysym table is closed: a name this route cannot express must be refused by
// the layer above rather than approximated into a nearby button.
const GESTURES = {
  left: { single: "b1c", double: "b1d" },
  middle: { single: "b2c", double: "b2d" },
  right: { single: "b3c", double: "b3d" },
} as const;

export type PointerButton = keyof typeof GESTURES;

export const POINTER_BUTTONS = Object.keys(GESTURES) as readonly PointerButton[];

export function isPointerButton(name: string): name is PointerButton {
  return Object.prototype.hasOwnProperty.call(GESTURES, name);
}

export interface ScreenRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CallSeam {
  call(exchange: {
    destination: string;
    path: string;
    iface: string;
    member: string;
    signature?: string;
    body?: unknown[];
  }): Promise<unknown[]>;
}

interface NativeRef {
  busName: string;
  objectPath: string;
}

/**
 * Read the element's rectangle on the screen, in absolute pixels, as the
 * platform publishes it right now. Returns undefined when the element carries
 * no Component interface or answers with something that is not a rectangle -
 * the caller refuses on that rather than pressing at a default, because there
 * is no default place for a thing that has no place.
 */
export async function screenRectangle(seam: CallSeam, ref: NativeRef): Promise<ScreenRectangle | undefined> {
  let reply: unknown[];
  try {
    reply = await seam.call({
      destination: ref.busName,
      path: ref.objectPath,
      iface: COMPONENT_IFACE,
      member: "GetExtents",
      signature: "u",
      body: [COORD_TYPE_SCREEN],
    });
  } catch {
    return undefined;
  }
  const extents = Array.isArray(reply[0]) ? (reply[0] as unknown[]) : undefined;
  if (extents === undefined || extents.length < 4) return undefined;
  const numbers = extents.slice(0, 4).map((part) => Number(part));
  if (numbers.some((part) => !Number.isFinite(part))) return undefined;
  const [x, y, width, height] = numbers as [number, number, number, number];
  return { x, y, width, height };
}

/**
 * Press a pointer button at one absolute point. Returns nothing, for the same
 * reason emitChord returns nothing: the interface answers `()` to a press that
 * arrived and to a press that did not. A throw is a failure to SEND.
 *
 * The pointer is moved to the point and pressed in one call, because that is
 * what this interface offers: the gesture name carries the button and the
 * coordinates carry the place. Nothing here moves the pointer back afterwards -
 * a pointer is where the last thing to touch it left it, on every desk, and
 * pretending otherwise would be a claim about a device this daemon does not own.
 */
export async function emitClick(
  seam: CallSeam,
  point: { x: number; y: number },
  button: PointerButton,
  count: 1 | 2,
): Promise<void> {
  const gesture = count === 2 ? GESTURES[button].double : GESTURES[button].single;
  await seam.call({
    destination: REGISTRY_BUS,
    path: REGISTRY_PATH,
    iface: DEVICE_EVENT_CONTROLLER,
    member: "GenerateMouseEvent",
    signature: "iis",
    body: [Math.round(point.x), Math.round(point.y), gesture],
  });
}
