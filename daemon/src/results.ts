// Result types as a route writes them (ADR-0113): the refusal is still the
// sentence, with its class stated beside it (audit.ts Classified). Only
// handleRequest's withoutInternals turns it into the wire's refusal object,
// so daemon code imports results from here and never from the wire package.
import type * as Wire from "@mastra-cc/protocol-types";
import type { Unwired } from "./audit.js";

export type AcquireAccessibilityResult = Unwired<Wire.AcquireAccessibilityResult>;
export type ActivateElementResult = Unwired<Wire.ActivateElementResult>;
export type AttestElementResult = Unwired<Wire.AttestElementResult>;
export type CaptureElementResult = Unwired<Wire.CaptureElementResult>;
export type ClearElementTextResult = Unwired<Wire.ClearElementTextResult>;
export type ClickElementResult = Unwired<Wire.ClickElementResult>;
export type DescribeAccessibilityResult = Unwired<Wire.DescribeAccessibilityResult>;
export type DescribeDesktopResult = Unwired<Wire.DescribeDesktopResult>;
export type DiscoverElementsResult = Unwired<Wire.DiscoverElementsResult>;
export type EditElementResult = Unwired<Wire.EditElementResult>;
export type ListApplicationsResult = Unwired<Wire.ListApplicationsResult>;
export type OpenApplicationResult = Unwired<Wire.OpenApplicationResult>;
export type QueryElementsResult = Unwired<Wire.QueryElementsResult>;
export type ReadElementContentResult = Unwired<Wire.ReadElementContentResult>;
export type RestartApplicationResult = Unwired<Wire.RestartApplicationResult>;
export type RevealElementResult = Unwired<Wire.RevealElementResult>;
export type SendKeyChordResult = Unwired<Wire.SendKeyChordResult>;
export type SetElementCaretResult = Unwired<Wire.SetElementCaretResult>;
export type SetElementTextResult = Unwired<Wire.SetElementTextResult>;
export type SetElementValueResult = Unwired<Wire.SetElementValueResult>;
export type SubmitElementResult = Unwired<Wire.SubmitElementResult>;
export type SubscribeElementResult = Unwired<Wire.SubscribeElementResult>;
export type TypeTextResult = Unwired<Wire.TypeTextResult>;
export type UnsubscribeElementResult = Unwired<Wire.UnsubscribeElementResult>;
