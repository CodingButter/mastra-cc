# M6 orchestrator launch seam

## Question

Can trusted hub orchestration launch one daemon-permitted, non-personal application while preserving the daemon's refusal unchanged for an unpermitted application, without exposing launch to the model?

## Producer

The uncommitted proof leg is rerun with:

```sh
pnpm turbo run build
bash .mastracode/plans/m6-stage3-orchestrator-launch-seam.proof/demo.sh
bash .mastracode/plans/m6-stage3-orchestrator-launch-seam.proof/demo.sh <base-worktree-path>
```

The proof client imports the built orchestrator seam. It does not use the human `hub --open` diagnostic path.

## Red/green record

| Checkout | SHA | Verdict |
|---|---|---|
| Stage 2 base | `708156762e0020955105ad31e50f4a137d4c3673` | RED — the built orchestrator seam does not exist |
| Stage 3 branch | `5ce67b1a` plus this proof | GREEN |

The green leg observed only structural and fixed proof metadata:

- `yad` was launched through the seam and appeared as an application window;
- the same seam requested `gmail` from a daemon without that permit;
- the refusal was byte-equal to the daemon's launch-gate refusal;
- Gmail and Chrome were never launched;
- proof-owned processes were cleaned up.

## Mechanical witness

`tools/__tests__/m6-stage3-launch-proof.test.mjs` requires the opposing verdicts, the built-seam import and call, the `yad` success, the byte-exact Gmail refusal, and cleanup. It also forbids personal-data fields, profile inspection, browser launch commands, and ambient process-command-line dumps.

## Privacy review

The proof did not launch Gmail or Chrome, inspect a profile, read mail, or record credentials, cookies, email addresses, mailbox strings, subjects, senders, snippets, usernames, home paths, process command lines, or desktop content. The only real application launched was the non-personal `yad` proof dialog.
