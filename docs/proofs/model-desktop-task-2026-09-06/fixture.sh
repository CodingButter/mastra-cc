#!/usr/bin/env bash
set -euo pipefail
RUN="${1:?Usage: fixture.sh RUN}"
: "${DISPLAY:?Run inside the isolated Xvfb session}"
mkdir -p "$RUN"
# Refuse stale evidence rather than silently reusing a previous submission.
if [[ -e "$RUN/expected.json" || -e "$RUN/submission.txt" ]]; then
  echo 'Use a fresh run directory' >&2
  exit 1
fi
receipt="RCPT-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
cents=$((1000 + RANDOM % 29000))
printf -v total '%d.%02d' "$((cents / 100))" "$((cents % 100))"
printf '{"receiptNumber":"%s","totalPaid":"%s"}\n' "$receipt" "$total" >"$RUN/expected.json"
printf -v receipt_text 'RECEIPT\nReceipt number: %s\nTotal paid: %s' "$receipt" "$total"
# Only the two editable fields are serialized. The receipt is a read-only label.
# A nonzero default response avoids treating plain Enter as a submission.
output="$(mktemp "$RUN/.form-output.XXXXXX")"
trap 'rm -f "$output"' EXIT
if yad --title='Receipt transfer' --form --width=520 --height=280 \
  --no-markup --text="$receipt_text" --separator='|' --response=1 \
  --field='Receipt number' '' --field='Total paid' '' \
  --button='Record receipt:0' >"$output"; then
  # Preserve yad's actual bytes, including separators and final newline.
  mv "$output" "$RUN/submission.txt"
else
  exit 1
fi
submitted="$(<"$RUN/submission.txt")"
yad --title='Receipt transfer' --width=520 --height=200 --no-markup \
  --text="Receipt recorded. Submitted fields (receipt number | total paid):
$submitted" --button='Close:0'
