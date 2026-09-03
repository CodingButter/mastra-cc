// WHETHER THIS BUILD CAN DELIVER A KEY AT ALL, asked before anyone is allowed
// to ask for one.
//
// This file ships an authority that governs nothing yet, and that ordering is
// deliberate (ADR-0066 clause 5): the switch is proven off, under test, before
// the thing it switches exists. What lives here today is only the question "is
// there a route on this platform" - the route itself arrives in the next
// schema version.
//
// THE SEAM IS NOT SPELLED AT-SPI, ON PURPOSE, for the same reason the
// accessibility seam is not: delivering a key is something every desktop
// platform can do and each one does differently. Nothing in this file names a
// bus, a protocol or an operating system.
//
// Why the reach question is separate from the permission question at all: the
// wire distinguishes "this machine's owner turned it off" from "the element
// never offered it, and no setting would change that"
// (protocol/schema.json:236). A build with no key route on this platform is
// the second kind. Reporting it as disabled-by-configuration would send an
// operator to add a flag that would not help, which is precisely the false
// belief that vocabulary exists to prevent.

export interface KeyDelivery {
  /**
   * The name of the route, for a human reading a log. Never load-bearing and
   * never on the wire: a caller that could see WHICH route answered would be a
   * caller writing platform-specific code against a platform-neutral contract.
   */
  readonly route: string;
}

/**
 * Whether this build has any way to deliver a key on the platform it is
 * running on. Undefined is not a failure and not a refusal - it is the honest
 * "there is no path here", and the capability is reported `not-exposed`.
 */
export type KeyDeliverySelection = KeyDelivery | undefined;
