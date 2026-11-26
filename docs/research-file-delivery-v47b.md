# v47b: multi-file research delivery

## Scope

The accepted v47a engine, receipts, locking and authorization remain unchanged.
Dataset blinding, supporting-file sharing, and analysis locking are separate
operations. The original v0.3/v0.4 single-CSV transfer UI and RPC signatures are
retained. All new delivery uses the existing private Storage bucket and audited
authenticated download route. No new infrastructure, dependencies, OpenPayables
changes, external connectors, or data upload during blinding/locking.

## Registered dataset delivery

In the workflow, use Study files to select up to 20 blinded CSV, TSV or XLSX
files at a time. The client matches the exact filename, SHA-256 and length in
the registered v0.5 manifest, and identifies its datasetId. PostgreSQL repeats
these checks against the immutable registered public receipt, rather than
accepting the package manifest hash as a file hash. The uniqueness boundary is
transformation record, recipient and datasetId. Distinct files can legitimately
have the same bytes/hash. Transfer history is per file; a batch is not an atomic
transaction and individual files become ready independently. The UI displays
ready/expected package coverage; the existing exact-file-set verifier checks
the complete downloaded package on the workflow page. No new analysis-lock
or unblinding authorization prerequisite is introduced by delivery.

New package sends require a blinded workflow and an active Study. Ready files
remain available to the assigned analyst after workflow completion; this is not
an additional disclosure of the unblinding secret. The old single-CSV path
still rejects all v0.5 transformations.

## Supporting research files

Study > Supporting research files is independent of a workflow, plan or
transformation. An active Study must have separated custodian and analyst roles.
The sender selects supported files and explicitly acknowledges review of their
names and contents. Each file is hashed locally; supported filenames are safe
ASCII basenames (up to 160 characters) with PDF, DOCX, TXT, MD, CSV, TSV, XLSX,
R, Rmd, Qmd, PY, SAS, SPS, DO, JSON, YAML/YML, IPYNB, PPTX or RTF extensions.
Files are not parsed or transformed as datasets, rendered, executed, sanitized,
or de-identified by this feature. The browser blocks recognized BlindStats
secret and released-mapping JSON structures even when renamed; SQL blocks
known secret-like names. These are accidental-disclosure safeguards, **not** a
content safety guarantee or a defense against a malicious custodian deliberately
sending secrets in arbitrary documents or encoded data. Only the dedicated
unblinding-secret RPCs and UI implement the authorized secret-release operation.
Do not share supporting files containing actual allocation information, keys,
identifiable content inappropriate for the recipient, or malicious content.

Supporting rows are independent of the workflow/transformation (both nullable),
with a direct Study foreign key. Their active deduplication key is Study,
recipient, exact filename and content hash; changed document versions may be
sent separately. This is not document version control.

## Protection, integrity, lifecycle

The immutable Study protection policy applies to new rows. No downgrade toggle.
Managed transfers retain the server's authenticated route verification of the
actual stored bytes. Recipient-only transfers use the existing Study key and
ECDH/HKDF/AES-GCM primitive but a new envelope version and authenticated
context binding Study, optional workflow/transformation, recipient, transfer ID,
purpose, optional dataset identity, filename, plaintext hash and length. Old
v46 encryption and secret contexts remain compatible, including historical
ready mixed-mode records. New objects use v47-managed-atrest-1 or
v47-research-file-ecdh-hkdf-aes256gcm-1. Existing v46 completion RPCs refuse new
file rows. Recipient verifies stored bytes, decrypts if required, checks exact
plaintext identity and acknowledges through the audited existing RPC before
saving an attachment. Stored object maximum is 4 MiB, including 16-byte GCM tag;
local transformation and analysis locking retain their independent limits.

Failed files leave pending rows; a repeat initiation can reuse an exact pending
row only when no object exists. No overwrite, direct authenticated Storage read,
signed URL, update or delete is permitted. The custodian can explicitly abandon
a pending v47 row. Abandonment is irreversible and audited, blocks new upload
and completion, and permits a fresh identity on retry. A completed row cannot
be abandoned. A stored abandoned object remains for operator cleanup, eligible
after 24 hours (the existing Development-only synthetic immediate override can
be used for named fixtures); active pending supporting files are review-only.
The existing terminal-workflow retention/cleanup rules also apply to pending
package datasets; ready files are never cleanup candidates. The operator CLI
continues to record intent, remove only the exact path, and confirm absence.
No automatic deletion or new service credential is introduced.

## Validation

Implementation 04 accepted on Windows November 26: 46 files, 271 tests,
TypeScript/ESLint/build, 6 cleanup tests, 27 synchronized Development migrations,
DB lint, 11 live authorization/transfer scenarios. Both prior audits clean.

v47b source-only implementation adds migration
20261126200000_multi_file_research_delivery.sql, 10 application test cases in
two files, one cleanup unit test, and two Development-only live scenarios (one
per Study protection policy). Expected totals: 281 application tests (48 files),
7 cleanup tests, 13 live tests (3 files), 28 synchronized Dev migrations. New
integration tests exercise pre-workflow supporting files, wrong role/policy,
invalid artifact references, exact multiple dataset files, blocked legacy
completion, abandoned uploaded object and retry, audited download grant,
verification attestations and existing authorized secret release. Integration
uses synthetic local bytes for decryption/verification; actual browser download
route acceptance remains to be performed in final Preview acceptance.

Independent implementation environment: strict TypeScript 5.8.3 core compile
with a temporary Supabase API declaration; 11 changed TS/TSX syntax checks;
5 Node 22 independent transfer checks; 4 cross-version decryptions using the
actual baseline v46 source and changed v47 source; 7/7 cleanup tests. Full npm
suite, repository TypeScript, lint/build, PostgreSQL migration and live tests
cannot be executed here. No database or deployment operations performed here.

After passing local and Development validation, review the synthetic abandoned
file fixture(s) using the existing operator cleanup CLI, verify ready files are
excluded, and complete the consolidated authenticated Preview/browser acceptance
before release. Production remains untouched until expressly authorized.
