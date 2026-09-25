# server-seams — ADR-0122

A refactor has no RED. The claim is **no change**, shown three ways:

1. **Same code.** `same-code.py` strips imports and the added `export`
   keywords from base `server.ts` and from the hub plus its six modules. It
   finds 3,001 lines on each side, the same lines, and none added or lost.
   (`with.txt`, top.)
2. **Same tests, same results.** On the base and on the branch the daemon suite
   gives 108 files and 1,058 passed / 29 skipped of 1,087
   (`without.txt`, `with.txt`). The only test edit is the file-read line in six
   static source checks. They now read through `serverSource()`, which reads the hub
   and all six modules.
3. **Same mutations caught.** Every `server.ts` mutation anchor was re-pointed
   to the module holding its text, each still unique, and the full sweep runs
   against the split tree. (Sweep result in the PR.)

Found on the way: the mutation `a-second-request-jumps-the-serialisation-gate`
anchors on text that no longer exists anywhere (the global queue it targeted
was removed by ADR-0118). It was dead before this change; it's left as it was
and reported rather than silently deleted here.
