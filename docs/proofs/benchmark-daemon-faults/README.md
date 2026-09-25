# Benchmark daemon faults (item 10)

Found by the cold-agent benchmark smoke run. Three answers reached the agent as `daemon`-class refusals, but the daemon knew what had happened in each case:

| Fault | Before | After |
|---|---|---|
| D1: the display refuses a screen grab (Wayland `xwd` BadMatch) | `daemon/Unclassified` | `world/UnperformableElementError` |
| D2: the CDP route has no screen to capture | `daemon/BackendUnreadable` | `world/EffectUnsupportedError` |
| D3: `Component.ScrollTo` answers `NotSupported`/`UnknownMethod` | `daemon/BackendUnreadable` | `world/UnperformableElementError`, nothing scrolled |

Any other `ScrollTo` failure still goes to the backstop (control test).

- `without.txt`: the test file run on base c9: 4 failed, 1 passed (the control).
- `with.txt`: the same file on the branch: 5/5 passed.
- Mutations `a-refused-grab-forgets-whose-it-is`, `a-screenless-route-is-an-unreadable-desk` and `a-declined-scroll-is-a-daemon-fault` were all caught.

## Found by the first full batch

| Fault | Before | After |
|---|---|---|
| D4: CDP `submitElement` ran the node's first derived action (`focus` on a button) and answered as a commit; the React app's state never changed | success, nothing submitted | `form.requestSubmit(this)` for a form's submit/image control; anything else `world/EffectUnsupportedError` |
| D5: GTK4 `Component.GrabFocus` answers `NotSupported` (GNOME Settings) before a key chord | `daemon/BackendUnreadable` | `world/UnperformableElementError`, no key sent |

The D4 claim is bounded: the form was asked to submit. It does not confirm navigation or what the page did next.

- `d4-submit.txt`: `a-commit-is-a-commit.live.test.ts` in real headless Chrome. Base `73a5126` fails (a plain button's submit resolved). The branch passes: the plain button is refused with its title unchanged, and the form's submit handler runs.
- `d5-focus.txt`: `node d5-focus.mjs <worktree> button` against live GNOME Settings. Base gives `daemon/BackendUnreadable` with the D-Bus `NotSupported` in the log. The branch gives the world refusal and a clean log.
- Mutations `a-submit-is-whatever-the-node-publishes-first`, `any-button-submits-its-form` and `a-declined-focus-is-a-daemon-fault` were all caught.
