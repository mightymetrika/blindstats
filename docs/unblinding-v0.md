# Documented Unblinding v0

**Status:** Core contract for first-release workflow
**Project:** blindstats
**Date:** 2026-09-07

## 1. Purpose

Documented Unblinding v0 completes the browser-local scientific workflow:

> **Blind → analyze while blinded → lock an exact analysis artifact → unblind → document**

The unblinding step verifies that the supplied artifacts form one internally
consistent workflow before the protected mapping and unblinded data are released.

The v0 implementation remains file-mediated and browser-local. It does not
require accounts, a database, cloud storage, or server-side authorization.

## 2. Required inputs

The unblinding operation requires five exact artifacts:

1. the original source CSV;
2. the public blinding receipt;
3. the private blinding key;
4. the analysis-lock receipt; and
5. the exact locked analysis artifact.

The blinded CSV does not need to be supplied again. blindstats regenerates the
blinded artifact from the original source plus private key and verifies that the
regenerated SHA-256 matches the hashes already recorded in the workflow.

## 3. Why the original source is required

The public blinding receipt intentionally does not reveal the private mapping.

The current v0 receipt also does not contain a public cryptographic commitment to
the mapping. A naive public hash of a small mapping could itself weaken blinding:
for a binary treatment/control variable, for example, an analyst who knows the
possible original labels could test the small number of possible mappings.

For the first release, the simpler verification anchor is the original source
artifact.

At unblinding, blindstats:

1. verifies the exact source SHA-256;
2. parses the source;
3. reapplies the private mapping to the source;
4. serializes the blinded derivative using the same deterministic CSV path used
   during initial blinding; and
5. requires the regenerated blinded SHA-256 to match the public receipt, private
   key, and analysis-lock receipt.

This verifies that the private key's mapping is consistent with both the original
source and the blinded artifact that was used in the locked analysis.

## 4. Artifact-chain validation

Before releasing anything, v0 must verify the following relationships.

### 4.1 Public receipt and private key

The private key must match the public receipt on:

- schema version;
- transformation identifier;
- transformation type;
- creation time;
- selected column;
- source-artifact SHA-256;
- blinded-artifact SHA-256; and
- category/mapping count.

The private key mapping must be bijective and must use the expected
`Group_<letters>` neutral-label set.

### 4.2 Source artifact

The exact source bytes must hash to the source SHA-256 recorded in both the public
receipt and private key.

The parsed source must also match the row count, column count, selected column,
and distinct nonmissing category count recorded by the blinding workflow.

The set of original mapping categories must match the source categories.

### 4.3 Regenerated blinded artifact

blindstats reapplies the private key mapping to the source dataset and serializes
the result through the canonical blinded-CSV serialization path.

The regenerated blinded SHA-256 must match:

- the public blinding receipt;
- the private blinding key; and
- the analysis-lock receipt.

This is the primary v0 check that the supplied private mapping is the mapping
consistent with the documented source and blinded artifact.

### 4.4 Analysis lock

The analysis-lock receipt must refer to the same transformation and blinded
artifact as the public receipt.

The SHA-256 of the exact public blinding-receipt bytes supplied at unblinding must
match the `blindingReceiptSha256` stored in the analysis-lock receipt.

### 4.5 Locked analysis artifact

The exact locked analysis bytes must match both:

- the SHA-256; and
- the byte length

recorded in the analysis-lock receipt.

The local filename does not need to remain unchanged. The hash identifies the
content; renaming the same exact file should not prevent unblinding.

## 5. Outputs

v0 produces two downloadable outputs.

### 5.1 Unblinded CSV

The unblinded data output is the exact original source artifact supplied and
verified during unblinding.

This is stronger than reconstructing an approximation from the blinded CSV:
quoting, line endings, and other byte-level details of the original source are
preserved.

Therefore, in v0:

```text
unblindedArtifactSha256 == sourceArtifactSha256
```

The application should make clear that this is the verified original unblinded
source being released after the lock step.

### 5.2 Unblinding receipt

The unblinding receipt documents the final artifact chain and the mapping that
was released.

Conceptually:

```json
{
  "schemaVersion": "0.1",
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
    "blindingKeySha256": "...",
    "analysisLockReceiptSha256": "...",
    "analysisArtifact": {
      "filename": "analysis.docx",
      "sha256": "...",
      "byteLength": 12345
    },
    "unblindedArtifactSha256": "..."
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

The unblinding receipt is a post-unblinding artifact. Unlike the public blinding
receipt and analysis-lock receipt, it intentionally records the mapping that was
released.

## 6. Exact-byte relationships

The receipt records SHA-256 values for:

- original source artifact;
- exact public blinding-receipt bytes supplied at unblinding;
- regenerated blinded artifact;
- exact private blinding-key bytes supplied at unblinding;
- exact analysis-lock-receipt bytes supplied at unblinding;
- exact locked analysis-artifact bytes; and
- exact unblinded output bytes.

The private key hash is recorded at unblinding even though no earlier public
artifact commits to the exact key bytes. Its role is to document the exact key
artifact used in the release operation.

## 7. Validation behavior

The operation must fail closed if any required relationship does not verify.

Examples include:

- source SHA-256 mismatch;
- private-key metadata mismatch;
- malformed or unsupported private key;
- malformed or unsupported analysis-lock receipt;
- mapping categories that do not match the source;
- a mapping that does not regenerate the documented blinded artifact;
- a public receipt whose exact bytes do not match the analysis lock;
- an analysis lock from another transformation;
- a locked-analysis hash mismatch;
- a locked-analysis byte-length mismatch;
- missing selected column;
- incompatible source dimensions; or
- unavailable Web Crypto hashing or UUID generation.

The operation must not silently repair, reinterpret, or substitute artifacts.

## 8. Unblinding identity and timestamp

Each successful unblinding receives a fresh Web-Crypto UUID.

`createdAt` is a browser-generated canonical ISO-8601 timestamp. As with the
analysis-lock timestamp, it is not independently trusted in the browser-local
workflow and must not be described as cryptographic proof of chronology.

v0 should not reject an otherwise valid workflow merely because local timestamps
appear out of order. Stronger server-backed timestamp and state-transition
assurance can be added later.

## 9. Research-integrity interpretation

The user explicitly initiates v0 unblinding by supplying the private key and
required workflow artifacts.

This documents the artifacts processed through blindstats and makes the
blind-lock-unblind sequence easier to perform and verify. It does not certify
researcher honesty or prove that information was never viewed outside the
workflow.

Later authentication, permissions, durable study states, server-side audit
events, and controlled mapping release can increase assurance without eliminating
the human component of research integrity.

## 10. Security and privacy

The v0 unblinding operation remains browser-local.

The source dataset, private key, analysis artifact, and generated unblinded data
should not be transmitted to a blindstats server by this workflow.

The unblinding receipt contains the released mapping and therefore should be
treated as an unblinded/post-unblinding artifact.

## 11. Next implementation step

After the documented-unblinding core passes its automated tests, the next slice
should add a browser-local Unblinding Workspace that:

1. accepts the source CSV;
2. accepts the public blinding receipt;
3. accepts the private blinding key;
4. accepts the analysis-lock receipt;
5. accepts the exact locked analysis artifact;
6. verifies the complete artifact chain;
7. releases the verified original source CSV; and
8. downloads the unblinding receipt.

The workflow selector can then expose three stages:

```text
Create blinded package → Lock blinded analysis → Unblind
```
