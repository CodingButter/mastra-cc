# AT-SPI call deadlines (ADR-0117)

`demo.mjs` launches Mousepad and starts a real daemon with it granted. It asks one query while Mousepad is alive, then sends `SIGSTOP` and times a second query.

```
node docs/proofs/atspi-deadlines/demo.mjs <daemon/dist/main.mjs> --out <file>
```

- `without.txt`: `master` at `a919bd9`. The frozen query waits 25,010 ms, the bus's NoReply. It then says "no application on this desktop answers to that name", which is untrue.
- `with.txt`: this branch. The frozen query is refused at 10,006 ms, and the refusal names the unanswered call and says nothing was changed.

Offline coverage is `daemon/src/backends/atspi/__tests__/a-silent-application-is-refused-in-time.test.ts`: a fake bus that never replies, driven by fake timers.
