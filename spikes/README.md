# spikes/

**Everything in this directory is throwaway.**

It exists to answer the questions in [../docs/09-QUESTIONS.md](../docs/09-QUESTIONS.md)
with measurements instead of beliefs, and it is **deleted at the end of M0.5**.

Four rules, and they are not negotiable:

1. **Nothing here is imported by anything.** No package under `packages/`, no
   application under `apps/`, and no daemon code may depend on a file in this
   tree. If something here becomes worth keeping, it is *rewritten* in its real
   home with tests, not moved.
2. **No finding is recorded until it appears under `docs/`.** This code is the
   instrument, not the result. A number that exists only in a spike's output —
   or only in a terminal scrollback — was never measured as far as this
   repository is concerned.
3. **A spike that cannot exercise all of its conditions writes nothing** and
   exits non-zero. A partial table is worse than no table, because a partial
   table gets quoted later. The prototype specified
   `docs/proofs/which-condition-makes-a-browser-readable.md` and never produced
   it; half of it would have been the worse outcome.
4. **Nothing here touches the operator's real environment.** Throwaway browser
   profiles only, no writes to the default Chrome profile, no edits to system
   launcher entries, no changing the default browser, and never enabling a
   screen reader.

When M0.5 closes, this directory is removed in the same commit that reconciles
the documents. The git history keeps the code; the working tree does not.
