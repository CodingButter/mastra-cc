# Truthful claims (audit M3, M5, M8, Low)

The branch's focused tests, run on the base (`fix/grant-identity`, 4a4a5d9) and on the branch.

- [without.txt](without.txt): **RED**, 8 failed. On the base, a proof switch is read from the environment; `constructor`, `toString`, `hasOwnProperty` and `__proto__` reach the dispatch table's inherited members instead of `UnknownMethod`; an effect with an unwritable audit log goes ahead; and a receipt lost after an effect goes unmentioned in the result.
- [with.txt](with.txt): **GREEN**, 33 of 33.

M3 needed no change: the README already says typing is unverified (`mastra-cc/typing-unverified`). The malformed-line rule is documented in [01-ARCHITECTURE.md](../../01-ARCHITECTURE.md) §5, and the audit change in the amendment to [ADR-0026](../../02-DECISIONS/0026-the-audit-log-is-an-access-record-episodes-are-the-narrative.md).
