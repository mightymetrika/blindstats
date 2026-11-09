# Development-only two-account authorization integration test

This is **one opt-in** integration test of the real Supabase **development**
project's RLS and unblinding authorization RPCs. It requires no browser clicks,
no service-role key, no SQL migrations, and no additional dependencies.

## One-command Windows run

You need two existing, different development Supabase Auth test accounts.
From the blindstats repository root, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-development-authz-test.ps1
```

The launcher reads the current **ignored** `.env.local` (your development
Supabase URL and publishable key), checks the project reference, and prompts
for Account A and Account B credentials. Password entry is hidden. Nothing is
written to a credential file or committed to Git. The temporary environment
variables are cleared when the command exits.

**Do not share credentials, session tokens, passwords or full environment
variable values in chat or screenshots.** If the local `.env.local` no longer
points to development, the launcher refuses to run.

## What it verifies

- Two existing, different development Auth accounts sign in independently.
- Account A creates a synthetic Study; B cannot read it before membership.
- A adds B as independent authorizer; B gets only `unblinding.authorize` and
  can then read the Study.
- A activates an Independent BlindingPlan without an analysis-lock requirement.
- A generates a real, encrypted public receipt from synthetic CSV bytes with
  the project's existing browser-local core and registers **only** that receipt.
- B cannot request unblinding without `unblinding.request`.
- A requests unblinding; A **cannot authorize its own request** even though
  Study creators hold the authorization capability.
- B authorizes successfully; the test checks persisted requester/authorizer
  IDs, independent policy and `unblinding_authorized` workflow state.

This validates **the two-account governance boundary**, not the full browser
workflow. Analysis locks, local decryption and receipt integrity have existing
unit/component and previous manual coverage.

## Safety and cleanup

The test deliberately runs **outside** the ordinary `npm test` suite. It
refuses any Supabase URL except `https://kfrfemqoalzxwzecyjjf.supabase.co`,
requires `BLINDSTATS_IT_CONFIRM=DEVELOPMENT_ONLY`, and rejects a key that does
not begin with `sb_publishable_`. It never uses service-role/admin access.

The test automatically **archives**, rather than deletes, its synthetic Study
in a `finally` block, even after an assertion failure. The existing RLS design
does not allow ordinary users to delete Studies. Archived synthetic records
therefore remain in development, tagged `[INTEGRATION TEST]`. Run only when
needed. If a network failure prevents archival, the test prints the Study ID
for manual archiving.

If the intermittent upstream `PGRST303 / jwt_issued_at_future` error occurs,
record the timestamp and retry only if necessary. The test deliberately does
not silently retry or bypass JWT validation.

Run with Node.js 24 as required by the application.
