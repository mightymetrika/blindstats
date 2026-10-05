# Blinding Workspace v0

- **Project:** blindstats
- **Status:** implemented browser-local artifact operation with persistent registration; pre-release
- **Artifact schema:** `0.3`
- **Updated:** 2026-10-05

## 1. Purpose

Blinding Workspace v0 implements the transformation stage of the current
server-backed blinding workflow.

Its browser-local job remains intentionally narrow:

> **Original CSV → blinded CSV + public blinding receipt + unblinding secret**

That local artifact operation now runs inside a persistent Study and Blinding
workflow with an active immutable Blinding plan, Study-scoped capabilities,
server-backed workflow state, and durable transformation registration.

The current architecture deliberately separates:

- **substantive file processing**, which remains in the browser; from
- **governance and artifact identity**, which are persisted by blindstats.

See also:

- [`study-workflow-v0.md`](study-workflow-v0.md)
- [`analysis-lock-v0.md`](analysis-lock-v0.md)
- [`unblinding-v0.md`](unblinding-v0.md)

## 2. Current governed workflow

The current persistent path is:

1. an authenticated user creates or opens a Study;
2. the Blinding workflow is configured;
3. Blinding plan v1 is activated and becomes immutable;
4. a Study member with `blinding.create` selects a local CSV;
5. one categorical column is selected for transformation;
6. the browser creates the blinded CSV, public receipt, and unblinding secret;
7. the user saves the generated artifacts locally and confirms custody of the
   unblinding secret;
8. blindstats registers the exact public receipt and safe transformation metadata;
   and
9. successful registration moves the workflow from `setup` to `blinded`.

The source dataset, generated blinded dataset, plaintext mapping, and plaintext
unblinding secret are not uploaded as part of this process.

## 3. Current scope

The browser-local transformation can:

1. read a CSV locally;
2. allow one categorical column to be selected;
3. generate a randomized one-to-one mapping from observed categories to neutral
   labels;
4. apply the mapping without changing unrelated columns;
5. generate exact source and blinded-artifact SHA-256 values;
6. encrypt the mapping;
7. create a public blinding receipt containing the sealed mapping;
8. create a separate unblinding secret containing the decryption key; and
9. offer the generated artifacts for local download.

Current schema-`0.3` scope is limited to UTF-8, comma-delimited CSV files and one
selected categorical variable per blinding transformation.

Multiple transformed variables and alternative blinding mechanisms remain
deferred.

## 4. Security and custody boundary

### 4.1 Browser-local substantive processing

The source CSV and generated cryptographic material are processed in the browser.

Conceptually:

```text
User's browser
    |
    |-- reads source CSV
    |-- parses data
    |-- creates randomized mapping
    |-- applies mapping
    |-- serializes blinded CSV
    |-- hashes source and blinded artifacts
    |-- encrypts mapping
    |-- creates public receipt
    |-- creates unblinding secret
    `-- downloads local artifacts
```

blindstats does not persist the source CSV or blinded CSV contents.

### 4.2 Persistent governance is separate from file custody

The current application does provide server-backed authorization and workflow
state.

Blinded-package registration requires:

- authentication;
- `blinding.create`;
- workflow state `setup`;
- an active immutable Blinding plan version; and
- a valid supported schema-`0.3` public receipt.

The database registration function validates the submitted receipt, computes the
SHA-256 of the exact UTF-8 receipt text on the server, binds the transformation to
the active plan, and atomically moves the workflow to `blinded`.

### 4.3 Custodian / analyst separation

The person creating the blinded package necessarily has access to the source data,
the plaintext category identities, and the generated unblinding secret.

In the separated two-party workflow, that person acts as the blinding custodian
or project lead.

The blinded analyst receives the blinded dataset outside blindstats.

The public blinding receipt itself does not need to be separately transferred to
the analyst in the persistent workflow because blindstats stores the exact
registered receipt and can supply it to later governed steps.

The plaintext unblinding secret remains outside blindstats custody.

### 4.4 Release status

The current application is being prepared for a researcher-feedback /
research-preview release.

It should not yet be represented as production-hardened infrastructure for
sensitive, confidential, regulated, or client research data.

## 5. Input contract

### 5.1 Supported file

Schema `0.3` accepts one `.csv` file encoded as UTF-8 and parsed as
comma-delimited data.

The source CSV must contain:

- a header row;
- at least one data row; and
- at least one column.

### 5.2 Selected variable

The user selects exactly one column.

The selected column must contain at least two distinct nonmissing serialized
values.

The current implementation treats those observed values as categories; it does
not attempt broader statistical type inference.

### 5.3 Missing values

For the selected column:

- missing cells remain missing;
- missing cells do not receive neutral labels;
- missing cells do not appear in the mapping; and
- their row positions are preserved.

Strings such as `NA`, `N/A`, `.`, or `missing` are not automatically reinterpreted
as missing merely because of their text.

## 6. Blinding transformation

Each distinct nonmissing category receives exactly one neutral label.

The current neutral-label scheme is:

```text
Group_A
Group_B
Group_C
...
```

The mapping is bijective over the observed nonmissing categories.

Random assignment uses cryptographically secure browser randomness. The
implementation does not silently fall back to `Math.random()`.

Blinding changes only the selected column's nonmissing category values.

It preserves:

- row count;
- column count;
- column order;
- row order;
- the selected column name; and
- all unselected cell values.

Because the selected column name is preserved, schema `0.3` blinds category
values rather than all potentially meaningful semantics in a dataset.

## 7. Output artifacts

### 7.1 Blinded CSV

Suggested filename:

```text
<source-base-name>_blinded.csv
```

The SHA-256 recorded for the blinded artifact is computed from the exact
serialized bytes offered for download.

### 7.2 Public blinding receipt

Suggested filename:

```text
blinding-receipt.json
```

The schema-`0.3` structure is conceptually:

```json
{
  "schemaVersion": "0.3",
  "transformationId": "uuid",
  "createdAt": "ISO-8601 timestamp",
  "transformationType": "categorical_label_permutation",
  "selectedColumn": "treatment",
  "categoryCount": 2,
  "rowCount": 1000,
  "columnCount": 12,
  "sourceArtifact": {
    "sha256": "..."
  },
  "blindedArtifact": {
    "sha256": "..."
  },
  "sealedMapping": {
    "algorithm": "AES-GCM",
    "keyLength": 256,
    "tagLength": 128,
    "encoding": "hex",
    "aadScheme": "blindstats_blinding_mapping_aad_v1",
    "ivHex": "...",
    "ciphertextHex": "..."
  },
  "algorithm": {
    "neutralLabelScheme": "Group_<letters>",
    "mappingAssignment": "web_crypto_random_permutation"
  }
}
```

The public receipt contains the encrypted mapping, not the readable mapping or
unblinding key.

It does expose metadata including the selected column name, category count,
dataset dimensions, artifact hashes, and encrypted payload.

Researchers should consider whether those metadata are appropriate for the
intended blinding design.

### 7.3 Unblinding secret

Suggested filename:

```text
unblinding-secret.json
```

Conceptually:

```json
{
  "schemaVersion": "0.3",
  "secretType": "unblinding_secret",
  "transformationId": "uuid",
  "keyAlgorithm": "AES-GCM",
  "keyLength": 256,
  "encoding": "hex",
  "keyHex": "..."
}
```

The secret contains the cryptographic key required for later authenticated
decryption.

It should remain separate from the blinded analyst until the governed unblinding
process permits release.

blindstats does not persist the plaintext secret.

## 8. Sealed-mapping cryptography

The mapping is encrypted with AES-GCM using Web Crypto.

For each blinding transformation, blindstats generates:

- a fresh random 256-bit AES key; and
- a fresh random 96-bit IV.

AES-GCM uses a 128-bit authentication tag.

The encrypted plaintext contains the complete original-to-neutral mapping.

Additional authenticated data binds the sealed mapping to important transformation
metadata, including:

- schema version;
- transformation identifier;
- creation timestamp;
- selected column;
- category, row, and column counts;
- source SHA-256;
- blinded SHA-256;
- neutral-label scheme; and
- mapping-assignment method.

Changing the secret, ciphertext, IV, or bound metadata causes authenticated
decryption to fail.

The cryptographic design protects the mapping while the secret remains separate.
It does not by itself control whether a person copies or releases the secret
outside blindstats.

## 9. Artifact identity and persistent registration

### 9.1 Source hash

The source SHA-256 is computed from the exact local file bytes, not from a
parsed-and-reserialized approximation.

### 9.2 Blinded hash

The blinded SHA-256 is computed from the exact generated bytes offered for
download.

### 9.3 Transformation identifier

Each blinding operation receives a fresh UUID.

The same transformation ID appears in the public receipt and unblinding secret.

### 9.4 Exact public-receipt identity

The persistent registration stores the exact public receipt text.

The database computes the SHA-256 of that exact UTF-8 text rather than trusting a
caller-supplied digest.

This preserves the exact artifact identity used by later AnalysisLock and
unblinding steps.

Reformatting otherwise equivalent JSON may therefore create a different
exact-byte receipt identity.

### 9.5 Persisted transformation metadata

The persistent transformation record includes safe values such as:

- Study and workflow identity;
- active plan version;
- transformation ID;
- schema version;
- browser receipt timestamp;
- selected column;
- category, row, and column counts;
- source and blinded SHA-256 values;
- exact public-receipt SHA-256;
- exact public receipt text;
- registering user; and
- database registration time.

The source/blinded file contents, plaintext mapping, and plaintext secret are not
stored.

## 10. Timestamp interpretation

The receipt's `createdAt` is browser-generated.

It documents the local artifact creation event but is not independently trusted
chronology.

Persistent registration additionally receives a database-generated
`registered_at` timestamp.

The server timestamp supports a narrower claim:

> blindstats registered this exact public receipt at this server-recorded time.

It does not prove when the source data were originally created or when the user
first generated equivalent artifacts outside blindstats.

## 11. Validation and failure behavior

The local operation fails explicitly for unsupported or malformed inputs,
including:

- invalid or empty CSV;
- missing header/data rows;
- selected column not found;
- fewer than two distinct nonmissing categories;
- unavailable secure randomness;
- unavailable hashing;
- invalid mapping structure;
- encryption failure; or
- artifact serialization failure.

Persistent registration independently validates the supported public-receipt
structure and governed workflow conditions.

Integrity-critical operations fail rather than silently degrading to a weaker
relationship.

## 12. What this stage establishes

When completed through the persistent workflow, blindstats establishes that:

- a supported public receipt was registered under the active immutable Plan;
- the registered receipt identifies exact source and blinded artifacts by SHA-256;
- the exact public receipt representation is preserved;
- the authenticated actor held `blinding.create`; and
- the workflow was transitioned from `setup` to `blinded`.

It does not prove:

- that the blinded dataset was transferred securely outside blindstats;
- that the analyst only used that dataset;
- that protected information was never learned through another route;
- that the selected column conceals every result-relevant feature; or
- that the custodian retained the secret securely.

The goal is an auditable artifact and governance chain, not certification of
researcher behavior.

## 13. Current completion state

As of 2026-10-05, the browser-local Blinding Workspace is integrated into the
persistent Study workflow.

The current implementation has been exercised through the complete governed
workflow and the repository validation baseline is:

```text
Test files: 20 passed
Tests:      117 passed
Lint:       clean
Build:      clean
```

The next release work is documentation and deployment hardening rather than
another broad blinding-transformation feature.
