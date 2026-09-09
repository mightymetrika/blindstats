# Blinding Workspace v0

**Status:** Implemented browser-local prototype
**Project:** blindstats
**Artifact schema:** `0.3`
**Updated:** 2026-09-08

## 1. Purpose

Blinding Workspace v0 implements the first stage of the blindstats workflow:

> **Analyst blinding → locked analysis → documented unblinding**

Its job is intentionally narrow:

> **Original CSV → blinded CSV + public receipt + unblinding secret**

The workspace demonstrates the transformation and artifact model before
server-enforced roles, accounts, persistent study records, or research-file
storage are introduced.

## 2. Current scope

The workspace can:

1. read a CSV locally in the browser;
2. allow one categorical column to be selected;
3. generate a randomized one-to-one mapping from observed categories to neutral
   labels;
4. apply the mapping without changing unrelated columns;
5. generate exact source and blinded-artifact SHA-256 values;
6. encrypt the mapping;
7. create a public blinding receipt containing the sealed mapping;
8. create a separate unblinding secret containing the decryption key; and
9. download the three generated artifacts locally.

Current v0 scope is limited to UTF-8, comma-delimited CSV files and one selected
categorical variable per blinding operation.

## 3. Security boundary

### 3.1 Browser-local processing

The current workflow processes the source CSV and generated cryptographic
material in the browser. It does not implement server-side research-file upload
or persistence.

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
    `-- downloads artifacts
```

### 3.2 No role enforcement

Browser-local processing is not a multi-user authorization boundary.

The person creating the blinded package has access to the original data and to
the generated unblinding secret. The intended file-mediated role pattern is:

```text
Study owner
    |
    |-- retains unblinding secret
    |
    `-- gives analyst:
          blinded CSV
          public blinding receipt
```

The current software supports that separation but does not enforce it.

### 3.3 Current privacy limitation

The current prototype should not be treated as a storage, transfer, or
authorization system for sensitive, regulated, confidential, or client research
data.

Open-source code improves inspectability; it does not by itself establish the
privacy, governance, retention, authorization, monitoring, or operational
controls required for those uses.

## 4. Input contract

### 4.1 Supported file

v0 accepts one `.csv` file encoded as UTF-8 and parsed as comma-delimited data.

The source CSV must contain:

- a header row;
- at least one data row; and
- at least one column.

### 4.2 Selected variable

The user selects exactly one column.

The selected column must contain at least two distinct nonmissing serialized
values. v0 treats those observed values as categories; it does not attempt broader
statistical type inference.

### 4.3 Missing values

For the selected column:

- missing cells remain missing;
- missing cells do not receive neutral labels;
- missing cells do not appear in the mapping; and
- their row positions are preserved.

Strings such as `NA`, `N/A`, `.`, or `missing` are not automatically reinterpreted
as missing merely because of their text.

## 5. Blinding transformation

Each distinct nonmissing category receives exactly one neutral label.

The initial neutral-label scheme is:

```text
Group_A
Group_B
Group_C
...
```

The mapping is bijective over the observed nonmissing categories.

Random assignment uses cryptographically secure browser randomness. The
implementation must not silently fall back to `Math.random()`.

Blinding changes only the selected column's nonmissing category values. It
preserves:

- row count;
- column count;
- column order;
- row order;
- the selected column name; and
- all unselected cell values.

Because the selected column name is preserved, v0 blinds category values rather
than all potentially meaningful semantics in a dataset.

## 6. Output artifacts

### 6.1 Blinded CSV

Suggested filename:

```text
<source-base-name>_blinded.csv
```

The SHA-256 stored for this artifact is computed from the exact serialized bytes
offered for download.

### 6.2 Public blinding receipt

Suggested filename:

```text
blinding-receipt.json
```

The public receipt is designed to accompany the blinded-analysis materials.

Its schema-`0.3` structure is conceptually:

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

The receipt contains the encrypted mapping, not the readable mapping.

It does expose workflow metadata such as the selected column name, category count,
dataset dimensions, artifact hashes, and encrypted-payload length. Researchers
should decide whether those metadata are appropriate for the intended blinding
design.

### 6.3 Unblinding secret

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

The secret contains the cryptographic key used for later authenticated decryption.

It should be retained separately from the blinded analyst until unblinding is
authorized.

## 7. Sealed-mapping cryptography

The mapping is encrypted with AES-GCM using Web Crypto.

For each blinding operation, blindstats generates:

- a fresh random 256-bit AES key; and
- a fresh random 96-bit IV.

AES-GCM uses a 128-bit authentication tag.

The encrypted plaintext contains the complete original-to-neutral mapping.
Additional authenticated data binds the sealed mapping to important workflow
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

Changing the secret, ciphertext, IV, or bound metadata should cause authenticated
decryption to fail.

The cryptographic design protects the mapping while the secret remains separate.
It does not enforce when a person releases or uses that secret.

## 8. Artifact identity

### 8.1 Source hash

The source SHA-256 is computed from the exact uploaded file bytes, not from a
parsed-and-reserialized approximation.

### 8.2 Blinded hash

The blinded SHA-256 is computed from the exact bytes offered for download.

### 8.3 Transformation identifier

Each blinding operation receives a fresh UUID. The same transformation ID appears
in the public receipt and unblinding secret.

## 9. Timestamp interpretation

`createdAt` is a browser-generated canonical ISO-8601 timestamp.

It documents the local workflow event but is not an independently trusted
timestamp and should not be described as cryptographic proof of chronology.

## 10. Validation and failure behavior

The operation should fail explicitly for unsupported or malformed inputs,
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

Integrity-critical operations must fail closed rather than silently degrade to a
weaker method.

## 11. Testing expectations

Core automated tests cover:

- CSV parsing and serialization;
- neutral-label generation;
- randomized bijective mappings;
- transformation preservation rules;
- SHA-256 hashing;
- sealed-mapping encryption/decryption;
- authenticated-decryption failures;
- public-receipt structure;
- unblinding-secret structure; and
- package generation.

React component tests focus on stable workflow invariants rather than visual
snapshots or exact explanatory wording.

## 12. Current completion state

As of 2026-09-08, the Blinding Workspace is connected to the complete
browser-local blind-lock-unblind workflow and has passed automated tests, lint,
production TypeScript/build validation, and manual browser acceptance.

The next architectural step is not another local blinding feature. It is to place
this proven artifact protocol inside a stronger study, role, authorization,
storage, and audit architecture when those requirements are ready to be designed.
