# What the desk does not teach: the baseline

Eighteen runs. Six errands, three runs each, `google/gemini-2.5-flash` at
temperature 0, 24 max steps, driven through the packed `@mastra-cc/desktop`
tarball against a real KDE desktop in another namespace.

The instructions under test are the shipped ones, unchanged:

    docs/11-AGENT-INSTRUCTIONS.md
    65 lines, 3,445 bytes
    sha256 48ec91473f0a134a3acdc9479dd8e35d577f9504d5d85ff29214e4dae42e5dac

Every transcript in this directory carries that hash in its header. Phase 2
re-runs the same harness with the same model and sampling and a different hash,
which is the only reason the two sets can be compared at all.

## The scoreboard

| Errand | What was asked | Done | Tool calls |
|---|---|---|---|
| E1 | write a shopping list in an editor and save it | 0/3 | 25, 16, 18 |
| E2 | rename `proof.txt` to `receipt.txt` in the file manager | 0/3 | 13, 13, 7 |
| E3 | fill in and submit the contact form in the browser | 1/3 | 9, 9, 9 |
| E4 | change the wallpaper in system settings | 0/3 | **0, 0, 0** |
| E5 | copy the receipt total from Kate into Mousepad | 2/3 | 12, 14, 13 |
| E6 | close the editor without saving | 0/3 | **0, 0, 0** |

**3 of 18.** Six of the eighteen runs never touched the desk at all.

The instructions are 65 lines of protocol literacy - catalogue, identity,
bounded reads, redaction, fresh-read verification, refusals - and they are
accurate. Nothing below is a case of the agent disobeying them. Every failure
is a case of the agent obeying them and still having no idea how a desktop
works, because that sentence was never written.

## Classification

The question each finding has to answer is: would prose have fixed this, or is
the fourteen-method surface actually missing something? A finding is only a
surface gap if no sentence could have rescued the run. Six of the seven are
prose.

---

### F1 - Nothing tells the agent to look before it gives up. (prose)

*E4 and E6, six runs, zero tool calls between them.*

> `E4-run2`: "I am sorry, I cannot fulfill this request. I do not have the
> ability to change desktop wallpaper."

> `E6-run1`: "Which editor do you want to close? Is there an unsaved document
> or a dialog open?"

E6 is the sharpest evidence in the whole baseline. The agent asks the human
whether there is an unsaved document - a question `listApplications` and one
`queryElements` would have answered in under a second. It had the desk in
front of it and asked a person instead.

E4 is the same reflex with a different excuse: the model decided a wallpaper is
not a UI element and stopped, without checking whether the machine has a
settings application. It does; `systemsettings` is present and launchable, as
the harness inventory prints before every sweep.

Both are the same missing sentence: **when you do not know what is on the desk,
look. Never ask a person a question the desk can answer.** The current
instructions never say that a task begins with an inventory. They describe what
`listApplications` returns; they never say it is the first move.

Cost: 6 of 18 runs, a third of the baseline, failed before making one call.

---

### F2 - The agent does not know a menu bar exists. (prose)

*E2, all three runs.*

Every run found the file and stopped at the list item:

> `E2-run3`: "the element representing the file (`el-6c86533e99ab`) does not
> expose any operations to directly edit its text or trigger a rename action.
> The `setText` operation is marked as `not-exposed` [...]"

That is true, and it is the desk being honest. Renaming a file is not a
property of the list item; it is a command in the File menu. A direct probe of
the same Dolphin window, protocol only:

    top-level menus: File, Create New, New Window, New Tab, Undo close tab,
      Add to Places, Rename…, Duplicate Here…, Move to Trash…, Delete…, ...
    RENAME PRESENT: Rename… (el-ad0bc83f379f) actions=["Press"]

`Rename…` was sitting in the tree the whole time with an available `Press`
action. The errand was completable with the fourteen methods as they ship.

The missing sentence: **when an element does not offer the operation you want,
the command usually lives in the application's menus - query for `menuitem`
and read what is there.**

---

### F3 - `name` is an exact match, and nothing says so. (prose)

*E2 runs 1 and 2 - the near miss that makes F2 worse.*

Both runs did reach for the menu. They asked for it by name:

    queryElements {"role":"menuitem","name":"Rename"}   -> {"elements":[]}

The item is called `Rename…`, with a horizontal ellipsis. `nameMatches` in
`daemon/src/backends/atspi/names.ts` is NFKC equality, not substring:

    export function nameMatches(candidateName: string, queryName: string): boolean {
      return normalise(candidateName) === normalise(queryName);
    }

So `"Rename"` misses `"Rename…"`, the answer comes back empty, and the agent
concludes the command does not exist. It had the right idea and was defeated by
one character it could not have guessed.

The schema is not lying - it says "whose normalised name matches". The prose
never spells out the consequence. The missing sentence: **`name` is an exact
match, not a search. To find a control, query by role and read the names in the
answer; do not guess the exact label.**

---

### F4 - The agent does not know `submitElement` is how a form is sent. (prose)

*E3 - the same button, two verdicts, three runs.*

Runs 1 and 2 filled both fields, then refused:

> `E3-run2`: "the 'Send message' button only advertises a 'focus' action, and
> does not provide an action like 'click' or 'submit'"

That reading of the element is correct. Here is the button as the desk
describes it:

    "role":"button","name":"Send message",
    "actions":[{"name":"focus","availability":"available"}],
    "operations":[setValue, setText, setCaret, reveal]

Neither the `actions` list nor the `operations` list mentions submitting. Run 3
called `submitElement` anyway - and **it worked**, first try, errand complete.

So the capability is real, reachable, and invisible in the element description.
Two runs out of three inferred the truth from the payload and were wrong.

The missing sentence: **`submitElement` is the way to send a form. Do not
conclude from an element's advertised actions that it cannot be submitted.**

*Caveat worth recording, not fixing here:* an element whose description implies
less than the desk will do is a small honesty problem in its own right. It did
not need a surface change to pass this errand, so it stays a note. Changing
what `operations` advertises is not in this plan's scope.

---

### F5 - Nothing tells the agent to wait for a window to arrive. (prose)

*E5 run 3, and the shape of every E1 tail.*

E5 passed twice and failed once, on timing alone:

> `E5-run3`: "The Mousepad application was opened, but its elements are not
> discoverable by the daemon."

A launched application is not instantly present on the accessibility bus.
`openApplication` polls for appearance, but the elements inside a window
populate afterwards, and a query fired immediately gets an honest empty answer
that reads exactly like absence. The two passing runs happened to spend more
calls before looking.

E1 shows the same reflex after an action rather than a launch: every run
activated Save and queried for `dialog` in the very next call.

    call 8: activateElement {"action":"Press","id":"el-1ebde7139689"}   # Save
    call 9: queryElements {"role":"dialog"}  -> {"elements":[]}

The missing sentence: **an empty answer straight after a launch or an action
means "not yet" at least as often as it means "not there". Query again before
concluding something is absent.**

---

### F6 - No run ever confirmed a file reached the disk. (prose)

*E1, all three runs.*

> `E1-run3`: "I attempted to save the file, but I was unable to interact with a
> save dialog to specify a filename or confirm the save"

Three runs, 59 tool calls, and not one shopping list on disk. The agent typed
the list, pressed Save, and then narrated its own uncertainty. The instructions
teach fresh-read verification for element content, and the agent applies it -
it re-reads the text box. It has no notion that "saved" is a claim about a
filesystem that the editor's title bar can corroborate: `Untitled — Kate`
versus a filename says which happened.

The missing sentence: **after saving, confirm it - the window title stops
saying Untitled and starts saying the file's name.**

---

### F7 - Whether a modal is observable at all is unresolved. (unresolved)

Across all eighteen runs, **no `queryElements` result ever contained an element
with `"role":"dialog"`** - only the requests did. Two direct protocol probes
could not raise one either: pressing Save in a Kate window did not produce a
dialog on the wire within 6 seconds, and a protocol-only edit followed by
File > Close closed the tab without prompting.

I will not call this a surface gap, because I could not prove the negative:
in both probes I could not confirm the buffer was genuinely dirty, so Kate may
have had nothing to ask about. There is real evidence pointing the other way -
transient popup surfaces *are* observable, since the same probe read Kate's and
Dolphin's menus after activating them:

    after ShowMenu: File, New, ..., Save All, Reload All, Close, ..., Rename…

Menus appear. Whether a modal does is an open question, and E6 is the errand
that would settle it - but E6 never made a call, so the baseline never asked.
**If Phase 2's prose fixes F1 and E6 starts looking, this answers itself.** If
E6 then looks and finds nothing, that is a surface finding and it is a
different plan.

---

## What this means for Phase 2

Six prose gaps, one open question, zero confirmed surface gaps. Nothing here
asks for a fifteenth method.

The through-line: the instructions taught the protocol and skipped the desk.
They explain what each method returns without ever saying that work begins by
looking, that commands live in menus, that an empty answer can mean "not yet",
or that a save is a claim you can check. A model that has never used a desktop
cannot infer any of that from a method list, and this one didn't.

Ordered by how much of the baseline they cost:

1. **F1** - look before you give up; never ask a person what the desk knows. (6 runs)
2. **F6** - a save is verified in the window title. (3 runs)
3. **F2 + F3** - commands live in menus, and `name` is exact, so read rather than guess. (3 runs)
4. **F4** - `submitElement` sends a form. (2 runs)
5. **F5** - empty can mean "not yet". (1 run, and the reason E1 saw no dialog)
