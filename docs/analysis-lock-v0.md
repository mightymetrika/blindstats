# Analysis Lock v0

- **Project:** blindstats
- **Status:** implemented browser-local artifact operation with persistent registration; pre-release
- **Artifact schema:** `0.3`
- **Updated:** 2026-10-05

## 1. Purpose

Analysis Lock v0 identifies the exact analysis artifact that a researcher declares
as the pre-unblinding analysis version.

The local operation records exact artifact identity and links it to the exact
public blinding receipt.

The current server-backed workflow additionally registers that receipt and safe
lock metadata as a durable Study record.

An AnalysisLock is an **event/artifact**, not a universal workflow state.

Multiple AnalysisLocks may be registered for one blinded workflow.

A Blinding plan may also explicitly permit unblinding without an AnalysisLock.
The current application recommends requiring one, but the lock is not a hard
system invariant for every Study.

## 2. Current governed workflow

When an AnalysisLock is used in the persistent workflow:

1. the workflow is already `blinded`;
2. the exact public blinding receipt is already registered;
3. the blinded analyst selects one local analysis artifact;
4. the browser hashes the exact analysis-artifact bytes;
5. the browser creates an analysis-lock receipt linked to the exact public
   receipt;
6. the analyst can download the receipt;
7. blindstats registers the exact lock receipt and safe lock metadata; and
8. the lock becomes available for a later governed unblinding request.

The substantive analysis artifact itself is not uploaded.

In the persistent UI, the analyst does not need to re-upload the public receipt:
the exact registered receipt is supplied from the workflow.

Standalone Analysis Lock mode remains file-mediated and accepts the public receipt
directly.

## 3. Why the blinded dataset is not an input

The analyst may legitimately sort, filter, merge, derive variables, convert file
formats, or otherwise create analytic datasets while remaining blinded.

Requiring a byte-identical blinded CSV at lock time would therefore be brittle and
would not establish that those exact bytes were the data actually analyzed.

Instead:

- the registered public receipt already identifies the blinded CSV generated at
  the blinding stage by SHA-256; and
- the analysis-lock receipt carries that blinded-artifact identity forward.

The lock's strongest direct claims are about:

- the exact public receipt;
- the exact local analysis artifact supplied to the lock operation; and
- the persistent registration of those identities.

## 4. What "lock" means

The browser-local lock operation records:

- SHA-256 of the exact public-receipt bytes;
- SHA-256 and byte length of one exact analysis artifact;
- the public receipt's transformation ID;
- the public receipt's blinded-artifact SHA-256; and
- a fresh lock UUID.

If the analysis artifact changes by even one byte, it no longer has the SHA-256
recorded in that AnalysisLock.

The lock does **not**:

- make the researcher's local file immutable;
- prevent later revisions;
- prove that the locked artifact was the only analysis performed;
- prove that a particular dataset was actually used outside blindstats; or
- make the browser-generated `createdAt` timestamp independently trusted.

A later revision is simply a different artifact with a different hash.

A researcher may register another AnalysisLock for that later artifact while the
workflow remains eligible to do so.

## 5. Inputs

### 5.1 Persistent workflow

The persistent AnalysisLock path uses:

- the exact registered public blinding receipt; and
- one nonempty local analysis artifact.

The caller must have the governed ability to register an AnalysisLock for the
Study/workflow.

### 5.2 Standalone mode

Standalone Analysis Lock mode accepts:

- the exact schema-`0.3` public blinding receipt; and
- one nonempty local analysis artifact.

### 5.3 Analysis artifact

Examples include:

- manuscript or report;
- R or Python script;
- Quarto or R Markdown source;
- notebook; or
- ZIP archive containing related analysis files.

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

This is SHA-256 of the exact public-receipt bytes used by the lock operation.

Reformatting otherwise equivalent JSON creates a different exact receipt identity.

### 6.2 `blindedArtifactSha256`

This is the blinded-artifact hash already recorded in the validated public
blinding receipt.

The lock operation does not recompute it from a newly supplied dataset.

### 6.3 Analysis-artifact identity

The lock records:

- filename;
- SHA-256; and
- byte length.

The SHA-256 is the primary exact-content identity.

The byte length is additional descriptive/integrity metadata.

## 7. Persistent registration

The persistent AnalysisLock record stores:

- Study and workflow identity;
- linked transformation record;
- active immutable plan version;
- lock ID;
- schema version;
- browser-generated receipt timestamp;
- public-receipt SHA-256;
- blinded-artifact SHA-256;
- analysis filename;
- analysis-artifact SHA-256;
- analysis-artifact byte length;
- exact analysis-lock receipt SHA-256;
- exact analysis-lock receipt text;
- registering user; and
- database registration timestamp.

The server computes the SHA-256 of the exact UTF-8 lock receipt text.

The analysis artifact contents are not stored.

Registration validates that the lock belongs to the already registered
transformation and plan.

Exact repeated registration of the same lock identity/content is handled
idempotently; conflicting reuse of a lock identifier is rejected.

## 8. Plan interaction

The active immutable Blinding plan controls whether a lock is required before the
ordinary unblinding request can proceed.

### 8.1 Lock required

If `require_analysis_lock = true`:

- the request must select a valid registered AnalysisLock;
- authorization validates that lock against the governed transformation; and
- persistent completion remains linked to that same lock.

### 8.2 Lock not required

If `require_analysis_lock = false`:

- an AnalysisLock may still be created and selected;
- a request may instead explicitly proceed with no AnalysisLock; and
- the persistent completion path can complete with no fabricated lock metadata.

This weaker Plan setting requires acknowledgment at Plan activation.

## 9. Validation behavior

The local lock operation fails closed if, for example:

- the public receipt is empty, malformed, or unsupported;
- the public receipt has unexpected structure;
- the analysis filename is blank;
- the analysis artifact is empty;
- SHA-256 hashing is unavailable; or
- secure UUID generation is unavailable.

Persistent registration additionally requires valid workflow state, capability,
transformation, Plan, and receipt relationships.

The application does not silently repair or reinterpret supplied artifacts.

## 10. Timestamp interpretation

`createdAt` in the AnalysisLock receipt is browser-generated canonical ISO-8601.

It is not independently trusted and should not be described as cryptographic
proof that the lock occurred at a particular real-world time.

The persistent registration additionally receives a database-generated
`registered_at` timestamp.

That supports the narrower claim:

> blindstats registered this exact AnalysisLock identity at this server-recorded
> time.

## 11. Research-integrity interpretation

An AnalysisLock provides a concrete artifact-level statement:

> this exact analysis artifact was declared locked under this exact public
> blinding receipt.

Persistent registration adds authenticated Study/workflow context and trusted
registration time.

That evidence does not certify researcher honesty or prove that:

- protected information was never viewed outside the workflow;
- the locked artifact was the only analysis performed;
- the analysis artifact was scientifically complete;
- later work did not occur; or
- the external blinded dataset was the only data used.

The purpose is to preserve a clear historical identity and governance record.

## 12. Security and privacy

Analysis-file contents remain browser-local.

The persistent record contains hashes, filenames, byte length, linked artifact
identities, exact lock receipt text, actor identity, and registration time.

The current product is not a general research-file storage or transfer system.

It is being prepared as a researcher-feedback / research-preview release rather
than production-hardened sensitive or regulated research infrastructure.

## 13. Current completion state

As of 2026-10-05, Analysis Lock v0 is integrated with the persistent Study
workflow.

Current implementation behavior includes:

- exact registered public receipt supplied automatically in persistent mode;
- multiple durable AnalysisLocks per blinded workflow;
- safe metadata registration without uploading the analysis artifact;
- Plan-governed required/optional lock behavior;
- request binding to a selected lock when one is used; and
- Audit history for registered lock identities.

Repository validation at this checkpoint is:

```text
Test files: 20 passed
Tests:      117 passed
Lint:       clean
Build:      clean
```
