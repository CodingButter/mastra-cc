# The daemon's browser has no port

Decision: [ADR-0119](../../02-DECISIONS/0119-the-daemons-browser-has-no-port.md).

`probe.mjs` loads the built daemon's own `chrome` recipe and starts it headless with a throwaway profile. Then, acting as an unrelated local process, it asks `127.0.0.1:9744/json/version` for the browser.

    node docs/proofs/cdp-pipe/probe.mjs <repo-root>

- [without.txt](without.txt): the base, where the recipe passes `--remote-debugging-port=9744`. Another process reaches the browser. **RED.**
- [with.txt](with.txt): this branch, where the recipe passes `--remote-debugging-pipe`. The same request gets `ECONNREFUSED`. **GREEN.**

Control over the pipe is proved live by `daemon/src/backends/cdp/__tests__/browser-over-pipe.live.test.ts` (`MASTRA_CC_LIVE=1`). Through the real launch path, it reads a page, finds no listening TCP port on the browser, checks that the launch holds nothing open in the daemon's event loop, and checks that the browser ends when terminated. With the pipe ends left referenced, that test fails (6 resources held against 4).
