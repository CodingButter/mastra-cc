# Verified Mousepad Find/Replace — baseline

## Objective and provenance

A real agent must use the packed-and-installed desktop package and an isolated real Mousepad session to replace a literal token, save, and freshly verify the result. Independent checks must establish exact saved bytes, three replacements, and unchanged surrounding text across three predeclared randomized sessions. This is a bounded completion objective, not a general reliability claim; Phase 0 does not establish completion.

- Baseline date: September 6, 2026.
- Immutable DELIVERY_BASE: `4dbd8153d16405b3c84f36fafb8aeec677edf4fc`, verified by fetching `origin master`; identical to the research reference and PR #98 merge.
- Feature branch: `feat/mousepad-verified-find-replace`, in a separate worktree. The occupied original checkout and its unrelated files remain untouched.
- Prior work: [direct-label decision](../../02-DECISIONS/0095-explicit-labels-are-evidence-not-names.md) and [previous proof](../field-mapping-form-completion/phase4.md). That proof covered receipt forms and Xfce launcher editing, not Mousepad Find/Replace.
- Changed-area history identifies `55339eb` as direct-label implementation and `b60d8cd` as its final budget/replay hardening. No runtime or public contract changes belong to this baseline.

## Baseline verification

Fresh focused runs passed: native label tests 32/32; desktop adapter/prose tests 26/26; transport tests 97/97; historical evidence tests 10/10. Daemon and desktop `tsc --noEmit` both exited zero. The documented workspace build/lint/typecheck/test command passed 19/19 tasks, all cached; this is not fresh execution of every underlying test. Generation and installation succeeded without tracked dependency or lockfile changes.

Environment checks found Mousepad 0.6.1, Xvfb, private D-Bus, the executable AT-SPI bus launcher, Openbox, ffmpeg and ffprobe. A Google provider credential is present; provider authentication has not yet been exercised. No `.changeset/` directory exists at this baseline. No desktop interaction or provider request was made in Phase 0.

## Remaining evidence gates

Fresh native reciprocal measurements, calibrated persistence, installed adapter/provider dependency provenance, daemon/schema handshake, and public field-selection evidence remain Phase 1 work. Existing public contracts must be tried first. Any new or broadened observation requires explicit acceptance of its exact contract before implementation; direct labels must never silently become inherited labels.

Preserve every attempt and keep setup-invalid, functional failure, verification failure and success distinct. The known window-close timing flake remains a separate follow-up. Publication, push, PR and merge require fresh authorization.
