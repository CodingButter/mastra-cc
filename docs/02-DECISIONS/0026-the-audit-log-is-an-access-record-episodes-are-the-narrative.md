# 0026 — The audit log is an access record; episodes are the narrative

**Status:** accepted, 2026-08-08.
**Supersedes in part:** [ADR-0013](0013-episodes-are-a-git-graph.md), which left this open.
Closes the second open question in [01-ARCHITECTURE.md](../01-ARCHITECTURE.md) §9 and
Q20 in [09-QUESTIONS.md](../09-QUESTIONS.md).

## Context

The prototype had both an audit trail and episodes, and never settled whether that was
redundancy or separation of concerns. The unanswered part was not really "one file or
two" — it was **when private content gets removed**, because that is the part which is
expensive to reverse. Redact at write time and the record is incomplete from birth.
Redact at read time and one complete truth must be defended.

The two artifacts turn out to have requirements that contradict each other, which is
usually the sign that one name is covering two things.

| | Needs to be | Because |
|---|---|---|
| Audit log | append-only, immutable, complete | It is the receipt. A gap destroys its entire purpose. |
| Episodes | a rewritable graph — branch, prune, expire | [ADR-0013](0013-episodes-are-a-git-graph.md) chose a git graph precisely for those properties. |

If episodes *are* the audit log, then every ordinary graph rewrite is a rewrite of the
evidence, and a receipt that can be edited is not a receipt.

The cut that resolves it was already written down and not noticed. The success criteria
in [00-PRODUCT.md](../00-PRODUCT.md) say the audit log shows which elements were touched
**and nothing else**. That sentence is not describing a transcript. It is describing an
*access record*. There is a difference between recording that the subject field of the
third message was read, and recording what the subject said. The first is the proof. The
second is content.

## Decision

**Two artifacts.**

1. **The audit log is the primary record, and it is an access record.** Append-only,
   immutable, written by the daemon at the point of effect. Each entry names the
   application, the element, the scope under which it was permitted, the cause
   (`external` for a human, a cause id for an agent — the attribution rule already
   carried forward from the prototype), the attestation where one was required, and the
   outcome. It carries **element identity, not element content**. It also records, per
   [ADR-0022](0022-failure-to-act-is-harm-we-caused.md), what a task failed to finish and
   whether anyone was told.

2. **Episodes derive from the audit log and carry the content.** The git graph of
   [ADR-0013](0013-episodes-are-a-git-graph.md) is unchanged. Every episode node
   references the audit entries it was built from.

3. **Redaction is an episode concern, applied at read time.** One complete stored truth,
   a different lens per audience: the owner sees everything, because it is their own data
   and they are the only person entitled to it; long-term agent memory receives a
   stripped view; anything exported or shared is stripped hard. The audit log needs
   almost no redaction, by construction — it holds little worth redacting.

Write-time redaction is rejected. It requires choosing the policy before knowing what
will ever be asked of the record, it is irreversible, and it contradicts the product's
own promise that the log shows exactly what was touched.

## Consequences

**Costs, stated.**

- **Every effect now writes twice**, and the linkage between an episode node and its
  audit entries becomes load-bearing. A bug there lets the narrative and the evidence
  disagree *silently*, which is worse than either being wrong on its own. This needs a
  mutation test in the sense of [05-TEST-STRATEGY.md](../05-TEST-STRATEGY.md) §4: break
  the correlation on purpose, confirm something goes red.
- **A single cross-application access record is a new concentration of risk**, even
  though each individual entry is dull. Knowing which applications a person used, when,
  and how often is sensitive in aggregate. The answer is encryption at rest and a
  retention limit — not deliberate amnesia in the record.
- **Read-time redaction means the redaction code is on the read path**, so a bug there
  leaks rather than merely inconveniences. It must be one implementation in one place,
  per [ADR-0003](0003-one-shared-transport-package.md)'s reasoning.

**Benefits.**

- The audit log is small, boring and cheap to keep indefinitely; episodes are large and
  can expire on their own schedule. Different lifecycles are further evidence they are
  two things.
- "Show me exactly what it touched" stays answerable forever, which is the sentence the
  whole consent model is selling.
- An episode can be pruned, rebased or garbage-collected without anyone worrying that
  evidence moved.

## Evidence

- [00-PRODUCT.md](../00-PRODUCT.md), success criteria — "the audit log shows exactly
  which app and elements were touched and nothing else." The phrase *and nothing else*
  is the access-record specification; it predates this decision.
- [ADR-0013](0013-episodes-are-a-git-graph.md) §Open question — records that the
  prototype ran both artifacts and never decided whether that was redundancy, and states
  that the answer determines write-time versus read-time redaction.
- [01-ARCHITECTURE.md](../01-ARCHITECTURE.md) §9, question 2 — carried this as an
  explicitly unresolved architectural question needing a decision before either is built.
- [ADR-0022](0022-failure-to-act-is-harm-we-caused.md) — gives the audit log its second
  job, which only makes sense on an append-only artifact: an unfinished task and the
  notification about it must both survive.
- The attribution rule (`external` for a human-caused effect, a cause id for an
  agent-caused one) is carried forward from the prototype, where it already worked and is
  listed among the things not to renegotiate in [00-PRODUCT.md](../00-PRODUCT.md).
