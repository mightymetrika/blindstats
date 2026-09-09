# blindstats Product and Technical Vision

## 1. Purpose

blindstats is an open-source research software project for auditable
analyst-blinding workflows.

Its initial purpose is to help research teams separate statistical analysis
decisions from knowledge of substantively meaningful study labels.

The flagship workflow is:

> **Analyst blinding → locked analysis → documented unblinding**

Broader research-platform functionality should be added only after this workflow
is useful, understandable, and reliable.

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

- What information was blinded?
- How was it blinded?
- Which artifact represented the blinded data?
- Which analysis artifact was finalized before unblinding?
- Which receipt documented that lock?
- When and by whom was unblinding authorized?
- What mapping was ultimately released?

The resulting audit history is a core product output.

These records are the project's **receipts**: evidence describing the workflow
artifacts and their relationships.

## 4. Current browser-local protocol

The current schema-`0.3` prototype implements the scientific workflow without
requiring accounts, a database, or server-side research-file storage.

### 4.1 Create blinded package

Input:

- original UTF-8 comma-delimited CSV.

Outputs:

- blinded CSV;
- public blinding receipt; and
- unblinding secret.

The selected categorical values are randomly permuted to neutral
`Group_<letters>` labels using secure browser randomness.

The mapping is encrypted with AES-GCM using a fresh 256-bit key and 96-bit IV.
The public receipt contains the sealed mapping. The separate unblinding secret
contains the decryption key.

### 4.2 Blinded analysis

The analyst conducts the substantive analysis outside blindstats using blinded
materials.

The file-mediated role model is:

- study owner retains the unblinding secret;
- analyst receives the blinded data and public receipt.

The software currently supports but does not enforce that separation.

### 4.3 Analysis lock

Inputs:

- exact public blinding receipt; and
- one analysis artifact.

Output:

- analysis-lock receipt.

The lock identifies the exact public-receipt bytes and exact analysis-artifact
bytes by SHA-256.

The blinded-artifact identity is carried forward from the public receipt rather
than requiring the blinded CSV to be supplied again.

### 4.4 Documented unblinding

Inputs:

- exact public blinding receipt;
- unblinding secret; and
- analysis-lock receipt.

Output:

- unblinding receipt containing the released mapping.

blindstats verifies the receipt/lock relationship and uses authenticated AES-GCM
decryption to open the sealed mapping.

The final receipt records the mapping and the linked artifact identities.

### 4.5 What v0 does not establish

The browser-local protocol provides verifiable artifact relationships, not a
certification of researcher behavior.

It does not prove:

- that protected information was never accessed outside the workflow;
- that the unblinding secret was withheld until locking;
- that the locked artifact was the only analysis performed;
- that a particular dataset was actually used by external analysis software; or
- that browser-generated timestamps establish trusted chronology.

Those limitations are important inputs to the later platform architecture.

## 5. Longer-term server-backed workflow

The future platform should strengthen the same scientific protocol rather than
replace it.

### 5.1 Studies and roles

An authorized user creates a study and establishes its research team.

Exact roles remain to be designed, but responsibilities will likely include:

- study ownership/administration;
- authorization to access unblinded information; and
- blinded analysis.

Permissions must ultimately be enforced server-side. Hiding information in the
browser is not authorization.

### 5.2 Source data and artifacts

The system may eventually accept or connect to original research data and other
study artifacts.

Before blindstats stores research files, requirements must be defined for:

- data classification;
- encryption at rest and in transit;
- key management;
- access logging;
- retention and deletion;
- backups and disaster recovery;
- geographic/data-residency constraints where relevant;
- institutional and contractual requirements; and
- incident response.

The project should not assume that all research data belong in blindstats merely
because storage becomes technically possible.

### 5.3 Blinding

Authorized users define a blinding plan.

The system generates a blinded derivative while protecting the true mapping from
blinded analysts.

The current encrypted mapping + separate secret provides a useful protocol model.
A server-backed version should replace manual secret-file separation with
controlled key access or controlled decryption.

### 5.4 Analysis lock

Before unblinding, designated analysis artifacts are finalized.

A server-backed lock may strengthen v0 through:

- immutable or append-only artifact records;
- server-trusted timestamps;
- persistent artifact storage;
- explicit study-state transitions; and
- auditable authorization events.

A later revision should never silently continue to appear as the exact artifact
that was locked earlier.

### 5.5 Unblinding authorization

Unblinding should be an explicit state transition performed only after the
required authorization.

The platform should be able to record:

- who authorized unblinding;
- when authorization occurred;
- what study state existed at the time; and
- which protected mapping or key material was released.

Multi-party authorization can be considered if concrete research use cases
justify it.

### 5.6 Unblinding

After authorization, the mapping becomes available to permitted users.

In a mature platform, the analyst may never need direct access to an encryption
key file. The platform can perform controlled decryption after authorization and
record that event.

### 5.7 Audit record

Potential durable audit events include:

- study creation;
- membership/permission changes;
- source-artifact registration;
- blinding-plan creation;
- blinded-artifact generation;
- artifact access/release;
- analysis submission;
- analysis locking;
- unblinding authorization; and
- final unblinding.

Audit records must themselves be designed so they do not leak protected
information.

## 6. Artifact and data architecture

Research artifacts have two conceptually distinct layers:

1. **Artifact metadata**
   - identity;
   - study relationship;
   - ownership;
   - type;
   - timestamps;
   - hashes;
   - permissions; and
   - workflow state.

2. **Artifact contents**
   - datasets;
   - scripts;
   - reports;
   - notebooks;
   - archives; and
   - other research files.

A relational database remains the preferred direction for study, membership,
permission, artifact, state, and audit metadata.

Private object storage is a likely fit for file contents if and when blindstats
takes custody of research files.

Storage and database choices should follow requirements rather than precede them.

## 7. Conceptual domain model

The exact schema has not been designed.

Current working concepts include:

- User
- Team
- TeamMembership
- Study
- StudyMembership or StudyRole
- FileArtifact
- BlindingPlan
- BlindingMapping or SealedMapping
- AnalysisSubmission
- AnalysisLock
- AuditEvent
- UnblindingEvent

Possible study states include:

- setup;
- blinded;
- analysis locked;
- unblinding authorized;
- unblinded; and
- archived.

The eventual state machine should be explicit rather than inferred from scattered
flags.

## 8. Technical direction

### Application

Current foundation:

- Next.js
- TypeScript
- React
- Tailwind CSS
- Next.js App Router
- Papa Parse
- Web Crypto
- Vitest
- Testing Library with jsdom

The current prototype implements all three browser-local workflow stages and
keeps integrity-critical operations in testable TypeScript functions outside the
React presentation layer.

### Relational data

PostgreSQL is currently preferred because the domain is strongly relational:
users, teams, studies, memberships, permissions, artifacts, workflow states, and
audit events.

No PostgreSQL provider or ORM should be treated as final until persistence
requirements are ready for implementation.

### File storage

A storage provider has not been selected.

Requirements should be defined first. Likely requirements include:

- private objects by default;
- server-controlled authorization;
- encryption and key management;
- temporary or signed access where appropriate;
- retention and deletion controls;
- artifact integrity verification;
- audit compatibility; and
- operational reliability appropriate to the intended data classes.

### Authentication and authorization

Authentication answers who the user is.

Authorization determines what that authenticated user may do within a particular
study.

Authorization therefore remains a core blindstats responsibility even if identity
authentication is delegated to an external provider.

### AI

AI is not required for the core blinding workflow.

Integrity-critical operations such as mapping, hashing, encryption/decryption,
permissions, locking, and unblinding authorization must not depend on a
generative model.

Future AI-assisted features should remain optional and reviewable.

## 9. Security, privacy, and open-source principles

The project may eventually handle sensitive research files, so security and
privacy cannot be treated as implementation details added after the platform is
built.

Development should favor:

- least-privilege access;
- explicit authorization checks;
- private storage;
- cryptographically appropriate secret management;
- clear study-state transitions;
- reproducible transformations;
- durable audit events;
- artifact integrity checks;
- careful logs that avoid protected values;
- explicit retention/deletion behavior; and
- conservative claims about what the software guarantees.

Open-source development is part of the trust strategy. Public code can invite
scrutiny from researchers, statisticians, security engineers, privacy
practitioners, and software developers with different expertise.

Open source is not a security control by itself. Suitability for sensitive or
regulated research depends on the architecture, deployment, governance, and
operational practices surrounding the code.

The current application does **not** implement the controls required to claim
suitability for sensitive, regulated, confidential, or client research data.

## 10. Deliberately out of scope for the first public release

The following should not be added merely because they fit the long-term vision:

- full electronic data capture;
- a general-purpose survey platform;
- arbitrary R or Python execution;
- a hosted publication/DOI repository;
- comprehensive project management;
- a general cloud-storage product;
- advanced AI-generated analysis;
- every possible blinding transformation; and
- integrations whose requirements have not emerged from the core workflow.

The first release should remain focused on making the blind-lock-unblind protocol
clear and useful.

## 11. Open architecture questions

Important unresolved questions include:

- exact user/study roles;
- authorization rules;
- state-machine implementation;
- PostgreSQL provider and ORM;
- authentication provider;
- object-storage provider;
- server-side encryption and key-management architecture;
- research-data classifications the hosted product should accept;
- artifact-retention policy;
- audit-event schema;
- unblinding authorization requirements;
- deployment architecture;
- CI/CD;
- preregistration/repository integrations; and
- future AI features.

These decisions should be made from concrete requirements.

## 12. Release path and success

The first public release should demonstrate one clear scientific workflow:

1. create a blinded dataset;
2. keep the unblinding secret separate from the blinded analyst;
3. conduct the analysis while blinded;
4. lock an exact pre-unblinding analysis artifact;
5. release the secret after the lock;
6. authenticate and decrypt the sealed mapping; and
7. retain the linked receipts as an audit trail.

The browser-local prototype now demonstrates that workflow without accounts,
persistent study records, or server-side research-file storage.

The next major architectural progression is:

> **documented voluntary workflow → increasingly stronger technical safeguards and
> role separation**

Success means preserving the clarity of the current protocol while adding only
the infrastructure needed to enforce roles, manage protected artifacts, and
produce a more durable audit history.
