# 0082 - A desk says where its own files live

Status: accepted
Date: 2026-09-05
Schema: 1.18.0

## Context

Every verb in this contract is about what is ON the screen. None of them names a
path, and that was deliberate: this daemon does not hand out a filesystem, and a
caller that could read one would have a capability nobody granted.

But a desktop errand reaches a path anyway, and always through an application:
a browser saves a file, a file chooser wants a name typed into it, a `file:`
address opens what was saved so it can be measured. So a caller must name a
folder, and until now the contract gave it nowhere to learn one.

What it did instead was measured, twice, on the demo desk (2026-09-05, wallpaper
errand attempts 24 and 25). It typed

    file:///home/user/Downloads/mastra-logo-wordmark.png

on a desk whose home is `/config`. The browser answered with its own not-found
page, and the errand concluded THE DOWNLOAD HAD FAILED - the one reading the
transcript cannot distinguish from a wrong path. The file was there the whole
time. Prose was tried first: the instructions were told to read the browser's
own download list rather than guess, and the next run guessed again. A caller
with no source of truth will use the one it was trained on.

## Decision

A machine-scoped observation, `describeDesktop`, answering two paths: the
session's `home`, and the `downloads` folder this desktop's applications save
into. Both optional.

It is `observe`, gated `at-result`, and belongs to no capability, for the same
reason `describeAccessibility` (ADR-0064) does not: it names no application and
answers nothing an application published. It reads no file, lists no directory
and opens nothing. The paths it reports are already visible in any file dialog
the caller is permitted to open - it removes an inference, not a fence.

The discipline is that it PUBLISHES rather than derives:

1. `home` is the environment's own, or absent. Never a default.
2. `downloads` is what the desktop names - the environment, then the XDG
   user-dirs file - and only failing both, the XDG default location, and then
   only when that folder IS THERE to be seen.
3. A path that would have to be reasoned about is omitted. An omitted field
   sends the caller to look at a file dialog, which is correct. A guessed one
   is believed.

## Consequences

An errand can type a path it was told instead of one it assumed, which is the
whole of the bug this closes. `home` alone is enough to stop the failure mode:
the wrong answer was never a wrong FILENAME, it was a wrong home.

The cost is a new place for a caller to over-trust. A desk whose downloads
folder is missing answers with `home` and nothing else, and an errand that reads
that as "there are no downloads" will be wrong. The field name says folder, not
contents, and no verb here lists it - the browser's own download page remains
the only thing that names a file.

This is a path leaving the daemon, which is a first. It is a location, never a
listing: nothing here says whether anything is in it, and reading what is in it
still requires an application on the screen, with everything that fences.
