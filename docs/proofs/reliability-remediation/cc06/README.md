# CC-06 — Unknown event origin, independent raw delivery

## Reproduce

```sh
pnpm exec turbo run build
node docs/proofs/reliability-remediation/cc06/demo.mjs
```

The demo imports built daemon, transport and desktop signal-provider artifacts. Two real Unix listeners serve independent scripted backends with the same application name. Two connections watch the first desktop and a third watches the second. Each receives a pointer before, during and after an operation. Response barriers drain the corresponding socket traffic; no sleeps or native timing guesses are used.

GREEN requires all nine pointers to survive, all origins to be `unattributed`, no cause IDs and zero default planning-notification attempts. The notification sink is synthetic: this proves attempted wakes, not framework persistence or live agent behavior. Realer native input would not add causal evidence to the protocol, and no native execution claim is made.

The optional argument selects another built checkout. The retained baseline is 00a9ad1, before CC-04/05 as well as CC-06: both changes are documented rather than presented as the immediate parent. On identical input, all baseline streams are external/self/external, including the independent desktop; three cause IDs and three default wake attempts appear. The attribution regression is independently reproduced against immediate pre-fix source before editing.

## Artifacts and boundaries

`with.txt` and `without.txt` retain built-demo transcripts. Compressed test, mutation and workspace transcripts record separate verification gates; tests are not the demonstration. Existing visibility checks remain required. Audit request identity is not event provenance.

The conservative external-only default is unchanged, but native streams are now unknown-origin and therefore do not wake planners automatically. Raw client listeners still receive them for active-task use. Explicit unknown-origin notification opt-in is tested separately, not advertised as loop-free. Whole-task state accounting and safe idle-wake integration remain follow-ups; so do human takeover, native cancellation and Mousepad visual acceptance.
