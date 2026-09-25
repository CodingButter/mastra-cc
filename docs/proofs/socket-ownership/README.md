# Socket ownership (ADR-0115)

`daemon/src/__tests__/a-socket-belongs-to-the-daemon-on-it.test.ts` starts a real daemon on a Unix socket, then a second `startServer` on the same path.

- [`without.txt`](without.txt): `master` at `be6d8bc`. The second daemon starts over the first, and the "refuses a second daemon" test fails.
- [`with.txt`](with.txt): this branch. The second refuses, the socket file stays, and the first daemon still answers a hello. A stale file is still reclaimed.

Rerun: `cd daemon && npx vitest run src/__tests__/a-socket-belongs-to-the-daemon-on-it.test.ts`.
