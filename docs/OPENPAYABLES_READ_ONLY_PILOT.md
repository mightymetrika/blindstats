# OpenPayables read-only GUI pilot (BlindStats-only)

Status: source candidate. No change to OpenPayables or to either Production system.

## Dependency and environment

- Source: published `mightymetrika/openpayables` tag `v0.2.0-alpha.2` (`6c8f864`).
- Package: published `openpayables-0.2.0-alpha.2.tgz`, SHA-256 `de55ec0695df8e11cec775a5eac6fd791a089a124800b39d86cee6e979047826`.
- BlindStats uses the versioned tarball via `openpayables/read`; never import a moving OpenPayables development checkout.
- Run `npm install --no-audit --no-fund` in BlindStats after this patch; commit the resulting `package-lock.json` with the source patch.

Provide **server-only** values in `.env.local` (never `NEXT_PUBLIC_*`):

```
OPENPAYABLES_DATABASE_URL=postgresql://READ_ONLY_USER:REDACTED@127.0.0.1:5432/openpayables
OPENPAYABLES_PILOT_ACCESS_JSON={"projectId":"PILOT_PROJECT_ID","managerUserIds":["SUPABASE_MANAGER_USER_UUID"],"contributorUserIds":{"SUPABASE_CONTRIBUTOR_USER_UUID":"VERIFIED_OPENPAYABLES_CONTRIBUTOR_ID"}}
```

Use actual UUIDs for authenticated BlindStats users and the exact operator-confirmed OpenPayables contributor ID. Never infer mapping from email, Study role, browser query or GitHub username. This initial pilot is fixed to **one explicitly configured project**; no browser project picker. Unmapped users receive no data. No link is rendered for them; `/openpayables` also fails closed. The pilot is disabled when `VERCEL_ENV=production`.

For a local Windows pilot, the database may be bound to localhost while running the BlindStats Next server on the same Windows host. **Vercel cannot connect to your Windows localhost.** Hosted Preview acceptance is optional and requires a separate secure, network-accessible operator-owned PostgreSQL deployment, a least-privilege read-only SQL role, TLS and narrowly restricted network access. Never expose your local database port publicly merely to test this UI.

Create a database role limited to `SELECT` on the relations needed for `OpenPayablesReadOnly` and its pending-evidence queue. Configure that role's PostgreSQL DSN. Do not reuse the operator's database writer credentials in the web app. OpenPayables installation, schema, and Stripe setup remain owned by the OpenPayables repository/chat. The pilot performs no migrations.

## Verification

1. In the BlindStats repo, install dependencies with `npm install --no-audit --no-fund`, then run `npm test`, `npm run lint`, and `npm run build`.
2. Test authorization first: unconfigured/malformed mapping, user not allowlisted, and `VERCEL_ENV=production` must deny. Manager receives project overview and only project-scoped unapproved evidence. Contributor receives only their own credits/votes/TEST allocations. An account mapped to both roles can see both.
3. Start locally with `npm run dev` and the server-only settings. Sign in with existing Development Supabase identities. Open the conditional **OpenPayables** link on Studies. Verify no write buttons and no exposed DSN. No full blinding workflow rerun.
4. Check a different/unmapped BlindStats account sees neither the link nor the page. Verify `OPENPAYABLES_DATABASE_URL` and `OPENPAYABLES_PILOT_ACCESS_JSON` never appear in HTML, client bundles or console messages.

## Boundaries

The server reader uses the published read-only `projectOverview`, `pendingEvidence`, and `contributorView` methods. It never submits updates, awards credits, votes, funds, starts distributions or calls Stripe. Study capabilities do not grant OpenPayables roles. All identity mapping is server-controlled. All accounting shown is synthetic/TEST-only and does not imply confirmed bank payouts.
