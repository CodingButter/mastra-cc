# Desktop entry fixture

A pinned, deliberately awkward inventory. The scan is tested against THIS
directory rather than against the machine it runs on: a live machine's
`/usr/share/applications` changes when a package is installed, and a test that
asserts against it is a test that fails for reasons that are not about the code.

Every file here exists to make one case non-vacuous:

| entry | what it pins |
| --- | --- |
| `system/applications/ordinary.desktop` | the plain case: `Type=Application`, present |
| `system/applications/hidden-from-menus.desktop` | `NoDisplay=true` is RECORDED, never dropped - a menu hiding it does not uninstall it |
| `system/applications/withdrawn.desktop` | `Hidden=true`, same rule |
| `system/applications/not-an-application.desktop` | `Type=Link` is not an application and is not reported as one |
| `system/applications/collide-one.desktop` + `collide-two.desktop` | two different ids sharing one display `Name` - both surface, distinguishably |
| `system/applications/yad.desktop` | an installed application the daemon HAS a recipe for - the only entry here whose launch capability can be permitted rather than absent |
| `system/applications/malformed.desktop` | no `[Desktop Entry]` group at all - skipped, and its neighbours survive |
| `home/applications/ordinary.desktop` | the SAME id as the system one, with a different display name: precedence is observable, the home copy wins |
| `home/applications/user-only.desktop` | an entry only the user has |
| `second/applications/ordinary.desktop` | a third copy, later in `XDG_DATA_DIRS`, that must lose to both |

The counts these files produce are asserted in
`daemon/src/__tests__/installed-inventory.test.ts`. Adding a file here changes
those numbers on purpose; changing them to make a test pass is the failure the
fixture exists to catch.
