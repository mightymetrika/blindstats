# Documented Unblinding v0

- **Project:** blindstats
- **Status:** implemented browser-local release with persistent authorization and completion registration; pre-release
- **Artifact schema:** `0.3`
- **Updated:** 2026-10-05

## 1. Purpose

Documented Unblinding v0 performs the local release stage of the blindstats
artifact protocol.

In the current persistent workflow, unblinding is governed by a deliberate
separation:

> **Request ≠ authorization ≠ exposure**

A request records intent to unblind.

Authorization records that the governed release is permitted.

Only after authorization does the user locally supply the unblinding secret and
release the protected mapping.

The browser creates the final unblinding receipt.

blindstats then persists safe completion metadata and moves the workflow to
`unblinded`.

## 2. Two operating modes

### 2.1 Persistent governed mode

In the current Study workflow, the unblinding operation receives from persistent
state:

- the exact registered public blinding receipt;
- the authorized request;
- the exact request-selected AnalysisLock receipt when a lock was used; and
- the active governed artifact relationships.

The user supplies locally:

- the unblinding secret.

The plaintext secret and released mapping stay in the browser.

### 2.2 Standalone file-mediated mode

Standalone Documented Unblinding preserves the original schema-`0.3` file
protocol.

It requires exactly three JSON artifacts:

1. the exact public blinding receipt;
2. the unblinding secret; and
3. the analysis-lock receipt.

The standalone mode does not infer a governed Plan or authorization record from
persistent application state.

## 3. Authorization before local release

In the persistent workflow, mapping release is available only after a durable
unblinding authorization exists and the workflow is
`unblinding_authorized`.

Authorization is governed by the active immutable Blinding plan.

Current policies are:

- `independent`; or
- `self_authorization`.

Under independent authorization, the requester and authorizer must be different
authenticated Study members with the relevant capabilities.

Under self-authorization, the same actor may request and authorize only when the
Plan permits it and the user has the necessary capabilities.

A successful authorization does not decrypt or expose the mapping.

The unblinding secret remains outside server custody and is transferred to the
recipient outside blindstats in the current first-release workflow.

## 4. Artifact-chain validation

Before releasing the mapping, the browser validates the relevant schema-`0.3`
artifact relationships.

### 4.1 Public receipt

The public receipt must contain valid supported transformation metadata,
source/blinded hashes, sealed-mapping parameters, and algorithm metadata.

In persistent mode, blindstats supplies the exact public receipt already
registered for the governed transformation.

### 4.2 Unblinding secret

The unblinding secret must:

- use schema `0.3`;
- identify itself as `unblinding_secret`;
- use AES-GCM with a 256-bit key;
- contain valid key material; and
- carry the same transformation ID as the public receipt.

The secret is supplied locally by the user.

### 4.3 AnalysisLock when present

When the authorized request is bound to an AnalysisLock, the exact registered
lock receipt must:

- refer to the same transformation ID as the public receipt;
- carry the same blinded-artifact SHA-256;
- contain the SHA-256 of the exact public-receipt bytes used at lock time; and
- identify the analysis artifact that was locked.

The browser hashes the exact public receipt again and verifies the relationship.

### 4.4 No-lock governed path

When the active immutable Plan explicitly permits
`require_analysis_lock = false`, a request may intentionally be authorized with no
AnalysisLock.

In that governed path:

- no lock receipt is supplied to the local unblinding operation;
- no lock relationship is invented;
- the final receipt records `lockId: null`;
- `analysisLockReceiptSha256` is `null`; and
- `analysisArtifact` is `null`.

The public receipt, local secret, transformation, authorization, and other
governed identities are still verified.

### 4.5 Authenticated mapping decryption

blindstats decrypts the public receipt's sealed mapping using AES-GCM and the
local unblinding secret.

Authenticated decryption uses the transformation metadata that were bound as
additional authenticated data during initial blinding.

The operation fails if the key, ciphertext, IV, authentication tag, or bound
metadata is inconsistent.

After decryption, blindstats validates the mapping payload, including its internal
structure, uniqueness relationships, label scheme, and category count.

## 5. Why substantive artifacts are not supplied again

The source dataset and blinded dataset were already identified by SHA-256 in the
public receipt.

When an AnalysisLock was used, the analysis artifact was already identified by
filename, SHA-256, and byte length in the AnalysisLock receipt.

The unblinding operation therefore does not need to re-upload or rehash the source
dataset, blinded dataset, or locked analysis artifact.

A future utility could verify a candidate local file against one of those recorded
identities, but that is separate from mapping release.

## 6. Output: unblinding receipt

The browser creates one downloadable post-unblinding receipt.

A lock-bound example is conceptually:

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

When no AnalysisLock was used under a Plan that permits that path:

```json
{
  "lockId": null,
  "artifacts": {
    "analysisLockReceiptSha256": null,
    "analysisArtifact": null
  }
}
```

The full receipt still contains the other governed artifact identities and the
released mapping.

The unblinding receipt is protected post-unblinding material and should be handled
accordingly.

blindstats does not persist the readable receipt text.

## 7. Exact-byte relationships

The final receipt records SHA-256 identities for:

- the source artifact originally identified by the public receipt;
- the exact public receipt used for unblinding;
- the blinded artifact originally identified by the public receipt;
- the exact local unblinding-secret bytes; and
- when a lock is used, the exact AnalysisLock receipt and the previously locked
  analysis artifact identity.

The source/blinded/analysis substantive files are not re-uploaded at unblinding.

## 8. Persistent completion registration

After successful local release, the user can save the final receipt and confirm
custody before registering completion.

The server stores safe completion metadata rather than the secret, mapping, or
readable final receipt.

Persistent completion is linked to:

- Study;
- workflow;
- active immutable Plan;
- request;
- authorization;
- transformation;
- AnalysisLock when one was used;
- source/blinded artifact identities;
- secret SHA-256; and
- final receipt SHA-256.

When the request used no AnalysisLock, the lock-specific completion metadata
remain NULL as a consistent group.

The server verifies the nonsecret relationships it can independently verify and
atomically moves:

```text
unblinding_authorized -> unblinded
```

The server does **not** independently repeat the private browser decryption because
it does not possess the plaintext secret.

The appropriate claim is therefore that blindstats recorded completion of the
authorized local workflow and linked it to the governed artifact chain.

It should not claim that the server independently proved private decryption.

## 9. Secret-release interpretation

The current server-backed workflow enforces request and authorization as durable
application events.

It does **not** take custody of the plaintext unblinding secret.

In the usual separated workflow:

1. the custodian retains the secret;
2. the blinded analyst performs the analysis;
3. an unblinding request is made;
4. the request is authorized according to the active Plan;
5. the custodian transfers the saved secret outside blindstats; and
6. the authorized recipient selects the secret locally and releases the mapping.

Possession of both the public receipt and secret is cryptographically sufficient
to decrypt the mapping with compatible software.

Therefore blindstats cannot prove that nobody copied or used the secret outside
the governed application workflow.

The persistent governance records improve auditability without changing that
fundamental external-custody fact.

## 10. Timestamp interpretation

The final receipt's `createdAt` is browser-generated and is not independently
trusted chronology.

Persistent workflow records provide database-generated timestamps for:

- request;
- authorization; and
- completion registration.

These support narrower server-recorded chronology claims.

They do not prove that protected information was never exposed through another
route before those events.

## 11. Research-integrity interpretation

The persistent unblinding workflow documents:

- a governed request;
- a governed authorization;
- local artifact-chain verification/decryption;
- a final receipt identity;
- a durable completion record; and
- the transition to `unblinded`.

It does not certify that:

- nobody accessed the mapping before documented completion;
- the custodian always stored or transferred the secret securely;
- the locked artifact, when one exists, was the only analysis conducted;
- the analyst used only the documented blinded data; or
- every relevant procedural rule outside blindstats was followed.

The value is a clear, inspectable, durable chain of artifact identities and
governance events.

## 12. Security and privacy

The actual secret and plaintext mapping are processed locally.

The final unblinding receipt contains the released mapping and is not uploaded by
the persistent workflow.

The server stores hashes and safe metadata sufficient to connect completion to the
governed workflow.

The current research-preview application does not provide:

- in-app transfer of the plaintext secret;
- general protected-file storage;
- comprehensive retention/deletion policy;
- formal incident-response operations; or
- a claim of suitability for sensitive or regulated production research.

## 13. Current completion state

As of 2026-10-05, Documented Unblinding v0 is integrated with persistent
request/authorization/completion governance.

Manual acceptance has confirmed both:

- the normal lock-bound governed workflow; and
- the Plan-permitted no-AnalysisLock path through request, authorization, local
  release, completion registration, `unblinded`, and Audit history.

The latest no-lock acceptance confirmed that Audit history records:

- no AnalysisLock selected for the request;
- the authorization policy and actor;
- completion actor/time;
- unblinding receipt SHA-256; and
- secret SHA-256

without inventing lock metadata that did not exist.

Repository validation at this checkpoint is:

```text
Test files: 20 passed
Tests:      117 passed
Lint:       clean
Build:      clean
```
