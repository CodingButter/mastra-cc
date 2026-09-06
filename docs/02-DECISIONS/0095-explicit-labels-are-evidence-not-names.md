# ADR-0095: Explicit labels are evidence, not names

- Date: 2026-09-06
- Status: Design frozen for implementation; Phase 1 recording checkpoints visually reviewed

## Measured problem

The unchanged receipt form exposes two unnamed native `text` controls. The measured traversal visits Total paid before Receipt number; the latter has the smaller screen y coordinate. Direct `LABELLED_BY` relations independently connect both controls to their labels. Setup-only calibration writes `CALIBRATION-7F29` and `123.45` through those measured associations, then invokes the published submit action. The actual output is exactly `CALIBRATION-7F29|123.45|\n`. The fixture is not reversed; the earlier agent selected the wrong fields.

Evidence: `docs/proofs/field-mapping-form-completion/inspect.pF79GR/`, particularly `receipt-native.json`, `receipt-public.json`, `receipt-calibration.json`, and `receipt/submission.txt`. Raw callback replies contain one relation array: `[[[2, [[bus, path]]]]]`. Properties.Get Parent returns the native `[bus, path]` reference in these captures. `evidence.test.mjs` checks measured exchanges, traversal reversal and bounded parent chains. These are isolated setup measurements, not model successes or daemon replay tapes.

Mousepad and Pluma place Find/Replace labels on composite controls rather than their editable children. Retain their rejected feasibility captures; do not copy parent labels onto children. Under delegated replacement-app selection, use Xfce's ordinary `exo-desktop-item-edit` instead. Its unnamed Name and Comment text controls have direct label relations.

## Public contract

Phase 2 adds optional `semanticElement.properties.labelObservation`, neither required nor nullable, and regenerates runtime validators and TypeScript from the schema. Examples:

```json
{"kind":"available","labels":["Receipt number"]}
```

```json
{"kind":"unavailable","reason":"out-of-scope"}
```

Available `labels: []` means successful measurement with no LABELLED_BY targets. Omission means this backend does not implement the observation; JSON serialization must preserve omission. CDP may omit it. Metadata contains strings only, never native references or additional actionable identities. Existing name, value, IDs, name matching, query filters and discovery remain unchanged. Limit enrichment to native text/textbox controls; labels are untrusted UI data, not instructions or a uniqueness guarantee.

Read only explicit LABELLED_BY targets. Deduplicate target references before reads; preserve duplicate strings from distinct targets and native strings verbatim, without trimming or normalization. Multiple labels remain multiple; do not select one. Maximum eight targets, 1024 Unicode code points per label, 4096 total. Breaches fail the entire observation, never return a partial answer.

| Condition | Observation |
| --- | --- |
| Unsupported native method | unavailable / not-exposed |
| Blank label in nonempty relation set, malformed reply, stale target, mixed readable/unreadable targets, timeout | unavailable / unreadable |
| Protected target or missing/failed ownership witness | unavailable / out-of-scope |
| Target/text limit or exhausted operation budget | unavailable / limit-exceeded |
| Successful empty LABELLED_BY set | available / empty labels |

An empty string label is unreadable; whitespace-only strings are also unreadable, but accepted strings are preserved without trimming. Check protected state/role after ownership and before Name. Never read label values. Unsupported errors must be positively identified, not inferred from arbitrary failures. Explicit unrecorded replay errors propagate instead of becoming unavailable.

Schema version is planned as 1.20.0 from 1.19.0. ADR-0073 records the additive/minor-version convention; ADR-0002 requires ADR, regeneration and golden fixtures. This phase does not change the schema. Digest handshake compatibility is still enforced; additive does not mean different-digest clients may connect.

## Ownership and bounded work

Carry the already-authorized native application root alongside each registered field reference, including attest and post-write rereads. Without that witness return out-of-scope. Reject different-bus relation targets before reading any properties. For same-bus targets, follow only Parent metadata with a visited set and at most 16 hops, requiring exact native-reference equality with the authorized application root. Missing parents, cycles, different roots and exhaustion fail out-of-scope. Read target Name only after ownership/protection checks; never register targets as identities or recursively traverse their relations. This is toolkit-reported ownership, not protection against a malicious authorized application.

All enrichment calls use the existing recorded channel seam. Each element has 250ms elapsed budget and each public operation has 500ms cumulative enrichment waiting, measured monotonically. A backend-wide slot admits one outstanding enrichment D-Bus call across concurrent operations. Hold it until the underlying promise actually settles, even after timeout. Busy callers do not queue and return unreadable; exhausted operation budgets return limit-exceeded. Late completion releases the slot but cannot change completed observations, identity registries or operations. Closing disables scheduling. These bounds do not cancel dispatched work or bound unrelated D-Bus/traversal time. Phase 2 tests 100 fields and concurrency with one hung call, 500ms plus 100ms scheduler tolerance, and safe recovery after late settlement.

## Replay

Existing captures record completed exchanges, not original timing or semantic outcomes. A late reply recorded after live timeout may replay immediately as available; this is an explicit limitation. A tape closed before that reply has a missing exchange and must raise UnrecordedExchangeError. Test both cases; never synthesize empty labels. No tape-format/timing redesign. Inventory impacted fixtures through regression tests and recapture necessary exchanges live with provenance.

## Ordinary application and independent oracle

The measured application name and exact grant are `exo-desktop-item-edit`; installed package `exo-utils` is recorded with executable hash in each accepted run. Launch `exo-desktop-item-edit "$RUN/launcher.desktop"` under private HOME, XDG configuration/runtime, D-Bus and Xvfb. The daemon grants only that application with existing edit, activate and rawInput capabilities; receipt uses a separate yad-only daemon. The harness never executes the launcher or installs it into a desktop directory.

Start from a private inert Application desktop file with Exec=/usr/bin/true. The later model task changes Name and Comment to fresh independent randomized safe tokens, saves, and verifies actual public field values. Reopening the file is setup/readback, not evidence that a model performed the task. An external read-only oracle compares all saved bytes, including unchanged executable/type and expected application-generated defaults; extra keys or content fail. `launcherOracle` in the evidence module freezes the measured serialization. Record this as bounded ordinary-app coverage, not general reliability or causal attribution from one trial. Receipt keeps its unchanged strict oracle and five-trial criterion.

## Costs and verification

Additional native calls can return unavailable under contention; existing tapes need live recapture; timed-out observations can differ from replay. Toolkit labels may be stale or misleading. The narrow design deliberately does not solve composite-control labels. Phase 2 must prove public metadata preservation and native RED/GREEN causality; Phase 3 must prove actual model completion and readback. This ADR claims neither.

Only isolated synthetic captures may be published, after secret/personal-data review. Native references are acceptable inside raw proof captures, not public metadata. Visual decoding is not visual review: a working image surface must still inspect recording checkpoints before Phase 1 passes.
