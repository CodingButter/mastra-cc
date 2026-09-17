# ADR-0105: A picture says which part of the element it is

Date: 2026-09-17
Status: Accepted — CC-07 provenance contract; schema version 1.25.0. Supersedes the interim refusal in [ADR-0102](0102-refuse-native-partial-captures-without-provenance.md), whose "deferred stronger contract" this is.

## Evidence

ADR-0102 refused every clipped native capture because the image carried no record of which part of the element it showed, and a model that received the right half of a button and clicked the centre of the picture would press at three quarters of the button's width. The refusal was honest but blunt: an element hanging half off the display could not be looked at at all, and the adapter forwarded even complete pictures to the model as bare media with no text saying what they were pictures of.

## Decision

`capturedImage` gains four required fields, all filled by the daemon at capture time:

- `source`, always the literal `"visible-desktop"`: the pixels are whatever the desk shows in that rectangle, including windows drawn over the element. Occlusion is neither established nor ruled out.
- `clipped`: true when the display did not cover the whole element rectangle.
- `crop`, a new `captureCrop` type: where the picture lies inside the element as fractions of the element's own width and height. An unclipped picture is `0, 0, 1, 1`. A location `(u, v)` in the picture, each in 0 through 1, is at element fraction `(crop.x + u * crop.width, crop.y + v * crop.height)` — the fractions `clickElement` already accepts, so no screen coordinate crosses the wire.
- `capturedAt`: the daemon's epoch-millisecond clock when the pixels were read.

With the crop named, the daemon returns clipped pictures again instead of refusing them. Empty intersections are still refused: a picture of nothing is not a picture of the element. Every crop value is finite and within bounds by construction, and the desktop package exposes `locateInElement(image, u, v)` which validates the picture location and the crop before mapping, and refuses rather than clamps an out-of-range point.

The adapter's `toModelOutput` for `captureElement` now emits the media part **and** a text part naming the dimensions, whether the picture is clipped, the crop fractions, the source, and the mapping rule. Metadata that arrived on the wire is not discarded on the way to the model.

## Consequences

The schema digest changes; every consumer must be regenerated to 1.25.0 before it can speak to this daemon, which is the freeze gate's intended cost. The four new fields are required rather than optional so that a consumer cannot read a picture with no crop and quietly assume it is whole.

The crop is a capture-time relationship. It says where the picture was inside the element when the pixels were read; it does not promise the element is still there, still that size, or still showing that content. Bounds observation and capture remain non-atomic, and `capturedAt` dates the picture rather than guaranteeing anything after it. Callers must resolve the element again before an effect, and a layout change between capture and click is still theirs to notice. No capture token or stale-image rejection is introduced here.

## Verification

Unit fixtures with known pixels cover an unclipped capture, clipping on each of the four edges, a nonzero display origin, and the empty intersection that is still refused, each asserting the exact crop fractions and the pixels that came back. The mapping helper is tested on centre and edge locations of whole and clipped crops, and on refusing non-finite, negative, and over-one inputs. The adapter test shows the model receives the media part and the geometry text together.
