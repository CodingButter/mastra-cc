# M6 Gmail permission composition

## Question

Does a fresh operator home receive exactly the restrictive Gmail authority tuple, with a runnable installed daemon tree, while the Stage 1 base does not?

## Producer

The uncommitted proof leg is:

```sh
bash .mastracode/plans/m6-stage2-gmail-permission-composition.proof/demo.sh <checkout>
```

It builds the real daemon, runs the real installer against a temporary prefix, reads only installed configuration metadata, and executes the installed daemon until its normal missing-`--backend` refusal proves that the emitted module tree resolves. It does not launch an application or read a browser profile.

## Red/green record

| Checkout | SHA | Verdict |
|---|---|---|
| Stage 1 base | `b4aa35f41da7fc90282e34fbd411aa7cbff7a5b8` | RED — `gmail-grants.json` is absent from the fresh installation |
| M6 Stage 2 composition | `d02d7e69787ee64dc72e913e1c6d39c3be9c9aa8` | GREEN — restrictive authority installed and composed |

The branch transcript records:

- launch authority: exactly `gmail`;
- effective observe visibility: exactly `gmail`, `chrome`;
- durable launch capability: `gmail` only, with the default disabled;
- audit destination: explicit protected path;
- operator files: mode `0600`;
- configuration and state directories: mode `0700`;
- installed daemon: complete module tree reaches the normal argument refusal.

## Executable widening checks

`node tools/mutations.mjs` executes both Stage 2 mutations:

- `m6-gmail-permit-removed`;
- `m6-gmail-grants-removed`.

Each focused mutation makes the build-independent startup-composition test go red on its checked-in unit assertion, and the runner restores the source afterward.

## Privacy review

The proof records authority names, generic installed paths, modes, commit SHAs, and verdicts only. It contains no mailbox content, email address, machine username, credential, token, cookie, or profile-derived data.
