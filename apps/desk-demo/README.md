# desk-demo

An agent works a real desktop in your browser, and hands you the keyboard when a
step is yours to do.

The left half is the actual Webtop desktop over noVNC. The right half is an agent
holding one `mastra-cc` connection, with one tool per protocol method. Nothing is
scripted: you type an errand, it reads the desk and acts.

## The one mechanic worth watching

While the agent works, a transparent layer over the desktop swallows your clicks
and the badge reads `VIEW`. When the agent reaches something only a person should
do — a sign-in, a password, a decision that is yours — it calls
`requestHumanControl`. The desk unlocks, the badge reads `INTERACT`, and a **Done**
button appears in the chat. The agent is genuinely blocked until you press it.

**The agent cannot take control back.** `requestControl` unlocks and waits;
only the browser's Done press resolves it (`src/lib/control.ts`). An agent able to
re-lock the desk could lock a person out of their own machine.

## Running it

```bash
# 1. the desktop
MASTRA_CC_WEBTOP_PROJECT=mcc-webtop-harness MASTRA_CC_WEBTOP_PORT=13310 \
  docker compose -p mcc-webtop-harness -f infra/webtop/compose.yml up -d

# 2. a daemon inside it, and .env.local pointed at it
MASTRA_CC_WEBTOP_PROJECT=mcc-webtop-harness MASTRA_CC_WEBTOP_PORT=13310 \
  bash apps/desk-demo/desk-up.sh

# 3. this app
GOOGLE_API_KEY=... pnpm --filter @mastra-cc/desk-demo dev
```

Then <http://localhost:3000>.

`desk-up.sh` states the demo's authority in one readable block: which
applications may be launched, which may be seen, and which effect classes the
session may perform. `rawInput` is deliberately absent — it is off unless a person
turns it on, and a demo that armed it by default would demonstrate the opposite of
[ADR-0046](../../docs/02-DECISIONS/0046-raw-input-is-the-most-restricted-class-not-a-banned-one.md).
Ask for something outside those lists and the daemon refuses, naming the setting
that withheld it. That refusal is part of the demo, not a failure of it.

## What this is not

- **Not published.** It is `private`, and the licence gate walks `packages/*`
  rather than this app: nothing here is code a user receives. It is in the
  workspace so a protocol change breaks it in CI rather than in a room full of
  people.
- **Not multi-user.** One process, one desk, one person — the control station is a
  module singleton, and a second visitor would be sharing the first one's keyboard.
  Keying it by session is a product decision, not a refactor.
- **Not a proof.** The proofs in `docs/proofs/` are the evidence; this is the
  thing you show someone.
