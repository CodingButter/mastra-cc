# Fresh-batch hypothesis after m.2giE49

The final ordinary-app trial observed no readable application and stopped without editing. The prior accepted ordinary-app trial also initially listed no readable application, then found the dialog on subsequent public queries. This supports a startup/readiness race, not missing observe authority.

`daemon/src/main.ts` rejects `--allow observe`; `--grant exo-desktop-item-edit` already supplies observe authority. No grants have been expanded.

Change: before starting the model, poll only the granted native application root via `queryElements({application, role: 'application', limit: 1})` (at most 80 attempts, 250ms between attempts, still subject to the existing outer trial deadline). Log readiness separately and do not supply setup responses, field identifiers, labels, or answers to the model. Failure to establish readiness aborts setup. This does not establish general model reliability.

Preserve m.2giE49 unchanged as a failed batch: five receipt machine passes and one unsuccessful ordinary-app trial. Run a fresh six-trial batch rather than replace its sixth result or pool passes across batches. The next run tests whether startup synchronization prevents this failure; it is not assumed to succeed.

First readiness experiment, m.Gdighx: five receipt machine passes; ordinary-app setup timed out. The predicate incorrectly used installed-application inventory (`listApplications`), where this editor is absent, rather than the granted native application tree. That batch is retained and not accepted. Revised hypothesis: query the granted application root directly; no installed-catalog membership is required, and no field values are inspected by setup.

Revised run m.U61s32: five receipt machine passes; the ordinary-app root was readable on setup attempt 0. The model nevertheless failed after exhausting its 24 generation steps (29 tool calls): it repeatedly queried `textbox`/`generic`, guessed unrelated application names, and never queried the native `text` role, edited the fields, or saved. `reopened-ms.txt` is absent and no success is claimed. This is a distinct model task failure, not missing observe authority or failure of the readiness predicate. Keep the batch failed; no replacement of t6 or cross-batch pooling.

Verification of the narrow readiness change: Node syntax check passed; all 10 evidence tests passed; workspace build/lint/typecheck/test passed 19/19 (cached); digest agreement and freeze gate passed. Final Phase 4 acceptance, visual review, publication, and commit remain incomplete. A possible next hypothesis is clearer platform-neutral guidance to inspect both native `text` and `textbox` roles before concluding there are no editable fields; this has not been implemented or tested here.
