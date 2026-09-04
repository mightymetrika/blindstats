# blindstats Product and Technical Vision

## 1. Purpose

blindstats is an open-source research software project for building auditable
analyst-blinding workflows.

Its initial purpose is to help research teams separate statistical analysis
decisions from knowledge of substantively meaningful study labels.

The core version 1 workflow is:

> **Analyst blinding → locked analysis → documented unblinding**

This narrow workflow is the flagship product. Broader research-platform
functionality should be added only after this workflow is useful, understandable,
and reliable.

## 2. The problem

Applied statistical analysis frequently involves legitimate choices.

Examples include:

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
for preregistration, appropriate study design, transparent reporting, or
replication.

It can, however, help separate some analysis decisions from knowledge of their
substantive consequences.

## 3. Product thesis

A useful analyst-blinding system needs more than renamed columns.

It should provide a controlled workflow that can answer questions such as:

- What information was blinded?
- How was it blinded?
- Who knew the true mapping?
- Who received the blinded data?
- When did they receive it?
- Which analysis artifacts were finalized while the analyst remained blinded?
- When were those artifacts locked?
- Who authorized unblinding?
- When did unblinding occur?
- What mapping was ultimately revealed?

The resulting audit history is a core product output.

These records are the project's "receipts": evidence describing the sequence and
integrity of the blinded-analysis workflow.

## 4. Version 1 workflow

The initial workflow is expected to include the following conceptual stages.

### 4.1 Study setup

An authorized user creates a study and establishes its research team.

Team members receive roles or permissions controlling which study information
they may access.

Exact roles have not yet been finalized, but likely responsibilities include:

- study ownership or administration;
- access to unblinded study information; and
- blinded analysis.

### 4.2 Source-data upload

An authorized user provides the original study dataset.

The source dataset remains distinct from any blinded derivative.

The system should retain sufficient metadata to identify the source artifact and
its relationship to later versions without exposing restricted information to
users who are not authorized to see it.

### 4.3 Blinding plan

Authorized users identify which variables or labels should be blinded and define
the permitted transformation.

The initial transformation system should remain deliberately narrow.

Likely early operations include:

- replacing meaningful categorical labels with neutral labels; and
- reproducibly permuting categorical mappings where methodologically
  appropriate.

The transformation should be reproducible and its mapping should be protected
from blinded analysts.

### 4.4 Blinded artifact

blindstats generates a blinded derivative of the source dataset.

The analyst receives only the information permitted by the study's blinding
plan and the analyst's role.

Permissions must ultimately be enforced server-side. Merely hiding information
in the browser is not sufficient authorization.

### 4.5 Blinded analysis

The analyst conducts the analysis while remaining blinded to the protected
mapping.

Early versions of blindstats should support storing submitted analysis artifacts
rather than executing arbitrary R or Python code.

Potential artifacts include:

- R scripts;
- Python scripts;
- Quarto or R Markdown files;
- notebooks;
- analysis documentation; and
- blinded results reports.

### 4.6 Analysis lock

Before unblinding, designated blinded analysis artifacts are finalized.

"Locking" should eventually establish a durable record of the exact artifact
that existed before unblinding.

Potential mechanisms include:

- immutable or append-only artifact records;
- timestamps;
- file hashes or checksums; and
- explicit study-state transitions.

The exact implementation is not yet specified.

The core requirement is that an analysis cannot be silently replaced after
unblinding while continuing to appear as though it were the analysis finalized
under blinding.

### 4.7 Unblinding authorization

Unblinding should be an explicit action performed only by users with the
appropriate authority.

The workflow should record:

- who authorized the action;
- when authorization occurred; and
- the study state at the time.

More complex multi-party authorization can be considered later if justified.

### 4.8 Unblinding

After authorization, the appropriate mapping and unblinded materials become
available to authorized team members.

Simple substitutions should be deterministic.

For example, converting a neutral label such as `Group_A` back to `Treatment`
should be handled by reproducible application logic rather than generative AI.

### 4.9 Audit record

The study should retain an audit history describing important workflow events.

Potential events include:

- study creation;
- membership or permission changes;
- source-file upload;
- blinding-plan creation;
- blinded-artifact generation;
- file access or release;
- analysis submission;
- analysis locking;
- unblinding authorization; and
- final unblinding.

The audit system must be designed carefully so that the audit records themselves
do not leak restricted or blinded information.

## 5. Artifact and file model

Research files are a central part of the workflow.

The application should conceptually separate:

1. **Artifact metadata**
   - identity;
   - ownership;
   - study relationship;
   - type;
   - timestamps;
   - access rules;
   - hashes;
   - workflow state.

2. **Artifact contents**
   - datasets;
   - scripts;
   - reports;
   - archives; and
   - other research files.

The likely architecture is to store metadata and relationships in a relational
database while storing file contents in private object storage.

Sensitive files should not become publicly accessible application assets.

Controlled project-file sharing may later become useful beyond the blinding
workflow, but it should emerge from the same permissions, artifact, and audit
architecture rather than becoming a separate version 1 product.

## 6. Conceptual domain model

The exact schema has not been designed.

Current conceptual entities include:

- User
- Team
- TeamMembership
- Study
- StudyMembership or StudyRole
- FileArtifact
- BlindingPlan
- BlindingMapping
- AnalysisSubmission
- AuditEvent
- UnblindingEvent

These names are working concepts, not commitments to database table names.

Possible study states include:

- setup;
- blinded;
- analysis locked;
- unblinding authorized;
- unblinded; and
- archived.

The eventual state machine should be designed explicitly rather than inferred
from scattered boolean fields.

## 7. Technical direction

### Application

Current foundation:

- Next.js
- TypeScript
- React
- Tailwind CSS
- Next.js App Router
- Papa Parse for CSV parsing and serialization
- Vitest for automated unit and integration testing
- Testing Library with jsdom for minimal React UI workflow testing

The current browser-local prototype implements the first blinding slice: strict CSV
parsing, secure categorical label randomization, blinded artifact generation,
SHA-256 hashing, public receipt/private key separation, and a local browser UI for
selecting a CSV, choosing one categorical column, generating the package, and
downloading the three generated artifacts.

Automated testing is layered. Core transformation and integrity behavior is
covered extensively with Node-based Vitest tests, while the React interface has
a deliberately small component-test layer focused on stable workflow invariants
rather than visual snapshots.

This prototype intentionally does not create the future multi-user security
boundary. The local operator can access both the source data and private key, and
research data are not persisted by the application.

### Relational data

PostgreSQL is currently preferred for application metadata because the core
domain consists primarily of relationships among users, teams, studies,
memberships, permissions, artifacts, and workflow events.

Neon is a likely PostgreSQL provider.

No ORM has been selected yet.

Prisma and Drizzle are candidates and should be compared against actual project
requirements before one is adopted.

### File storage

A storage provider has not yet been selected.

Requirements should be defined before choosing one.

Likely requirements include:

- private objects by default;
- server-controlled authorization;
- temporary or signed access where appropriate;
- deletion and retention controls;
- artifact integrity verification; and
- compatibility with the application's audit model.

### Authentication and authorization

An authentication provider has not yet been selected.

Authentication answers who the user is.

Authorization determines what that authenticated user may do within a
particular team or study.

The authorization model is therefore a core application responsibility even if
authentication is delegated to an external provider.

### AI

AI is not required for the core blinding workflow.

Future AI-assisted features might help rewrite blinded prose after unblinding or
assist with other research workflows.

Such functionality should remain optional and reviewable.

Integrity-critical operations such as storing mappings, applying deterministic
mappings, enforcing permissions, locking artifacts, and authorizing unblinding
must not depend on a generative model.

## 8. Security and integrity principles

The intended use case may eventually involve sensitive research files.

Development should therefore favor:

- least-privilege access;
- server-side authorization;
- explicit permission checks;
- private file storage;
- clear study-state transitions;
- reproducible blinding operations;
- durable audit events;
- artifact hashes where appropriate;
- explicit unblinding authorization;
- careful secret management; and
- logs that do not expose protected values.

These are architectural goals.

The current application does **not** yet implement the controls required to
claim that it is suitable for sensitive, regulated, confidential, or client
research data.

## 9. Deliberately out of scope for version 1

The following should not be added merely because they fit the long-term vision:

- full electronic data capture;
- a general-purpose survey platform;
- arbitrary R or Python execution;
- a hosted publication or DOI repository;
- comprehensive project management;
- a general cloud-storage product;
- advanced AI-generated analysis;
- every possible blinding transformation;
- MongoDB without a demonstrated document-oriented requirement; and
- integrations whose requirements have not yet emerged from the core workflow.

## 10. Open architecture questions

The following remain intentionally unresolved:

- exact user and study roles;
- authorization rules;
- blinding-transformation specifications beyond the implemented v0 categorical mapping;
- state-machine implementation;
- PostgreSQL ORM;
- authentication provider;
- object-storage provider;
- encryption and key-management approach;
- artifact-retention policy;
- audit-event schema;
- unblinding authorization requirements;
- deployment architecture;
- CI/CD;
- preregistration or repository integrations; and
- future AI features.

These decisions should be made from concrete requirements rather than selected
in advance.

## 11. Version 1 success

A successful initial release should allow a small research team to complete one
clear workflow:

1. establish a study and access roles;
2. upload source data;
3. define and apply a reproducible blinding plan;
4. give an analyst the blinded artifact without revealing the protected mapping;
5. submit and lock the blinded analysis artifacts;
6. explicitly authorize unblinding;
7. reveal the appropriate mapping and materials; and
8. inspect an audit record demonstrating what occurred and when.

If blindstats can perform that workflow clearly and reliably, broader research
platform functionality can be evaluated from a strong foundation.
