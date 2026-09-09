# Analysis Lock v0

**Status:** Implemented browser-local prototype
**Project:** blindstats
**Artifact schema:** `0.3`
**Updated:** 2026-09-08

## 1. Purpose

The analysis-lock stage identifies the exact analysis artifact that the researcher
declares finalized before unblinding.

The complete browser-local workflow is:

> **Blind → analyze while blinded → lock an exact analysis artifact → unblind → document**

The lock does not execute, interpret, or judge the analysis. It records exact
artifact identity and links that artifact to the exact public blinding receipt
under which it was locked.

## 2. Human workflow

The intended file-mediated workflow is:

1. A study owner creates the blinded package.
2. The owner retains the unblinding secret.
3. The analyst receives:
   - the blinded CSV; and
   - the public blinding receipt.
4. The analyst conducts the analysis while blinded.
5. When ready to lock the pre-unblinding version, the analyst supplies blindstats
   with:
   - the exact public blinding receipt; and
   - one analysis artifact.
6. blindstats creates an analysis-lock receipt.
7. The owner may then release the unblinding secret.
8. The analyst can use the public receipt, released secret, and analysis-lock
   receipt to complete documented unblinding.

No account, database, or server-side file storage is required for this v0
workflow.

## 3. Why the blinded dataset is not an input

The analyst may legitimately sort, filter, merge, derive variables, convert file
formats, or otherwise create analytic datasets while remaining blinded.

Requiring a byte-identical blinded CSV at lock time would therefore be brittle and
would not establish that those exact bytes were the data actually analyzed.

Instead:

- the public receipt already identifies the blinded CSV generated during the
  blinding stage by SHA-256; and
- the analysis-lock receipt carries that blinded-artifact identity forward from
  the validated public receipt.

The lock's strongest direct claims are about the exact public receipt and exact
analysis artifact supplied to blindstats.

## 4. What "lock" means in v0

In the current browser-local workflow, locking means:

- the exact public blinding-receipt bytes are identified by SHA-256;
- one exact analysis artifact is identified by SHA-256 and byte length;
- the public receipt's transformation ID and blinded-artifact SHA-256 are carried
  into the lock receipt; and
- the lock receives its own UUID.

If the analysis artifact changes by even one byte, it no longer has the SHA-256
recorded in that lock receipt.

The lock does **not**:

- make the researcher's local file immutable;
- prevent later revisions;
- prove that the locked artifact was the only analysis performed;
- prove that a particular dataset was actually used outside blindstats; or
- provide a trusted timestamp.

A later revision is simply a different artifact with a different hash.

## 5. Required inputs

### 5.1 Public blinding receipt

The exact schema-`0.3` receipt bytes generated during blinding.

The parser validates the expected receipt structure, transformation metadata,
artifact hashes, sealed-mapping parameters, and algorithm metadata.

### 5.2 Analysis artifact

One nonempty file representing the analysis version being declared locked.

Examples include:

- manuscript or report;
- R or Python script;
- Quarto or R Markdown source;
- notebook; or
- ZIP archive containing a set of related analysis files.

The filename must not be blank.

blindstats hashes the file bytes; it does not execute or interpret the contents.

## 6. Analysis-lock receipt

Conceptually:

```json
{
  "schemaVersion": "0.3",
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

### 6.1 `blindingReceiptSha256`

SHA-256 of the exact public-receipt bytes supplied to the lock operation.

This means reformatting otherwise equivalent JSON creates a different receipt
artifact and therefore a different exact-byte identity.

### 6.2 `blindedArtifactSha256`

The blinded-artifact hash already recorded in the validated public blinding
receipt.

The lock operation does not recompute this value from a newly supplied dataset.

### 6.3 Analysis-artifact identity

The lock records:

- filename;
- SHA-256; and
- byte length.

The SHA-256 is the primary exact-content identity. The byte length is additional
descriptive/integrity metadata.

## 7. Validation behavior

The lock operation fails closed if, for example:

- the public receipt is empty, malformed, or unsupported;
- the public receipt has unexpected structure;
- the analysis filename is blank;
- the analysis artifact is empty;
- SHA-256 hashing is unavailable; or
- secure UUID generation is unavailable.

The operation does not silently repair or reinterpret supplied artifacts.

## 8. Timestamp interpretation

`createdAt` is a browser-generated canonical ISO-8601 timestamp.

It is not independently trusted and should not be described as cryptographic
proof that the lock occurred at a particular real-world time.

The v0 implementation does not reject otherwise valid workflows merely because
local timestamps appear out of chronological order. Different computers may have
clock skew, and comparing untrusted local clocks would add brittleness without
meaningful assurance.

## 9. Research-integrity interpretation

The analysis-lock receipt provides a concrete artifact-level record:

> this exact analysis artifact was declared locked under this exact public
> blinding receipt.

That record supports an auditable workflow. It does not certify researcher
honesty or prove that information was never viewed outside the workflow.

Later server-backed versions can increase assurance through:

- authenticated users;
- server-enforced roles and permissions;
- persistent study states;
- controlled secret release;
- durable server-side audit events;
- trusted server timestamps; and
- controlled or immutable artifact storage.

Those controls strengthen the workflow without eliminating the human component of
research integrity.

## 10. Security and privacy

The current lock operation is browser-local.

The analysis artifact and public receipt are processed locally by this workflow.
The generated lock receipt contains hashes and basic identifying metadata, not the
analysis-file contents.

The current prototype is not a secure research-file storage or transfer service
and should not be treated as appropriate infrastructure for sensitive or
regulated data.

## 11. Current completion state

As of 2026-09-08, Analysis Lock v0 is implemented in both the core TypeScript
workflow and the browser UI and has passed automated tests, lint, production
TypeScript/build validation, and manual browser acceptance.
