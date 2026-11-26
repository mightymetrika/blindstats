# Implementation 03 follow-up fixture correction

The first correction passed all 265 application tests (45 files) and ESLint.
TypeScript identified three mock fixture type errors in two tests. Construct
the lock receipt bytes directly with TextEncoder and specify the known
non-null LOCK_ID in the locked release completion fixture. The final receipt
inherits the same ID. No runtime source, assertion, schema or dependency
changes. Full TypeScript/build validation and Development migration remain
pending.

---

# Implementation 03 test correction

Windows application validation passed 264/265 tests; the single failure was
an identical-looking mock argument comparison in the new multi-file lock UI
test. Compare exact numeric byte arrays and ordered file descriptors instead
of cross-realm typed-array objects. Retain the exact call count, absence of
legacy generation, exact registered receipt bytes and form-data field checks.
No runtime or database changes. Full local validation and Development
migration validation remain required.

---

# Implementation 02 corrective patch

User validation: zip.js installed and both audits reported zero vulnerabilities;
257/258 tests, ESLint and 6/6 cleanup tests passed. TypeScript/build failed on
an un-narrowed Entry in the test helper. A plain independently generated XLSX
was rejected because of its empty workbookProtection element. Accept only a
unique, completely empty workbookProtection element, never copy it to output,
and continue rejecting nonempty or duplicate elements. The ZIP test helper
now narrows directory/file entries before calling getData. One additional
regression test is supplied. Expected total: 259 tests; validation pending.

---

# Implementation 02 update (local Development only)

Implementation 01 passed the user's Windows validation: 249/249 tests,
ESLint, TypeScript, build, and 6/6 cleanup tests. Implementation 02 adds
XLSX import/export and a reusable browser-local UI, not Study registration.

Install `npm install --save-exact @zip.js/zip.js@2.25.0` before validation.
The user's npm install generates the lockfile. No lockfile is fabricated.
The adapter uses zip.js for ZIP I/O and native DOMParser for XML. It accepts
UTF-8 transitional OOXML, conventional part locations, one visible sheet,
plain shared/inline strings, finite numeric and Boolean values and missing
cells. Nondefault styles (including date-formatted cells), formulas, hidden
sheets/rows/columns, merged cells, rich text, nonstandard workbook structures,
external/unsupported relationships, unexpected/duplicate/encrypted ZIP parts,
unsupported types and DTD/entities in parsed parts are rejected. A fresh
minimal workbook contains only transformed cells and a generic sheet name.
Source workbook formatting, metadata, shared-string cache and other workbook
parts are never copied. The restricted subset is intentionally narrower than
ordinary Excel editing; some otherwise valid Excel workbooks will be rejected.
Unselected values, display formatting and file content still need human review;
this is not de-identification or a guarantee against every possible disclosure.
Limits: 16 MiB compressed, 24 MiB total expanded XML, 50,000 rows including
headers, 256 columns, 200,000 rectangular cells. ZIP entry length and CRC are
checked, with strict local/central consistency and overlapping-entry checking.
No source file is sent to the server by the local workspace. The UI has a
20-dataset/64 MiB combined input limit; these are not hosted transfer limits.

Use `npm run dev` and the authenticated `/development/research-package` route
only with synthetic data if targeted exploratory testing is needed. The route
returns notFound outside NODE_ENV=development; no new navigation is added.
UI: select files, choose variables, explicitly link groups, acknowledge
coding/disclosure checks, save separate files/receipt/secret, locally lock
arbitrary analysis artifacts against v0.3/0.4/0.5 receipts, and verify exact
file sets. Verification compares against supplied receipt bytes and is not
proof of registered provenance. No unblinding action is exposed there.

Nine new tests are supplied; actual dependency installation and all XLSX/UI
runtime checks are pending. Only syntax checks and a strict TypeScript check
of the adapter with a temporary stand-in declaration were performed here.
The fixture was independently generated/reopened with Python openpyxl. No
claim of successful XLSX adapter execution or registered authorization tests.

Remaining: complete registered Study integration (including no-lock policy),
then v47b sharing. Existing v0.3/v0.4 registered pathways remain unchanged.

---

# v47a implementation: local protocol and dataset core (not released)

This is an incremental implementation against the v46 closeout source
(1a13f52d93364ca8a6c6a819306c7d7a76d12fdb). It does not yet change the
registered Study workflow. Existing v0.3/v0.4 application paths remain active.

## Implemented interfaces

- `src/lib/datasets/types.ts`: ordered variables with independent IDs, rows
  of string/number/boolean/null, structural validation, and a byte-level
  format adapter contract. The common representation has no File, database,
  network or storage dependency.
- `src/lib/datasets/adapters/delimited.ts`: UTF-8 CSV and TSV using the
  existing Papa Parse implementation; preserve textual values, leading
  zeros and missing cells. Existing CSV entry points retain their behavior.
  New exports are newline-terminated and reject formula-like text rather
  than silently alter values. Plain signed numeric literals are allowed.
  Spreadsheet applications can still infer types or interpret content in
  product-specific ways; this is not a guarantee that arbitrary text is
  safe to open in spreadsheet software.
- `src/lib/blinding/package-v05/mappings.ts`: one explicit mapping group per
  selected variable; singleton groups are independent. Linked groups share
  the union of observed, type-compatible nonmissing categories, including
  variables with only a subset or no nonmissing categories. Each group needs
  at least two categories overall. Same-name variables are never linked
  implicitly. There is no automatic harmonization; callers must confirm
  same-type categories use compatible coding conventions. One or more
  selected variables is required per transformed dataset. Unchanged
  supporting files belong to the independent sharing operation.
- `package.ts`: local source parsing, mapping, output generation, adapter
  roundtrip verification, and a single authenticated mapping/secret per
  coordinated package. Source and output bytes are independently hashed.
  Generic output names avoid copying source filenames into public metadata.
- `receipt.ts`: strict structural validation and manifest digest checks;
  exact file-set verification against manifest references.
- `analysis-lock.ts`, `legacy-lock.ts`: one v0.5 lock for a set of arbitrary
  analysis artifact byte sequences, independent of the transformation
  protocol (v0.3, v0.4, v0.5). Filenames are unique basenames in a lock.
  Zero-byte analysis files are valid. No analysis file upload is needed.
- `unblinding.ts`: local v0.5 unblinding receipt primitive for the exact
  blinding receipt, secret and selected lock. This is not a Study
  authorization or registration implementation.

## Protocol draft (not deployed)

The receipt contains schemaVersion 0.5, receiptType blinding_package,
transformationId, createdAt, manifest, manifestSha256 and sealedMapping.
The manifest consists of ordered dataset references and ordered mapping
groups. Dataset references identify a dataset independently of filenames;
they contain format, dimensions, selected variable IDs and names, source
byte length/hash, and the blinded output basename/length/hash. Unselected
variable names and original category values are not included in the public
manifest. Selected variable names and category counts remain visible and
 can themselves be sensitive. No de-identification guarantee is made.

Manifest commitment: SHA-256 of UTF-8 compact JSON reconstructed in the
fixed key order in `parseManifest` (arrays remain ordered). AES-256-GCM uses
an independently random 96-bit IV, 128-bit tag and 256-bit secret. Additional
authenticated data is UTF-8 compact JSON of the domain and canonical package
header, including the complete manifest and its digest. The mapping payload
contains typed original category values and neutral labels for each group.
The public receipt file's exact bytes are separately hashed for locking.
The secret is a separate local JSON artifact; never include it in a public
package or supporting-file delivery.

A v0.5 analysis lock references the exact public receipt hash and its
transformation ID, the transformation protocol, and the dataset commitment
(v0.5 manifest hash or historical blinded-file hash). Its artifact references
include ID, filename, byte length and SHA-256. An exact file-set verification
can be performed in any file-selection order. Duplicate names, missing,
extra or changed files fail. A registered, trusted receipt hash is still
required to prove provenance: self-consistent replacement of a public
manifest/lock and its files is not prevented by file-set checking alone.
Likewise the local mapping-opening primitive requires possession of the
secret, not an application authorization check. Do not expose it in the
Study workflow until the registered authorization path has been integrated.

## Validation status

In the implementation environment: TypeScript 5.8.3 strict compilation of
the dependency-free core (target ES2017, DOM/ESNext libs) succeeded; six
independent Node 22 smoke tests using a synthetic typed adapter passed:
linked mappings and missingness, independent groups and invalid groups,
exact package file set, authenticated manifest and secret rejection,
adapter data loss detection, and multi-artifact lock/unblinding receipt.

13 new Vitest test cases are included (8 local core, 4 CSV/TSV, 1 historical
lock). These and the full existing application suite have not been run in
this environment: repository node_modules are absent, npm registry DNS
failed, and Node 24 is not available. Run the full Windows checks before
accepting the patch. No new npm dependencies or lockfile changes.

## Remaining before v47a acceptance

1. Safe XLSX adapter: choose and install a maintained dependency with a
   reproducible lockfile and clean audit; enforce bounded ZIP/XML processing,
   one visible worksheet, unique headers, no formulas/hidden content/
   unsupported cells or external references, and rebuild fresh workbooks.
   Excel is explicitly rejected by `adapterForFilename` for now.
2. Integrate registered v0.5 packages, multi-file locks for old/new
   transformations, and unblinding completions across server actions,
   database constraints/RPCs, exact receipt verification, authorization,
   audit and relevant UI components. Preserve historical bytes and ensure
   existing authorized/unauthorized paths remain intact. Do not route v0.5
   through legacy single-file RPCs. No migration in this patch.
3. Add package selection, explicit mapping-group editing, local downloads,
   verification, multi-artifact lock selection and authorized release UI;
   implement integration tests and exercise synthetic Development workflows.
4. Then v47b multi-file sharing under both existing Study protection policies.

No Production/Development environment or GitHub repository was changed by
this patch creation. OpenPayables source was not modified.


## Implementation 03: registered historical multi-file locks

The lock protocol version is independent of the transformation version. A new
v0.5 lock may refer to a registered v0.3 or v0.4 transformation and must match
its exact public receipt hash and blinded dataset hash. Historical locks and
single nonempty-file creation retain their original protocol. Select multiple
files together (or an empty file) to create a v0.5 lock. Registration allows
1–100 artifacts and at most 256 KiB of UTF-8 lock receipt metadata, without BOM.
The analysis files themselves are never sent. The lock manifest records exact
names, lengths, SHA-256 hashes, and artifact IDs. The analysis-lock FK uses a
generated transformation_schema_version field to maintain version matching.

A v0.5 lock is a normal analysis_locks record, selected through the unchanged
unblinding request/authorization workflow. For these rows only, existing
analysis_artifact_filename/sha256/byte_length columns identify the actual
`analysis-lock-receipt.json` file (the manifest); they do NOT identify one of
its member files or their aggregate size. The SHA-256 is of the exact UTF-8
receipt bytes. Individual file identities are in the immutable receipt text.
The UI distinguishes manifest length/hash from member file length/hash.

For historical transformations with a v0.5 lock, the downloaded unblinding
receipt has schemaVersion 0.5, blindingSchemaVersion 0.3 or 0.4, the original
mapping shape, exact lock receipt hash, analysisLockManifest and the full
analysisArtifacts array. It is not a legacy-format receipt. The browser uses
a legacy-shaped in-memory projection ONLY for the existing mapping view and
safe completion registration; it does not serialize that projection as the
final receipt or submit its plaintext mappings. Existing completion RPCs
verify the selected lock and manifest identity; the stored completion
schema_version denotes the historical transformation protocol, and the linked
lock row identifies the v0.5 lock (and consequently the new release format).
The registered UI checks both authorized receipt hashes before releasing the
mapping. A completed record still trusts the authorized browser's final
receipt hash, just as in v46. Lock verification checks identities/integrity,
not that the analysis was substantively performed as specified.

This patch does not yet enable registered v0.5 multi-dataset transformations.
No new file-sharing or secret-delivery permissions are granted. Test the new
migration only against Development before accepting the patch.


## Implementation 04: registered v0.5 packages

The earlier pending registration and UI notes above describe historical
implementation stages. Implementation 03 (including its two corrections)
passed Windows local validation and Development migration/lint; live tests
were deferred. Implementation 04 implements the remaining registered v47a
source paths, pending local and hosted Development validation.

In setup, a custodian can generate a coordinated CSV/TSV/XLSX package in
the Study, save all blinded files and the public receipt and keep the secret
separate. The single CSV v0.4 option remains available for historical
managed dataset delivery. Registration sends only exact public receipt
bytes, IDs and custody acknowledgement. The server action validates the
receipt and the new RPC independently validates its structure, mapping
coverage, bounded metadata and canonical manifest SHA-256. Registered
packages are limited to 20 datasets and 512 KiB of public receipt bytes.
Both historical source/blinded hash columns hold the v0.5 manifest digest,
not a single file hash; the exact receipt contains each file identity.
Aggregate row/column counts summarize the package, not a joined dataset.

The registered UI verifies the entire local file set against the stored
receipt hash. All v0.5 package analysis locks use v0.5 lock receipts even
for one selected file. The original plan governs required or optional
locks; authorization binds to the exact selected lock or its absence.
Unblinding checks the stored receipt and lock hashes before authenticated
mapping decryption. The local final receipt includes the public manifest,
complete lock file references where applicable and released groups; only
nonsecret commitment metadata is sent to the completion RPC. As before,
completion registration is an authorized client's attestation of the local
receipt, not a server-side proof that analysis was performed or mappings
were decrypted. Never send the final plaintext mapping receipt to the RPC.

Legacy single-file dataset transfer RPCs explicitly exclude v0.5 packages.
Until v47b, transfer the blinded package externally in compliance with the
Study's protection requirements; the old v0.4 delivery remains unchanged.
Existing authorization-gated secret sharing supports v0.5 under both
managed and recipient-only Study policies. No general-purpose supporting
file sharing or multi-file managed dataset delivery is included yet.

New tests cover registered local UI, optional locks, v0.5 secret verification,
malformed and altered public receipts, independent authorization, completion
identity mismatches and both secret-delivery policies. The opt-in live
launcher requires the exact Development URL and two existing test accounts;
it uses synthetic Studies and files and may leave test audit/storage records.
Do not run against Production. Actual npm suite and SQL execution/lint remain
pending in the user's environment. No npm dependency or Production changes.
