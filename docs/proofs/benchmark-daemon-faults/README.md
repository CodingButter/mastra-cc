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
