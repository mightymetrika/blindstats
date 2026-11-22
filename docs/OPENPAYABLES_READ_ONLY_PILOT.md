# OpenPayables read-only GUI pilot — hosted Development connection (BlindStats v45)

**Status:** v44 local pilot accepted and committed at `a84edcd`. This v45 candidate upgrades only the fixed OpenPayables package and its server-side connection to the dedicated hosted OpenPayables Development database. Host-side acceptance is **pending**. No OpenPayables repository changes, database migrations or financial writes belong to this patch.

## Package and ownership

- Fixed GitHub TEST prerelease: `v0.2.0-alpha.3`, source commit `0e4b150`.
- Asset URL: `https://github.com/mightymetrika/openpayables/releases/download/v0.2.0-alpha.3/openpayables-0.2.0-alpha.3.tgz`
- Expected asset SHA-256: `5e0976f32b474371288cde5c9cff1076f598a74232863aceeb666c562ec029fc`.
- Public `openpayables/read` interface remains unchanged: `projectOverview`, `pendingEvidence`, `contributorView`.
- OpenPayables owns its own database, schema, migrations and operator/Stripe configuration. BlindStats owns only its GUI, auth, server-only identity mapping and read-only connection. This database is for Mightymetrika's own development projects; unrelated operators must own separate instances.

## Dedicated hosted TEST database (never BlindStats Supabase)

- Supabase project ref: `aadqozgamybbksrvoivu`, name `openpayables-mightymetrika-dev`.
- Transaction-pooler host: `aws-1-us-west-1.pooler.supabase.com`, port `6543`, database `postgres`, OpenPayables tables under the `openpayables` schema.
- Only permitted application DB username: `openpayables_app_ro.aadqozgamybbksrvoivu`. The operator-writer and Supabase admin credentials must never enter BlindStats.
- Enforce `sslmode=verify-full` with the Supabase CA, verified hostname, `OPENPAYABLES_POOL_MAX=1`. The v45 server adapter rejects other database hosts, users, ports, SSL modes and missing CA. Never use `rejectUnauthorized: false` or a weaker mode.
- The CA certificate must be the **authentic certificate downloaded from that Supabase project's configuration**; a public CA is not a password. Vercel functions cannot access a file path on the operator's Windows computer. The adapter reads a server-only base64 PEM environment variable and writes the certificate to a temporary runtime file for node-postgres' `sslrootcert` support.

Only on the **server**, configure these variables in ignored `.env.local` for local smoke, and separately as **Preview-only Vercel environment variables** after local acceptance:

```text
OPENPAYABLES_DATABASE_URL=postgresql://openpayables_app_ro.aadqozgamybbksrvoivu:<URL_ENCODED_PRIVATE_PASSWORD>@aws-1-us-west-1.pooler.supabase.com:6543/postgres?sslmode=verify-full
OPENPAYABLES_POOL_MAX=1
OPENPAYABLES_TLS_CA_BASE64=<BASE64_OF_ACTUAL_PROJECT_CA_PEM>
OPENPAYABLES_PILOT_ACCESS_JSON={"projectId":"supabase-smoke-4496fd4f","managerUserIds":["BLINDSTATS_DEVELOPMENT_MANAGER_UUID"],"contributorUserIds":{"BLINDSTATS_DEVELOPMENT_CONTRIBUTOR_UUID":"smoke-alice-4496fd4f"}}
```

Never use `NEXT_PUBLIC_*` for these settings, put credentials into Git, echo them into logs, or copy them into chat. Preserve BlindStats' own `NEXT_PUBLIC_SUPABASE_URL` and publishable key pointing to BlindStats **Development**, not OpenPayables. Study capabilities do not establish OpenPayables financial permissions. The server obtains each user's ID from authenticated Supabase claims and then applies the configured exact project/contributor mapping. Unmapped users get no data. `VERCEL_ENV=production` remains denied in both the page access gate and reader.

The included `scripts/configure-hosted-openpayables-pilot.ps1` is optional and only updates the existing **ignored** local `.env.local`: it preserves the previous two Development user UUIDs, replaces the local v44 project and Alice mapping with the hosted synthetic IDs, prompts privately for the **new** reader password, and base64-encodes the downloaded Supabase CA. It never modifies OpenPayables PostgreSQL or tracked source. Run it only after `npm install`, while HEAD remains `a84edcd`.

## Bounded acceptance

1. On the clean `a84edcd` BlindStats `development` baseline, apply the complete v45 files. Independently download/check the tagged alpha.3 archive hash, run `npm install --no-audit --no-fund` to update **tracked `package-lock.json`**, then `npm test`, `npm run lint`, `npm run build` and `git diff --check`. This changes no blinding code.
2. Run the private configuration script, restart `npm run dev`, then authenticate using existing BlindStats Development accounts. The manager sees `supabase-smoke-4496fd4f`, Alice 8, Bob 3, zero pending evidence. The contributor sees only synthetic Alice 8, the existing governance vote, and a **held** $8.00 TEST allocation. Bob's vote and held $3.00 allocation exist in the dataset but should not appear as another contributor's private history.
3. If local hosted-data acceptance passes, stage only the v45 source plus generated lockfile, commit/push `development`, and confirm a clean tree. Next configure the same four **server-only** settings for Vercel **Preview only**, keep existing BlindStats Development Supabase auth, deploy with `--environment=preview` (never `--prod`), confirm Vercel Authentication protection, and perform one short manager/contributor check. Do not rerun blinding E2E.
4. Do not claim hosted GUI acceptance before these checks succeed. The OpenPayables repository already completed its separate hosted synthetic acceptance; this task is only about the BlindStats reader GUI.

## Safety boundaries

All views remain read-only; no approvals, credit awards, governance votes, funds, Stripe, transfers, settlements or LIVE payment operations. A TEST allocation of $8 or $3 marked `held` does not mean a transfer or bank payout. The reader DB role is restricted across the operator's schema but **not** per end user, so the BlindStats server-side mapping is essential. Do not use a pooled writer/admin URL. No BlindStats Production database migration, `main` merge, Production Vercel deployment, or hosted OpenPayables schema change is authorized.
