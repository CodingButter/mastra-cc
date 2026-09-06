# Invalid concurrent gate attempt

The final-mutations.txt run overlapped a build/full-test launch and a live deterministic/inspect launch. The mutation runner temporarily edits source; these commands are not independent. The full gate failed in tools tests, and mutation `shipped-instructions-drift-from-the-reviewed-copy` reported no executed tests. Neither result is an acceptance gate. Retain all logs and deterministic.Zdt32l / inspect.ZnzM0l outputs as non-acceptance evidence rather than discarding them.

Correction: run mutations alone (serial-mutations.txt), wait for complete restoration, regenerate and force rebuild, run all focused/full gates serially, then run deterministic/inspect. Independently rehash every m.SQGqtM runtime artifact and its loaded instructions/harness against the restored final candidate. A mismatch requires a new documented model batch; matching artifacts preserve the already reviewed batch. No test or mutation is weakened.
