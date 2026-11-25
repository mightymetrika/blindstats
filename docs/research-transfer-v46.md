# Study-level file protection (v46 policy candidate)

This section supersedes earlier descriptions of per-transfer encryption choices.
The Study creator selects managed secure storage (default; provider encryption
at rest and TLS, not end-to-end) or required recipient-only encryption when
creating a Study. The policy is immutable from creation in this increment.
In strict Studies the assigned analyst can generate a Study-specific P-256 key
on the Study page before a workflow or transformation exists. The encrypted
private-key backup remains passphrase protected. The custodian sees readiness;
refresh to check again. No file can be queued in strict mode before the public
key exists, and no server escrow or silent downgrade is provided. A notification
system and pre-account invitations are outside this increment. Assignment still
requires an existing account. Users should coordinate initial enrollment if
strict protection is selected. Browser code and authenticated public-key registry
are trusted; recipient-only encryption is not a guarantee against malicious
application code or infrastructure altering code or key registration.

Both existing dataset initiation RPCs and authorized secret initiation enforce
exact Study mode, including retry paths. New transfer rows and key registration
are independently guarded by triggers. The public key index rejects identical
P-256 coordinate material even across Studies. New keys cannot be registered in
managed Studies. Revoking membership removes access through existing RLS but
preserves encrypted key backup to avoid destroying historical access upon
reassignment. Account deletion remains subject to existing foreign keys.
This policy governs in-app file transfer, not external/manual local file handling.
Existing secret authorization and post-completion denial remain unchanged.

Migration 20261124234500 infers strict policy for existing Studies with any
recipient-only transfer (dataset or secret); other Studies default managed. Ready
historical files keep their original mode and may be retrieved under their
original permissions; older managed files are not retroactively encrypted.
Incompatible pending transfers or duplicate key material cause transaction failure
rather than silent modification or deletion. Existing managed Study key backups
are retained, not used for future managed files. No data deletion in migration.

Validate 236 application tests, 6 cleanup tests, lint, build and both audits;
dry-run the new migration against verified Development before applying. Then run
both updated integration tests; validate policy is immutable, cross-mode dataset
and secret initiation denied, key not required for managed delivery, strict
transfer blocked before key registration, early registration before workflow,
key reuse denied, membership revoke/restore retains but hides the key, and
existing authorization/completion tests still pass. Browser test a fresh strict
Study: assign analyst, confirm setup available on Study page before generation,
verify custodian waiting status and blocked send, analyst creates key, custodian
refreshes and sends, analyst downloads and verifies with passphrase, lock/request/
authorize/send/load/unblind/complete, no retrieval after completion. Managed
regression uses fresh Study with no key and sender-first delivery. No real data.

---

# v46 Release Hardening 2 — operator storage lifecycle (2026-11-24)

User-confirmed Hardening 1: 234/234 tests, lint, build, both npm audits zero,
23/23 Development migrations, schema lint, both extended integration tests PASS.
Windows dependency lockfile remains authoritative. No Git/Production changes.

## Retention policy and operating limits

- Secret objects are eligible for operator cleanup 24 hours after durable
  unblinding completion for the same request and terminal `unblinded` workflow.
  Access to the shared secret was already denied at registered completion.
- Pending dataset or secret objects are eligible only after a durable terminal
  workflow completion plus 24 hours. Ready blinded datasets are never selected.
- Pending rows older than 24 hours in active workflows are review-only. Do not
  delete an active transfer's object or mutate transfer metadata. Retry the
  same original file if no object exists; if completion failed after upload,
  retain the original file and escalate for explicit operator recovery. No
  automatic recovery, cancellation, or key rotation is implemented in v46.
- Transfer rows, hashes, receipt records, and historical events are retained.
  The separate cleanup audit records intent and confirmed absence, using
  database timestamps and an operator-supplied label (not verified human identity).
  The existing actor-specific transfer events are unchanged.
- No automatic deletion job. Review the inventory daily when operating the
  managed-storage pilot; act on eligible entries one at a time. A grace period
  is an earliest eligibility threshold, not a guaranteed deletion deadline.
  No deletion of orphan objects with no matching transfer record; escalate such
  cases separately. Inventory returns up to 100 rows; filter on a known transfer ID.
- Custodians retain their own secure original secret and dataset; analysts retain
  their verified datasets and final receipts according to study policy. Managed
  storage is a transfer utility, not an archival/backup guarantee. Ordinary
  database backups do not guarantee availability of Storage objects. Do not
  interpret confirmed Storage API removal as erasure from backups, local copies,
  or provider infrastructure. Retention for ready datasets, backup and disaster
  recovery, withdrawal/deletion requests and institutional privacy requirements
  need an explicit policy before real participant data or unrestricted use.
- The service-role credential remains privileged. Only operators can invoke
  cleanup RPCs, and the CLI uses the existing ignored Development `.env.local`.
  No new client-facing permission or API route. No new secrets in this patch.
  Never delete rows directly from `storage.objects`; Supabase requires the
  Storage API: https://supabase.com/docs/guides/storage/management/delete-objects.

## Development acceptance

1. Apply overlay, run `node --test scripts/lib/research-storage-cleanup.test.mjs`
   (6 tests), npm test (234 expected), lint, build, both npm audits. Dry run the
   new migration `20261124223000_add_research_storage_cleanup.sql`; review
   before applying. Migration does not delete any objects or records.
2. Apply only to verified Development; expect 24 synchronized migrations and
   clean DB lint. Run existing two-account integration script. It checks both
   parties cannot call any cleanup RPC or read the operator audit table, and
   prints two synthetic completed secret IDs plus their ready dataset IDs.
3. `node scripts/research-storage-cleanup.mjs` is a read-only inventory. No
   credentials or file contents are printed. Select exactly one synthetic
   completed secret ID from the integration output; preview it with
   `node scripts/research-storage-cleanup.mjs --transfer UUID --synthetic-immediate`.
   This explicit Development-only option skips grace for completed studies named
   `[INTEGRATION TEST]...` so tests need not wait a day. Never use on real data.
   Preview a ready dataset ID the same way; it must not appear as eligible.
4. After reviewing output and confirming it is a disposable synthetic secret,
   run `node scripts/research-storage-cleanup.mjs --transfer UUID --synthetic-immediate --apply --confirm kfrfemqoalzxwzecyjjf --operator v46-development-validation`.
   This records intent, removes exactly one object through the Storage API,
   then confirms absence via database metadata. Repeat preview; deleted secret
   no longer appears. Revisit Study: completion/receipt and transfer history
   remain intact. Retry a failed/incomplete cleanup with the same arguments;
   open audit intent is reused, and failures do not claim successful deletion.
   Verify the ready dataset still downloads. Do not delete any other objects.
5. Final recipient-only browser test, Preview, controlled Production decision.
   Production mode is explicit (`--environment production`, separately created
   ignored `.env.production.local` with matching Production URL and server key,
   `--confirm nafujgfnylnvmmhpbpot` for apply); no synthetic-immediate override.
   Do not create that file, configure credentials, run Production cleanup or
   deploy until separately approved. Operator must establish a daily review
   process before enabling managed storage for production pilot use.

---
Earlier sections below are historical and superseded where inconsistent.

# v46 release hardening — source review (2026-11-24)

User-confirmed: Candidate 4 plus test fix passed 232/232 tests, lint, build,
22/22 Development migrations and both extended live integration cases. User
reported successful browser end-to-end managed delivery and mapping release.
Completion registration / denial after completion are now tested explicitly.
Dependency updates: Next.js and eslint-config-next 16.4.6, Vitest 4.1.12;
production and full npm audits both reported zero vulnerabilities; 232/232
regression tests, lint, build passed. OpenPayables pin unchanged. The lockfile
updated on Windows is authoritative and is NOT included in this overlay.

## Focused hardening candidate (not yet validated in Development)

- Add restrictive dataset bucket INSERT/SELECT/UPDATE/DELETE guards; current
  sender/recipient capabilities, pending transfer, and blinded workflow required
  at upload. Other permissive Storage policies cannot override these guards.
- Bind the dataset download path to the requested transfer ID before accessing
  privileged Storage; secret download already did this. Keep authorization,
  SHA-256, object length and no-store protections.
- Limit managed and recipient-key stored dataset objects to **4 MiB**, including
  encryption overhead. The prior 5 MiB limit is above Vercel's documented
  default buffered 4.5 MB response ceiling. Migration deliberately fails if an
  existing larger dataset record/object is found; no automatic deletion.
  See https://vercel.com/docs/functions/limitations. Secret objects remain 16 KiB.
- Standardize all Study files disclosure indicators and typography. No change
  to optional encryption behavior or secret handling.
- Extended live tests register local unblinding completion and verify further
  secret grants/acknowledgements fail in both modes. Test signed URL denial for
  both dataset parties. RPC grants do not prove actual HTTP retrieval; recipient
  acknowledgements are client attestations, not independent proof of behavior.

Apply overlay on Candidate 4 + test fix + Windows dependency updates. Run
npm test (234 expected), lint, build, npm audit --omit=dev, npm audit. Verify
Development ref kfrfemqoalzxwzecyjjf, dry-run only: exactly
20261124194500_harden_research_transfer_storage.sql pending. Review output
before applying; then expect 23 migrations, clean DB lint and two passing
extended integration tests. No Production or OpenPayables changes.

## Remaining release gates

Storage lifecycle remains unresolved: deny new researcher access after
completion, but remove completed secret object bytes through the Storage API
while retaining metadata/audit; handle failed pending uploads safely (avoid
race with active upload; do not overwrite or delete ready dataset objects).
Define retention for ready datasets, recovery obligations and backups; ordinary
PostgreSQL backups do not include objects. No cleanup performed by this overlay.
Review live bucket/policies and privileged server-key isolation; no direct
Storage reads or signed URL bypass. Verify separate-account advanced recipient-
key browser delivery, completion registration, and denial after completion.
Protected Preview tests should include a near-limit dataset and wrong-recipient
negative tests. Keep synthetic-only warning until security/retention decisions
and explicit release approval. Production still needs patched dependencies;
if v46 release is delayed, consider a separate security-only release. Production
Supabase is nafujgfnylnvmmhpbpot; do not relink or deploy as part of this step.

---
Historical candidate documentation below is superseded where inconsistent.

# Candidate 4 — authorization-gated secret transfer (2026-11-24)

Candidate 3 is Development-accepted (217 unit/component tests, lint, build, 21/21 migrations, two live integration tests; user accepted the browser workflow). Candidate 4 is unvalidated in Windows/Development.

## Researcher workflow

After a registered analysis lock (when required), the analyst requests unblinding and a different authorized member grants authorization. Only the original registering custodian can then send the saved secret from the Unblinding view. The requesting analyst opens that view, selects **Load shared secret**, and separately invokes existing local unblinding. Local-file fallback remains. Neither loading nor sending registers completion. The original source CSV and revealed mapping are never uploaded by this workflow. Registration of the final unblinding receipt remains metadata-only.

Managed delivery requires no analyst passphrase and uses provider encryption at rest and TLS; privileged infrastructure can technically read secret contents *after* authorization. Recipient-only delivery uses the Study's existing public key and a request-specific cryptographic context; it requires a recovery passphrase at retrieval. If the blinded dataset was sent recipient-only, secret delivery must also be recipient-only. No plaintext secret is staged on the server before authorization. Keep the original local secret securely until completion. A separate secret bucket/table/RPC boundary prevents the older dataset grant from retrieving secrets. The secret recipient is the actual requester, not an arbitrary analyst. Current role checks, exact independent authorization, active plan, and authorized workflow state are checked in SQL at initiation, upload, completion and retrieval. The server reads only after an audited grant and checks object size and digest. Verification is a client attestation, not proof of client behavior. No secret download after workflow completion; prior downloads cannot be revoked. Secret bytes remain stored until a future retention/cleanup mechanism or controlled operator deletion; metadata and audit records persist. Failed pending uploads may require operator cleanup, as with dataset transfers. No new credentials or external links.

## Development validation

Apply on top of Candidate 3 plus UX follow-up; run `npm test`, `npm run lint`, `npm run build`. Dry-run the linked Development migration `20261124183000_add_authorized_secret_transfer.sql` only; review before applying. After applying, expect 22 migrations and clean DB lint. Run the existing `scripts/run-development-transfer-test.ps1` (two extended integration cases); they test the managed and recipient-only paths, denied preauthorization uploads and initiation, denied sender reads, signed URLs, old dataset RPC isolation, and audit. The tests verify DB grants, not the actual HTTP response. Browser smoke: synthetic fresh Study; send dataset; analyst lock/request; confirm no send/load action before authorization; authorize; custodian sends correct local secret (wrong secret rejected); analyst loads secret without additional password in managed mode; only then explicitly reveal and register completion. Confirm audit records and that new retrieval is denied after completion. Also verify advanced mode with existing key and passphrase in Preview. Check matching disclosure panels. Synthetic data only. No Production change until separate release decision and security/dependency review.

---

The previous candidate notes below are historical and may describe earlier, superseded behavior.

## 2026-11-24 validation and interface follow-up

Candidate 3 with UUID hotfix passed 217/217 tests, lint and build. Development
migration applied (21/21 synchronized), database lint clean, both transfer
integration tests passed. Analyst browser showed a managed file ready without
key enrollment. Actual browser download/verification still to be confirmed.
The follow-up presents an explicit unchecked encryption checkbox and mounts
future-file key setup only on demand. Managed-mode trust disclosures remain
in expandable help; no protocol/schema changes. The earlier status below is
historical. Do not replay either applied migration.

# v46 Candidate 3 — Sender-first managed research-file delivery

**STATUS: SOURCE CANDIDATE, NOT VALIDATED AGAINST DEVELOPMENT.**
Candidate 2 + build fix have passed on Windows: 211/211 tests, ESLint,
full Next.js build and TypeScript. Candidate 3 is a new functional revision;
those earlier results do NOT validate Candidate 3. Database migration
`20261123193000` is already applied in Development (20/20). **Do not replay it.**
Candidate 3 adds ONLY the new migration
`20261123235500_add_sender_first_managed_research_transfer.sql`, which must
be reviewed and dry-run against linked BlindStats Development
`kfrfemqoalzxwzecyjjf` before application. Never apply to Production at this stage.

## Standard researcher experience

- Existing Study blinding workflow and analyst role assignment remain the
  authority. The analyst must already have an authenticated BlindStats account
  and be assigned to the Study. Email-only pending invitations are a separate
  future improvement, not part of this candidate.
- Custodian generates/registers the blinded CSV, chooses the assigned analyst,
  selects that exact CSV, and clicks **Send file securely**. The browser
  verifies the file against the registered SHA-256, then uploads to the private
  Supabase bucket under an audited, authorized object path.
- Analyst may log in later, on another computer, open **Study files**, and
  download immediately. No extra key enrollment, passphrase, shared URL,
  email, or interaction with the custodian is required.
- The download endpoint calls a recipient-only PostgreSQL authorization/audit
  function, reads from private Storage with a server-only credential, checks
  stored byte length and SHA-256, and returns the object with no-store headers.
  The browser verifies SHA-256 again and submits a verified-download receipt.
- Four server-timestamped events remain: upload_initiated, upload_completed,
  download_granted, download_verified. A grant event means that an authorized
  request was permitted, not necessarily that the download was completed.

## Explicit privacy and encryption boundary

**Managed mode (`managed_at_rest_v1`) is NOT end-to-end encrypted.** The
blinded CSV is transferred over HTTPS and stored in a private Supabase bucket
under Supabase's platform-managed encryption at rest. The BlindStats application
server, privileged service credentials, cloud provider and authorized operators
can technically inspect its plaintext. Its contents are not intentionally
inserted in public Study/database tables. This is a deliberate tradeoff to
avoid analyst-first cryptographic enrollment for the normal managed option.
Do not advertise "browser-encrypted" or "zero-knowledge" for managed mode.

The original **recipient-key mode** (`recipient_e2ee_v1`) remains available in
an advanced disclosure. It encrypts bytes in the browser and protects the
private key with a recovery passphrase, but requires analyst setup before
sending. Original v46 transfers stay readable using the existing backup.
The `research_transfers.ciphertext_sha256` and `ciphertext_byte_length` columns
are legacy names and hold the *stored object* digest and length in managed
mode. The `transfer_mode` column and immutable DB trigger prevent a mode
switch or a false claim that managed plaintext is client ciphertext.

The same RLS policy prevents authenticated users (including the intended
recipient) from directly reading or minting signed URLs for the private bucket;
all reads go through the authorization/audit endpoint. The 5 MiB object limit
remains. Files are immutable per (transformation, recipient) in this increment.

**Unblinding secrets are NOT transferred in Candidate 3.** Their release still
requires independent authorization, separate from Study membership and dataset
access. Do not confuse them with ordinary blinded dataset downloads. Transfer
of authorized secrets and final unblinded datasets remains separate work.
Never test with real participants, confidential datasets or unblinding secrets.

## Development validation gate

1. Apply candidate ZIP over uncommitted Candidate 2 + build fix on
   `development` at `5ce58ba`, not over the original baseline.
2. `git diff --check`, `npm test`, `npm run lint`, `npm run build`.
3. Explicitly verify `.\supabase\.temp\project-ref` is
   `kfrfemqoalzxwzecyjjf`. Run `npx supabase migration list --linked`, then
   `npx supabase db push --linked --dry-run`. Exactly the *new* migration should
   be pending. Review SQL before applying; do not run `db push` without approval.
4. After approved Development migration, run `npx supabase db lint --linked
   --level warning` and `scripts/run-development-transfer-test.ps1`. Its
   integration test now exercises *both* key-encrypted and sender-first
   managed delivery using synthetic Studies.
5. Use two separate authenticated browser profiles with a fresh synthetic
   Study. **Do not create a recipient key in the analyst account.** Have the
   custodian send the registered blinded dataset first, then log in as the
   analyst and download. Confirm exact SHA-256, four audit events, no direct
   Storage reads and denied access for wrong user. Separately smoke legacy
   advanced decryption using the already-existing synthetic transfer.
6. Only after acceptance: controlled source Git commit/push to `development`,
   protected Preview deployment and security review. Production remains
   unchanged until a separate release decision.

---

# v46 Candidate 2 — Study-files usability refinement

**Candidate 2 is an unvalidated presentation-only revision to already functioning
Candidate 1 Development code.** The Development migration
`20261123193000_create_encrypted_research_transfer.sql` has already been
applied and verified (20/20 synchronized); do not run it again.

Changes: navigation integrates **Study files** after **Blinded package**;
file selection now has a visible **Choose CSV file** control; browser-added
filename suffixes such as `(1)` are normalized for metadata only (the original
CSV bytes and registered SHA-256 are unchanged); common controls
use researcher language. Technical security details, raw IDs/hashes and audit
events remain available in collapsed disclosure panels. New UI tests cover
the file chooser, lack-of-recipient state, and first-time setup.

The underlying analyst-first public-key prerequisite is **unchanged**. No
unblinding secret or unblinded dataset is transferred by this revision. The
screens explicitly describe these limitations rather than pretending the
workflow is fully streamlined.

**Next:** validate all npm tests, lint, build and do a browser check with the
same synthetic Study. Then design a sender-first key-delivery flow that does
not misrepresent the privacy/security boundary, and add separately gated
post-authorization secret delivery. Do not use real participant data, commit
or promote to Production yet.

---

# v46 — encrypted blinded-dataset transfer (candidate 1)

**Status:** Source candidate, not yet accepted in Development. No migration or
storage objects have been created by this source handoff. Production is untouched.

## Scope and operational flow

The existing v0.4 browser-local blinding operation is unchanged: the custodian
must still save the original generated **blinded CSV**, public blinding receipt,
and unblinding secret separately. This v46 increment transfers **only** the
registered blinded CSV. It does not store source datasets, secrets, unblinding
mappings, analysis documents, random assignment, or data-collection records.

1. A blinded transformation must already be registered in a Study using the
   existing blinding workflow. The custodian and blinded analyst must have
   the existing two-party capability separation.
2. The analyst opens **Secure blinded dataset transfer** from that workflow,
   creates a strong recovery passphrase, and registers a Study-scoped public
   P-256 encryption key and a passphrase-encrypted private-key backup. The
   passphrase is never sent to BlindStats or saved in the browser.
3. The custodian opens the same page, selects the enrolled analyst and the
   exact locally saved blinded CSV, and initiates transfer. The browser checks
   the CSV bytes against the server-registered blinded-dataset SHA-256 **before**
   encrypting or uploading. The browser uses ECDH P-256, HKDF-SHA-256,
   AES-256-GCM, a new ephemeral key, salt and IV for this transfer.
4. An authenticated Supabase Storage **INSERT-only** policy permits the
   custodian to upload the ciphertext at a server-assigned Study/transfer path
   while its database row is pending. Completion requires an actual Storage
   object of the reported byte length, records the ciphertext SHA-256, and
   sets a `ready` state atomically with an audit event.
5. The analyst can access only a transfer explicitly addressed to their
   current authenticated Study account. A server-side route first invokes a
   governed PostgreSQL authorization/audit function, then reads **ciphertext**
   with a server-only Storage credential. There is **no user SELECT policy**
   for this Storage bucket, so users cannot create signed read URLs.
6. On the analyst's own computer, the browser downloads ciphertext, validates
   its SHA-256 and byte length, unlocks the private key with the recovery
   passphrase, decrypts, validates the resulting CSV against the original
   registered blinded hash, and records a recipient verification attestation
   with a trustworthy server timestamp.

No plaintext research file or unblinding secret passes through the Next.js
server or Supabase Storage. The service role sees ciphertext only. Private keys
are retrievable across devices by the designated analyst, but *only* as a
passphrase-encrypted backup. The custodian cannot read the backup via RLS.

## Policy and audit boundary

- **Sender:** must retain `blinding.configure`, `blinding.create`, and
  `unblinding.authorize`, without analyst-side capabilities, on the active Study.
- **Recipient:** must have all three analyst-side capabilities
  (`analysis.lock`, `unblinding.request`, `unblinded.receive`) without custodial
  or authorization capabilities. Assignment is established by the existing
  `assign_blinded_analyst_by_email` workflow.
- **Independent authorizer:** no research transfer role, including when they
  can authorize unblinding. Existing unblinding gates remain unchanged.
- **Records:** `research_transfers` binds Study, workflow, registered
  transformation, exact blinded SHA-256, sender, recipient, object path,
  ciphertext digest, size, envelope and server timestamps. Append-only
  `research_transfer_events` records `upload_initiated`, `upload_completed`,
  `download_granted`, `download_verified` with actor, transfer and server time.
  The last event is an analyst attestation after client-side verification,
  not independent server inspection of plaintext. The server does not have
  the plaintext necessary to inspect it. Data contents are not in SQL tables.
- The upload RLS policy is scoped to a pre-authorized, pending transfer path.
  No authenticated principal has Storage SELECT/UPDATE/DELETE on the new
  bucket via this migration. **Review other preexisting Storage policies** in
  Development for any unexpectedly broad access. The bounded integration test
  must demonstrate that the custodian and analyst both fail direct Storage
  downloads, even after the analyst invokes the authorization RPC.
- Audit events cannot be inserted/updated/deleted through the authenticated
  Data API; they are written only by SECURITY DEFINER functions. PostgreSQL
  privileged administrators retain control of backups and metadata, so this
  is an auditable application record, not a hardware-backed immutable ledger.
- A missing/invalid service role key fails downloads closed. The server-only
  key is powerful: store it only in ignored `.env.local` for Development and
  Vercel's protected Preview secret settings, never in `NEXT_PUBLIC_*`, Git,
  documentation, error traces, or a client bundle. The Next.js route uses it
  only after user claims and the recipient-only database RPC succeed.

## Recovery and limits

- **Cross-computer recovery:** sign in with the same account, open the same
  Study workflow, enter the recovery passphrase. The encrypted backup is in
  the Study database, not tied to the first browser or computer.
- **Lost passphrase:** BlindStats cannot decrypt the existing file. The first
  increment does not support private-key rotation or reissue. The recipient
  must preserve their passphrase securely and the custodian should retain the
  original blinded CSV separately. Do not promise administrator recovery.
- **Pending upload:** a failed upload leaves a pending row. Retrying with the
  same exact file and recipient can reuse the pending ID **if no object was
  stored**; a failed completion after a successful upload needs administrator
  inspection/cleanup in Development. Objects are never publicly accessible.
- One transfer per registered transformation and recipient. Object limit:
  **5 MiB of encrypted ciphertext**, uploaded without overwrites. This
  is an intentional first-increment limit, not a scale target. The 5 MiB size
  must also be supported by the Supabase project's global upload limit.
- No arbitrary file types or multiple recipients in candidate 1. No custom
  institution-managed storage adapter exists yet; all managed Storage calls
  are isolated in `src/lib/research-transfer/storage.ts`, and the metadata
  has an explicit `storage_backend` discriminator for a later adapter.
- Supabase does not include Storage blobs in ordinary PostgreSQL backups;
  managed Storage durability/retention must be addressed before production
  approval. No actual participant data until further security and policy work.

## Development-only validation and release gates

All operations below occur on `development` from baseline **5ce58ba**. The
expected Supabase Development project is `kfrfemqoalzxwzecyjjf`. Do not
relink to or modify Production. Use Windows PowerShell 5.1 and Node 24.

1. Apply only complete repository-relative files from the supplied candidate
   ZIP to the clean checkout; inspect `git status --short` and the migration.
2. Run `npm ci`, `npm test`, `npm run lint`, and `npm run build`.
3. Verify `npx supabase migration list --linked` and the expected Development
   ref. Run `npx supabase db push --linked --dry-run` and require exactly the
   new `20261123193000_create_encrypted_research_transfer.sql` migration.
   Review migration SQL and diff. **Only after the user explicitly approves
   the Development migration**, run `npx supabase db push --linked`, then
   `npx supabase migration list --linked` and
   `npx supabase db lint --linked --level warning`.
4. Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File
   .\scripts\run-development-transfer-test.ps1`. This prompts privately for
   two existing Development test accounts and writes an archived synthetic
   Study plus one small ciphertext object. It verifies both roles and denies
   direct Storage reads; it does **not** exercise the Next.js HTTP endpoint.
5. After the database tests pass, run `powershell.exe -NoProfile
   -ExecutionPolicy Bypass -File
   .\scripts\configure-development-transfer-storage.ps1` and enter only
   the **Development** Supabase service-role key privately. Start `npm run
   dev`. From two distinct browsers/computers, sign in as custodian and
   analyst, enroll the analyst key, register a synthetic v0.4 blinded CSV
   through the existing UI, and complete the transfer. Confirm the analyst
   recovers identical bytes with their passphrase, one authorized transfer
   appears, and all four audit events have server timestamps. Negative checks:
   another account/authorizer cannot open transfer page; custodian cannot
   download; wrong passphrase and wrong CSV/hash fail without plaintext upload.
6. Repeat through **protected Vercel Preview** after separately configuring
   the `SUPABASE_SERVICE_ROLE_KEY` environment variable for Preview only.
   Do not set this key in Production or use `--prod` in this milestone.
7. Only after tests, migration, Dev browser acceptance and Preview acceptance:
   commit/push approved files on `development`, update `PROJECT_HANDOFF.txt`
   with real results, and separately decide whether to release to Production.

This candidate has **not** yet undergone Development database testing, real
cross-account end-to-end testing, or security review. Do not treat source-only
crypto smoke tests as acceptance of the full system.
