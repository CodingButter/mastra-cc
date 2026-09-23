# CDP liveness and truth

Decision: [ADR-0114](../../02-DECISIONS/0114-the-browser-cannot-hold-the-desk.md).

`demo.mjs` launches a real headless Chrome on port 9744 and serves `fixtures/` over `127.0.0.1`. It then starts the daemon it is given (`--backend cdp --allow edit`) and drives it as raw Unix-socket clients. Page-script actions run over the demo's own CDP connection in the page's main world, so an isolation pass is not self-graded.

| Scenario | Base `bb9b89c` ([without.txt](without.txt)) | Branch ([with.txt](with.txt)) |
|---|---|---|
| `deadline`: page spins forever | no answer at the 30 s cap | refused in ~1.5 s (attach deadline) |
| `dialog-after`: alert opens after attach | other clients pending at the cap | other clients answered in a few ms |
| `dialog-before`: alert already open | pending at the cap | refused in ~1.5 s, wording says "may be showing a dialog or be busy" |
| `isolation`: page probes and forges | stream visible; forgery delivered | `undefined`; forgery not delivered; real edit delivered |
| `react-accept` (React 19.2.8) | "success", rendered state `""` | success, rendered `"hello"` |
| `react-filter` | "success", rendered `""` | refused, observed `"heo"` |
| `react-async-revert` (reverts after 10 ms) | "success", rendered `""` | refused, observed `""` |
| `react-number` | 42 and 500 both "success", rendered `""` | 42 succeeds; 500 refused, observed `"42"` |

## Bounded claims

- A successful write means the DOM value equalled the request after two animation frames or 50 ms, whichever came first. It does not prove application state. A revert after that window is outside the claim.
- A cold attach behind a dialog is refused as a deadline, not identified as a dialog; Chrome does not report such a dialog.
- Only the main frame is covered; iframe elements are refused.
- A stall with no dialog still holds other clients for up to 10 s, because request serialisation is unchanged.

## Rerun

From the repository root, after `node protocol/generate.mjs && pnpm install --frozen-lockfile`. No Chrome may already be listening on 9744.

```
pnpm turbo run build --filter=@mastra-cc/daemon
node docs/proofs/cdp-liveness/demo.mjs --daemon daemon/dist/main.mjs --out /tmp/with.txt
```

For the base run, pass the base tree's `daemon/dist/main.mjs` and add `--fixtures docs/proofs/cdp-liveness/fixtures`. React bundles in `fixtures/react/dist` are built from `fixtures/react/src` with the lockfile's esbuild 0.28.2 (command in the plan's G-esbuild). `sha256sum -c SHA256SUMS` checks the artifacts.
