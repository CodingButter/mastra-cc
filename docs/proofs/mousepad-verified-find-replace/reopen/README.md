# Saved-document reopening — blocked native experiment

No reopening success or complete Mousepad acceptance is claimed here. The successful 32-step batch remains unchanged. This independent probe attempts to open its actual saved document paths through public desktop tools in a fresh isolated Mousepad process, then requires exact public readback. It does not insert the expected document into the running editor.

Run `python3 docs/proofs/mousepad-verified-find-replace/reopen/run.py /tmp/mousepad-fetch-retry.pvwupc_f` from the checkout. The argument must contain the installed consumer and the original saved documents and expected files. This probe is bounded to 90 seconds per isolated session. Source hashes and the executed driver hash are declared independently; each source must match its original expected file before starting. The original model experiment is not relabeled by this post-hoc probe.

## Observed failures, not successful proof

The first three diagnostic attempts corrected harness mistakes: readiness must use `running: 'answering'`, not a nonexistent `answering` boolean; an unfiltered query capped at 100 omits the document behind menu entries, so the probe asks for 500. These failed attempts are retained, not discarded.

The final two retained attempts (`w1rw29vb`, `surd87wx`) reach the observed Open button. Activating that button fails with a native D-Bus `GetRoleName` timeout (`org.freedesktop.DBus.Error.NoReply`, 25 seconds), surfaced as a peer-gone error. The subsequent scoped query reports no answering Mousepad. The later driver records action uncertainty and performs a fresh read rather than replaying the action. All three trials fail; this is not evidence that the source bytes are wrong. App logs contain GLib `g_strjoinv` critical warnings, but causality has not been established.

The chooser-field selection and final readback assertions have not yet been reached in a successful native run. They remain experimental, not verified implementation. `attempts/` retains compressed diagnostic recordings, complete public journals, logs, declarations, outcomes and executed drivers, with SHA256 inventories. Runtime/home directories and installed dependency trees are excluded. Failed native sessions are not folded into the original accepted batch.

Next: characterize the Open action/GTK chooser and the daemon's peer-timeout eviction using native evidence. Do not expand grants, bypass public tools by injecting the document, replay uncertain actions, or weaken readback to make this pass. A separate diagnostic disabling portals/local VFS is not yet an acceptance result.
