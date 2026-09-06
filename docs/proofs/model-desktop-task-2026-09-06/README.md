# Bounded real-model desktop task — September 6, 2026

## Scope and evidence status

**Three retained attempts failed the independent task oracle: two Gemini 2.5
Flash runs and one Gemini 2.5 Pro run.** The fixture already declares Receipt
number first and Total paid second. Its accessibility traversal returns unnamed
controls in a different order. All three attempts swapped the values and claimed
success despite reversed confirmation. Attempts 2 and 3 include added generic
field-mapping/confirmation guidance; they still failed. Attempt 3 changes only
the configured model, not the fixture or task. These are failure evidence, not
GREEN or proof that the instruction change fixes the behavior. See
`evidence/attempt-1/`, `evidence/attempt-2/`, and `evidence/attempt-3/`.
This is one bounded, stochastic task against a controlled real GTK `yad` fixture,
not evidence of arbitrary real-application competence. A passing attempt does not
establish reliability; retain failed attempts too, with provider/model identity.

The companion `demo.sh` and `driver.mjs` own orchestration: isolated Xvfb and session
bus, the daemon's real AT-SPI desktop access, and a real provider/model invoked via
the reusable Agent with shipped tools/instructions. They must not replace the
model with scripted answer entry or mocked desktop responses. No model call is
made by the fixture or verifier.

Use exactly this user task:

> Read the receipt shown in the Receipt transfer window. Put the receipt number into Receipt number and its printed total into Total paid, then press Record receipt. Verify the result.

## Fixture and oracle contract

Run `bash fixture.sh RUN` inside the isolated desktop session (`DISPLAY` required).
Use a fresh directory under `/tmp` initially. The fixture generates a random
receipt number and decimal total at setup, saves `RUN/expected.json` with string
keys `receiptNumber` and `totalPaid`, and displays them as read-only receipt text.
The two editable fields start empty. Neither expected values nor the oracle file
may be provided to the driver/model prompt; the model must read the desktop.
Keep oracle/setup files outside the model's allowed file/shell access.

`Record receipt` is a standard yad custom exit button with response 0. Only that
successful response promotes raw stdout to `RUN/submission.txt`; cancellation or
window closure does not create a submission. The default response is nonzero.
The exact standard form output is `receiptNumber|totalPaid|` plus one newline.
There is no helper prefilling, output normalization, or fixture success decision.
A second read-only window shows the actual submitted fields, not expected values,
so the model can verify its action. This window saying “recorded” is not an oracle.

Independently run:

```sh
node docs/proofs/model-desktop-task-2026-09-06/verify.mjs "$RUN"
```

The verifier reads the independent setup expectations and requires the actual
submission file to match both values byte-for-byte, including the standard form
framing. Missing, wrong, or extra output fails with nonzero status. The oracle is
an outcome check, not by itself proof of who operated the UI. Parent verification
must also inspect the driver/tool trace and real desktop evidence, confirm no
answer leakage or scripted entry, and check model-side result verification.

## Local checks (no live model)

```sh
bash -n docs/proofs/model-desktop-task-2026-09-06/fixture.sh
node --check docs/proofs/model-desktop-task-2026-09-06/verify.mjs
node --input-type=module <<'NODE'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = mkdtempSync(join(tmpdir(), 'receipt-oracle-'));
const verifier = resolve('docs/proofs/model-desktop-task-2026-09-06/verify.mjs');
const good = 'RCPT-1234abcd|42.07|\n';
try {
  for (const [name, output, pass] of [
    ['missing', null, false],
    ['wrong-number', 'RCPT-ffffffff|42.07|\n', false],
    ['wrong-total', 'RCPT-1234abcd|42.70|\n', false],
    ['extra', good + 'unexpected\n', false],
    ['correct', good, true],
  ]) {
    const run = join(root, name);
    mkdirSync(run);
    writeFileSync(join(run, 'expected.json'), JSON.stringify({
      receiptNumber: 'RCPT-1234abcd', totalPaid: '42.07',
    }));
    if (output !== null) writeFileSync(join(run, 'submission.txt'), output);
    const result = spawnSync(process.execPath, [verifier, run], { encoding: 'utf8' });
    assert.equal(result.error, undefined);
    assert.equal(result.status === 0, pass, `${name}: ${result.stderr}`);
    console.log(`${name}: expected ${pass ? 'acceptance' : 'rejection'} confirmed`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
NODE
```

These synthetic directories test only the oracle; they are not desktop/model
success evidence. The parent owns runtime GTK/AT-SPI and full model verification.
Retain reviewed run artifacts under this proof directory (for example `evidence/`):
expected values, actual submission if any, verifier stdout/stderr and exit status,
provider/model identity, model/tool trace, and desktop screenshots/logs. Preserve
`/tmp` artifacts until copied; do not label evidence complete before execution.
