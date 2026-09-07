# Analysis Lock v0

**Status:** Core contract for first-release workflow  
**Project:** blindstats  
**Date:** 2026-09-07

## 1. Purpose

The analysis-lock step extends the browser-local blinding prototype into a
file-mediated blinded-analysis workflow.

The first-release workflow is:

> **Blind → analyze while blinded → lock an exact analysis artifact → unblind → document**

The lock step does not inspect, execute, or interpret the analysis file. It
identifies the exact bytes that the researcher declares to be the
pre-unblinding analysis artifact and links those bytes to the exact blinded
dataset and public blinding receipt used in the workflow.

This allows a draft manuscript, report, script, notebook, archive, or other
research artifact to be documented without requiring blindstats to understand
the file format.

## 2. Human workflow

A minimal file-mediated workflow is:

1. The study owner creates the blinded package.
2. The owner retains the private blinding key.
3. The owner gives the analyst:
   - the blinded CSV; and
   - the public blinding receipt.
4. The analyst works outside blindstats while blinded.
5. When the analyst is ready to finalize the pre-unblinding version, the
   analyst provides blindstats with:
   - the exact public blinding receipt;
   - the exact blinded CSV; and
   - one analysis artifact to lock.
6. blindstats verifies that the blinded CSV matches the public receipt.
7. blindstats hashes the exact bytes of all files needed to establish the lock
   relationship.
8. blindstats creates an analysis-lock receipt.
9. A later unblinding step will require a valid lock receipt before producing
   the unblinding release and unblinding receipt.

No account, database, or server-side file storage is required for this v0
workflow.

## 3. What "lock" means in v0

In v0, locking means:

- an exact analysis-file byte sequence is identified by SHA-256;
- that hash is linked to a verified blinded artifact;
- the blinded artifact is linked to the public blinding receipt that created
  it; and
- the lock receives its own identifier.

If the analysis file changes by even one byte, it no longer matches the
analysis artifact recorded in the lock receipt.

The lock does not make a local file immutable. The researcher may create a
later revision, but that revision is a different artifact and will have a
different hash.

## 4. Analysis artifact scope

v0 locks exactly one analysis artifact per lock receipt.

The artifact may be any nonempty file. blindstats does not infer file type from
the extension and does not execute or parse the file contents.

Examples include:

- DOCX manuscript draft;
- PDF report;
- R script;
- Python script;
- Quarto or R Markdown source;
- notebook; or
- ZIP archive containing multiple related analysis files.

Researchers who need to lock several files together can place them in an
archive and lock the archive as one exact artifact. Multi-artifact manifests
can be considered later if needed.

## 5. Required inputs

The lock operation requires:

### 5.1 Public blinding receipt

The exact receipt bytes generated during the blinding step.

The receipt must:

- be valid UTF-8 JSON;
- use the supported `0.1` schema;
- have the expected categorical-label-permutation structure;
- contain valid SHA-256 digests;
- contain a canonical ISO-8601 creation timestamp;
- contain at least two categories; and
- contain no unexpected top-level fields.

Strict structure validation helps fail closed if the wrong file is supplied or
if a private mapping is accidentally included in a purported public receipt.

### 5.2 Blinded artifact

The exact blinded CSV supplied to the analyst.

blindstats computes its SHA-256 hash and requires that it match
`blindedArtifact.sha256` in the public blinding receipt.

The lock operation fails if the hashes do not match.

### 5.3 Analysis artifact

One nonempty file representing the version of the analysis that is being
declared locked.

The filename must not be blank.

The analysis file itself is not copied into the lock receipt. Only identifying
metadata and its SHA-256 digest are recorded.

## 6. Analysis-lock receipt

The v0 receipt has this conceptual shape:

```json
{
  "schemaVersion": "0.1",
  "receiptType": "analysis_lock",
  "lockId": "uuid",
  "createdAt": "ISO-8601 timestamp",
  "blinding": {
    "transformationId": "uuid",
    "blindingReceiptSha256": "...",
    "blindedArtifactSha256": "..."
  },
  "analysisArtifact": {
    "filename": "blinded-analysis-draft.docx",
    "sha256": "...",
    "byteLength": 12345
  }
}
```

### 6.1 `lockId`

A fresh Web-Crypto UUID for the lock operation.

### 6.2 `blindingReceiptSha256`

SHA-256 of the exact public blinding-receipt bytes supplied to the lock step.

This links the lock to a particular public receipt artifact, not merely to a
reconstructed set of receipt fields.

### 6.3 `blindedArtifactSha256`

SHA-256 of the exact blinded-dataset bytes supplied to the lock step.

This value must match the blinded-artifact hash already recorded in the public
blinding receipt.

### 6.4 `analysisArtifact.sha256`

SHA-256 of the exact bytes of the analysis artifact being locked.

### 6.5 `analysisArtifact.byteLength`

The number of bytes in the exact analysis artifact.

This is descriptive metadata and does not replace the SHA-256 digest.

## 7. Validation rules

The core lock operation must fail if:

- the public blinding receipt is empty;
- the public blinding receipt is not valid UTF-8 JSON;
- the public blinding receipt does not match the supported v0 schema;
- the public receipt has unexpected fields;
- the blinded artifact is empty;
- the blinded artifact hash does not match the public receipt;
- the analysis filename is blank;
- the analysis artifact is empty;
- SHA-256 hashing is unavailable; or
- secure UUID generation is unavailable.

The operation must not silently repair or reinterpret supplied artifacts.

## 8. Timestamp interpretation

`createdAt` is a browser-generated local workflow timestamp encoded as a
canonical ISO-8601 value.

In the browser-local v0 workflow it is not an independently trusted timestamp
and should not be described as cryptographic proof of when the lock occurred.

The lock receipt documents the version the researcher declared locked when
using the workflow. Stronger timestamp attestation can be considered in later
server-backed versions if it becomes necessary.

The v0 implementation should not reject a lock merely because its local
timestamp appears earlier than the blinding-receipt timestamp. File-mediated
workflows may occur on different computers with clock skew, and comparing
untrusted local clocks would create brittleness without providing meaningful
assurance.

## 9. Research-integrity interpretation

blindstats does not certify researcher honesty or prove that nobody viewed or
retained information outside the workflow.

Instead, the analysis-lock receipt makes the intended workflow easier to
conduct and provides concrete, verifiable links among the artifacts that were
processed through blindstats.

Later releases may add authentication, permissions, persistent study states,
server-side audit events, or stronger role separation. Those features can
increase assurance, but they do not eliminate the human component of research
integrity.

## 10. Security and privacy

The v0 lock operation remains browser-local.

The analysis artifact, blinded dataset, and public receipt should not be
transmitted to a blindstats server by this workflow.

The analysis-lock receipt contains hashes and basic identifying metadata, not
the contents of the analysis file.

## 11. Next implementation step

After the core analysis-lock contract is implemented and tested, the next
slice should add a small browser UI that:

1. accepts the public blinding receipt;
2. accepts the blinded CSV;
3. accepts one analysis artifact;
4. verifies the artifact chain;
5. creates the lock receipt; and
6. downloads the analysis-lock receipt.

The following slice should then implement documented unblinding that verifies
the private key and analysis-lock receipt before releasing the mapping or
unblinded artifact.
