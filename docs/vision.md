# blindstats Product and Technical Vision

- **Project:** blindstats
- **Status:** current pre-release product/technical direction
- **Updated:** 2026-10-05

## 1. Purpose

blindstats is open-source research software for auditable analyst blinding.

Its immediate purpose is to help research teams separate statistical analysis
decisions from knowledge of substantively meaningful study labels while creating
a durable, inspectable record of the workflow.

The current scientific sequence is:

> **Plan → blind → analyze while blinded → lock when required or desired →
> request → authorize → unblind → document**

The first public milestone is a researcher-feedback / research-preview release.

Broader research-management functionality should be added only after this core
workflow is useful, understandable, and reliable in real research practice.

## 2. The problem

Applied statistical analysis frequently involves legitimate choices, including:

- model specification;
- transformations;
- handling of unusual observations;
- sensitivity analyses;
- subgroup analyses;
- variable selection;
- table and figure construction; and
- decisions about which findings to emphasize.

When analysts know the substantive identities of treatment groups, comparison
groups, hypotheses, outcomes, or other important study labels, those choices can
be influenced by whether they produce favorable or unfavorable findings.

Analyst blinding cannot remove all researcher judgment and is not a substitute
for appropriate study design, preregistration when relevant, transparent
reporting, replication, or other research-integrity practices.

It can help separate some analysis decisions from knowledge of their substantive
consequences.

## 3. Product thesis

A useful analyst-blinding system needs more than renamed labels.

It should help research teams answer questions such as:

- What information was intended to be protected?
- How was it blinded?
- Which artifact represented the blinded data?
- Was an AnalysisLock required?
- If a lock was used, which exact analysis artifact was declared before
  unblinding?
- Who requested unblinding?
- Who authorized it?
- Under what policy?
- When was authorized completion registered?
- What mapping was ultimately released locally?

The resulting Audit history is a core product output.

blindstats is therefore not only a transformation utility.

It combines:

- browser-local artifact operations;
- persistent Study/workflow state;
- exact artifact identity;
- capability-based authorization;
- explicit request/authorization separation; and
- durable audit evidence.

## 4. Current product architecture

### 4.1 Study is the durable container

A **Study** is the durable research and collaboration workspace.

A **workflow** is a specific research process operating inside a Study.

Blinding is the first implemented research-specific workflow.

Current product hierarchy:

```text
Studies
  └── Study
        └── Research workflows
              └── Blinding
```

The current application effectively supports one Blinding workflow per Study.

The longer-term direction is closer to a modular Research Management System (RMS)
than to a single-purpose file utility, but that expansion is intentionally
deferred until field feedback supports it.

### 4.2 Two-layer architecture

The current application combines two layers.

**Browser-local artifact operations**

- parse and transform source CSV;
- create the blinded dataset;
- generate/hash artifact bytes;
- encrypt/decrypt the mapping;
- create AnalysisLock receipts when used;
- create the final unblinding receipt.

**Persistent server-backed governance**

- authenticate users;
- maintain Studies and memberships;
- enforce Study-scoped capabilities;
- preserve immutable Blinding plan v1;
- maintain workflow state;
- register exact public receipts;
- register exact AnalysisLock receipts;
- record unblinding requests;
- enforce authorization policy;
- register safe completion metadata; and
- provide durable Audit history with database timestamps.

This architecture deliberately avoids requiring blindstats to take custody of
substantive research-file contents.

## 5. Current Blinding workflow

### 5.1 Plan

During `setup`, the Study defines:

- one protection target;
- optional rationale;
- whether an AnalysisLock is required; and
- whether authorization is independent or permits self-authorization.

The application recommends:

- requiring an AnalysisLock; and
- independent authorization.

Weaker settings are permitted after explicit acknowledgment.

Activation creates immutable Plan v1.

For independent authorization, activation requires a genuine two-actor
configuration.

### 5.2 Blind

A Study member with the appropriate capability selects a local UTF-8 CSV and one
categorical column.

The browser creates:

- blinded CSV;
- public blinding receipt; and
- unblinding secret.

The exact public receipt and safe metadata are registered persistently.

The source/blinded file contents, plaintext mapping, and plaintext secret are not
persisted.

Successful registration moves:

```text
setup -> blinded
```

### 5.3 Analyze while blinded

The substantive analysis is performed outside blindstats.

The blinded analyst works with the blinded dataset and their normal research
software.

### 5.4 AnalysisLock when required or desired

An AnalysisLock identifies one exact local analysis artifact by SHA-256 and byte
length under the exact public receipt.

The lock receipt can be registered persistently without uploading the substantive
analysis file.

Multiple AnalysisLocks may exist.

The Plan determines whether a lock is required before an unblinding request.

### 5.5 Request

The unblinding request is a durable event.

It is bound to:

- active Plan;
- registered transformation;
- requester; and
- selected AnalysisLock when one is supplied/required.

Request does not equal authorization.

### 5.6 Authorize

Authorization is a separate durable event.

Under independent policy, a different authenticated Study member must authorize.

Under self-authorization, the requester may authorize only when the Plan permits
it and capability requirements are satisfied.

Successful authorization moves:

```text
blinded -> unblinding_authorized
```

Authorization does not itself release the mapping.

### 5.7 Unblind locally and document

After authorization, the intended recipient obtains the saved unblinding secret
outside blindstats and selects it locally.

The browser authenticates/decrypts the sealed mapping and creates the final
unblinding receipt.

When the request used an AnalysisLock, the receipt includes the lock and analysis
artifact identities.

When the Plan permitted no lock and none was selected, those fields remain
explicitly null rather than being invented.

The user saves the final receipt and registers safe completion metadata.

Successful registration moves:

```text
unblinding_authorized -> unblinded
```

The plaintext secret, released mapping, and final readable receipt are not
persisted by blindstats.

## 6. Current persistent states and events

Workflow states:

```text
setup
  ↓
blinded
  ↓
unblinding_authorized
  ↓
unblinded
```

Important durable events/artifacts include:

- Plan activation;
- blinding transformation registration;
- zero or more AnalysisLocks;
- unblinding request;
- unblinding authorization; and
- unblinding completion.

An AnalysisLock is not a universal workflow state.

The governing distinction remains:

> **Request ≠ authorization ≠ exposure**

## 7. Current custody boundary

### Persisted by blindstats

- authenticated user and Study records;
- Study membership and capabilities;
- Plan draft and immutable Plan v1;
- workflow state;
- exact public blinding receipt;
- safe transformation metadata/hashes;
- exact AnalysisLock receipt and safe lock metadata when used;
- unblinding request;
- unblinding authorization;
- safe completion metadata;
- database registration timestamps.

### Browser-local or external

- source dataset contents;
- blinded dataset contents;
- substantive analysis artifact contents;
- plaintext unblinding secret;
- plaintext original-to-neutral mapping;
- final readable unblinding receipt.

This is a deliberate product boundary, not an accidental absence of storage.

## 8. What blindstats currently establishes

For actions completed through the application, blindstats can establish durable
relationships among:

- Study;
- active immutable Plan;
- transformation;
- exact registered receipt identities;
- AnalysisLock when used;
- request;
- authorization; and
- completion.

It can also provide database-generated registration chronology for those persistent
events.

blindstats does **not** prove:

- that nobody learned protected information outside the application;
- that the blinded dataset was the only data used;
- that a locked artifact was the only analysis performed;
- that an external handoff was secure;
- that the unblinding secret was never copied; or
- that a methodological choice was scientifically appropriate merely because it
  was enforced.

The product provides auditable workflow evidence rather than certification of
researcher behavior.

## 9. Product direction: Study as an RMS container

The current Study abstraction is intentionally broader than the Blinding
workflow.

A plausible long-term direction is a modular Research Management System in which
additional research-integrity or coordination workflows operate inside the same
Study.

Possible future modules might include:

- preregistration/freeze workflows;
- randomization/allocation;
- study documentation;
- other research-governance tools.

These are examples, not commitments.

The near-term product goal is to learn from researchers before choosing which
modules deserve implementation.

## 10. Near-term release path

The core Blinding workflow is substantially feature-complete for the first
researcher-feedback release.

The remaining near-term work is:

1. finish technical documentation refresh;
2. perform deployment hardening;
3. configure production authentication/redirect behavior;
4. deploy a research-preview environment;
5. perform a focused production smoke test, including a meaningful two-account
   independent workflow;
6. create lightweight researcher-facing walkthrough material; and
7. collect field feedback before expanding the feature set.

The product should be described as a **researcher-feedback / research-preview**
release.

It should not yet be described as production-hardened infrastructure for
sensitive, confidential, regulated, or client research.

## 11. Questions for field feedback

The first release should help answer:

- Is the workflow understandable without extensive explanation?
- Does the custodian/analyst separation match real research practice?
- Does the AnalysisLock concept make sense?
- Does allowing a documented no-lock Plan serve legitimate workflows?
- Are the warnings useful or distracting?
- Are external blinded-dataset handoffs awkward?
- Are external secret handoffs awkward?
- Would temporary in-app handoff materially improve usability?
- What prevents adoption?
- Which additional Study workflows would be most valuable?
- Is the broader RMS direction useful to researchers?

## 12. Ephemeral handoff as a possible post-feedback feature

One potential future feature is an ephemeral in-app handoff layer for objects such
as:

- blinded dataset; or
- post-authorization unblinding secret.

A plausible design could include:

- authenticated intended recipient;
- short expiration;
- delete after successful claim/download;
- expiration cleanup backstop; and
- retained safe audit metadata only.

If pursued, existing Supabase infrastructure is a more natural first candidate
than adding a separate database solely for handoff.

A stronger version could use browser-side recipient encryption so temporary
storage receives ciphertext only.

This feature is deferred until field testing establishes whether external transfer
is a real usability barrier and what custody/security model researchers would
accept.

## 13. Security, privacy, and open-source principles

Security and privacy are product constraints, not post hoc implementation details.

Development should continue to favor:

- least-privilege access;
- explicit authorization;
- private handling of substantive files;
- cryptographically appropriate secret handling;
- clear state transitions;
- exact artifact identity;
- durable registration records;
- careful logs that avoid protected values;
- explicit claim boundaries; and
- minimal infrastructure consistent with the actual requirement.

Open-source development is part of the trust strategy because it enables scrutiny
from researchers, statisticians, security practitioners, privacy practitioners,
and software engineers.

Open source is not a security control by itself.

Suitability for sensitive or regulated research depends on architecture,
deployment, governance, institutional requirements, and operational practices.

## 14. AI boundary

Generative AI may eventually assist with optional educational or administrative
tasks.

Integrity-critical operations should remain deterministic and inspectable.

AI should not be required to:

- generate cryptographic randomness;
- compute artifact hashes;
- authorize unblinding;
- decide access control;
- establish artifact identity; or
- determine whether a protected mapping may be released.

## 15. Deliberately deferred for the first release

Do not add these merely because they fit the long-term vision:

- Teams / Organizations hierarchy;
- multiple transformed variables;
- multiple protection targets;
- simultaneous multiple active Blinding workflows per Study;
- broad role-editor UI;
- billing;
- general cloud research-file storage;
- long-term server custody of substantive research data;
- server storage of plaintext mapping;
- in-app plaintext secret storage;
- encrypted in-app secret transfer before field evidence;
- generic exposure ledger;
- Plan amendment UI beyond v1;
- emergency/partial unblinding;
- multi-party/quorum authorization;
- arbitrary R/Python execution;
- electronic data capture;
- comprehensive project management;
- preregistration, randomization, or other RMS modules without user evidence.

These are deferred rather than permanently prohibited.

## 16. Current technical foundation

The current application uses:

- Next.js;
- React;
- TypeScript;
- Tailwind CSS;
- Supabase PostgreSQL;
- Supabase Auth;
- Supabase Row Level Security and PostgreSQL functions/RPCs;
- Papa Parse;
- Web Crypto; and
- Vitest/Testing Library.

No ORM is currently used.

The current validation baseline is:

```text
Test files: 20 passed
Tests:      117 passed
Lint:       clean
Build:      clean
DB lint:    no schema errors
```

## 17. Success criterion for the current phase

The current phase succeeds if researchers can use and understand one complete,
auditable Blinding workflow and provide actionable feedback about:

- scientific fit;
- governance fit;
- usability;
- handoff/custody friction; and
- which Study-level modules would create additional value.

The immediate direction is therefore:

> **stabilize → document → harden deployment → field test → learn → expand only
> where evidence supports expansion**
