# Documented Unblinding v0

**Status:** Implemented browser-local prototype
**Project:** blindstats
**Artifact schema:** `0.3`
**Updated:** 2026-09-08

## 1. Purpose

Documented Unblinding v0 completes the browser-local scientific workflow:

> **Blind → analyze while blinded → lock an exact analysis artifact → unblind → document**

The unblinding stage verifies the linked public receipt and analysis-lock receipt,
uses the released cryptographic secret to authenticate and decrypt the sealed
mapping, and creates the first workflow receipt that records the readable mapping.

## 2. Required inputs

The unblinding operation requires exactly three JSON artifacts:

1. the exact public blinding receipt;
2. the unblinding secret; and
3. the analysis-lock receipt.

No source dataset, blinded dataset, or analysis artifact is required by the
unblinding operation itself.

Those substantive artifacts were identified earlier in the workflow and their
identities are carried forward through hashes and receipts.

## 3. Artifact-chain validation

Before releasing the mapping, blindstats verifies the following relationships.

### 3.1 Public receipt

The public receipt must be a valid supported schema-`0.3` blinding receipt,
including valid transformation metadata, source/blinded hashes, sealed-mapping
parameters, and blinding-algorithm metadata.

### 3.2 Unblinding secret

The unblinding secret must:

- use schema `0.3`;
- identify itself as `unblinding_secret`;
- use AES-GCM with a 256-bit key;
- contain a valid hexadecimal key; and
- carry the same transformation ID as the public receipt.

### 3.3 Analysis lock

The analysis-lock receipt must:

- refer to the same transformation ID as the public receipt;
- carry the same blinded-artifact SHA-256 as the public receipt; and
- contain the SHA-256 of the exact public-receipt bytes supplied at lock time.

At unblinding, blindstats hashes the exact public-receipt bytes again and requires
that hash to equal the value recorded in the analysis-lock receipt.

### 3.4 Authenticated mapping decryption

blindstats decrypts the public receipt's sealed mapping using AES-GCM and the
released unblinding secret.

Authenticated decryption also uses the transformation metadata bound as
additional authenticated data during initial blinding.

The operation fails if the key, ciphertext, IV, authentication tag, or bound
metadata is inconsistent.

After decryption, blindstats validates that the payload:

- has the expected internal domain marker;
- contains a mapping array;
- contains at least two entries;
- has unique original categories;
- has unique neutral labels;
- uses the expected `Group_<letters>` label set; and
- has the category count recorded in the public receipt.

## 4. Why the analysis artifact is not supplied again

The analysis-lock receipt already records the exact pre-unblinding analysis
artifact by SHA-256, filename, and byte length.

The unblinding question is whether a valid lock record exists for the same public
blinding receipt, not whether the analyst still possesses another local copy of
the locked file.

A future utility may verify a candidate analysis artifact against a lock receipt,
but that check is separate from mapping release.

## 5. Output

The unblinding stage produces one downloadable unblinding receipt.

Conceptually:

```json
{
  "schemaVersion": "0.3",
  "receiptType": "unblinding",
  "unblindingId": "uuid",
  "createdAt": "ISO-8601 timestamp",
  "transformationId": "uuid",
  "lockId": "uuid",
  "selectedColumn": "treatment",
  "artifacts": {
    "sourceArtifactSha256": "...",
    "blindingReceiptSha256": "...",
    "blindedArtifactSha256": "...",
    "unblindingSecretSha256": "...",
    "analysisLockReceiptSha256": "...",
    "analysisArtifact": {
      "filename": "analysis.docx",
      "sha256": "...",
      "byteLength": 12345
    }
  },
  "releasedMapping": [
    {
      "original": "Treatment",
      "blinded": "Group_B"
    },
    {
      "original": "Control",
      "blinded": "Group_A"
    }
  ]
}
```

The unblinding receipt is a **post-unblinding artifact**. It contains protected
information and should be handled accordingly.

## 6. Exact-byte relationships

The final receipt records SHA-256 values for:

- the source artifact originally identified by the public receipt;
- the exact public-receipt bytes supplied at unblinding;
- the blinded artifact originally identified by the public receipt;
- the exact unblinding-secret bytes supplied at unblinding;
- the exact analysis-lock-receipt bytes supplied at unblinding; and
- the previously locked analysis artifact identified by the lock receipt.

The analysis artifact itself is not rehashed at unblinding.

## 7. Secret-release interpretation

In the intended file-mediated role model:

1. the owner retains the unblinding secret;
2. the analyst locks the pre-unblinding analysis;
3. the owner releases the secret; and
4. the analyst completes unblinding.

The current software does not enforce that chronology.

Possession of both the public receipt and unblinding secret is cryptographically
sufficient to decrypt the sealed mapping with compatible software, even without
using blindstats or providing an analysis-lock receipt.

Therefore, v0 depends on human/file separation for the timing of secret release.
A later platform should enforce release through authenticated roles, study state,
authorization, and server-controlled key management.

## 8. Timestamp interpretation

Each successful unblinding receives a fresh UUID and browser-generated canonical
ISO-8601 timestamp.

The timestamp is not independently trusted and should not be described as
cryptographic proof of when real-world unblinding occurred.

## 9. Research-integrity interpretation

The unblinding receipt documents an internally consistent artifact chain processed
through blindstats and the mapping released in that operation.

blindstats does not certify that:

- nobody accessed the mapping before the documented operation;
- the owner withheld the secret until the analysis was locked;
- the locked artifact was the only analysis conducted;
- the analyst used only the documented blinded data; or
- the researcher followed every intended procedural rule outside the software.

The value of v0 is that the intended blind-lock-unblind sequence is easy to
conduct, inspect, and document.

Later technical controls can raise assurance without pretending that software can
eliminate the human component of research integrity.

## 10. Security and privacy

The v0 unblinding operation is browser-local.

The unblinding receipt contains the released mapping and should be treated as
unblinded material.

The current prototype does not provide server-enforced roles, controlled key
release, research-file storage, retention policy, or the other operational
controls required for sensitive or regulated research infrastructure.

## 11. Current completion state

As of 2026-09-08, Documented Unblinding v0 is implemented in both the core
TypeScript workflow and browser UI.

Manual acceptance has confirmed:

- successful end-to-end encrypted mapping release;
- consistent transformation and lock identifiers across the workflow;
- no plaintext mapping in the public receipt;
- no plaintext mapping in the unblinding-secret artifact;
- plaintext mapping in the final unblinding receipt; and
- authenticated-decryption failure when the unblinding secret is altered.

The automated suite, lint, TypeScript validation, and production build are also
clean.
