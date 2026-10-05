# Server-Backed Study and Blinding Workflow v0

- **Project:** blindstats
- **Status:** implemented first server-backed workflow; pre-release
- **Scope:** current Study + analyst-blinding governance architecture
- **Browser-local artifact schema:** `0.3`
- **Updated:** 2026-10-02

## 1. Purpose

This document describes the current server-backed Study and blinding workflow in
blindstats.

The original design goal was to place the browser-local blinding protocol inside a
persistent Study, membership, authorization, workflow-state, and audit
architecture without requiring blindstats to take custody of substantive research
files or plaintext unblinding information.

That architecture is now substantially implemented.

The current scientific sequence is:

> **Plan → blind → analyze while blinded → lock → request → authorize → unblind → document**

The implementation combines two layers:

1. **browser-local artifact operations**
   - create the blinded package;
   - hash the source, blinded, and analysis artifacts;
   - create an analysis-lock receipt when that step is used;
   - authenticate/decrypt the mapping after authorization; and
   - create the final unblinding receipt;

2. **persistent server-backed governance**
   - authenticate users;
   - maintain Studies, membership, and capabilities;
   - preserve an immutable active BlindingPlan version;
   - register the exact public blinding receipt;
   - register exact analysis-lock receipts;
   - record unblinding requests and authorizations;
   - register safe completion metadata; and
   - expose a durable workflow audit history.

The current server-backed implementation uses **Supabase PostgreSQL and Auth**.
Substantive research-file storage remains intentionally out of scope.

See also:

- [`blinding-workspace-v0.md`](blinding-workspace-v0.md)
- [`analysis-lock-v0.md`](analysis-lock-v0.md)
- [`unblinding-v0.md`](unblinding-v0.md)
- [`literature-and-prior-art.md`](literature-and-prior-art.md)
- [`vision.md`](vision.md)

## 2. Architectural principle: Study versus workflow

A **Study** is the durable research and collaboration container.

A **Workflow** is a specific research process operating within a Study.

Blinding is the first workflow implemented within a Study, but it does not define
the Study itself.

This separation is now reflected in the application UI:

```text
Studies
  └── Study
        └── Research workflows
              └── Blinding
```

The current application effectively supports one blinding workflow per Study.
Creating another blinding workflow for the same Study redirects to the existing
workflow.

The longer-term product direction remains closer to a modular research-management
system than to a single-purpose blinding utility. Possible future modules include
randomization, preregistration/freeze workflows, study documentation, and other
research-integrity tools.

Those modules are intentionally deferred until researcher feedback supports them.

## 3. Current first-release scope

The current implementation provides:

- authenticated users through Supabase Auth;
- persistent Studies;
- Study membership;
- Study-scoped capability-based authorization;
- persistent blinding workflows;
- editable BlindingPlan drafts during setup;
- immutable activated BlindingPlan v1 records;
- explicit workflow state;
- browser-local blinded-package creation;
- exact persistent public-receipt registration;
- persistent analysis-lock registration;
- persistent unblinding requests;
- persistent unblinding authorizations;
- browser-local authorized unblinding;
- persistent safe unblinding-completion metadata;
- database-generated registration timestamps; and
- a durable Audit history assembled from the persistent workflow records.

The current release does **not** require blindstats to store substantive
research-file contents.

The following remain browser-local or outside blindstats custody:

- source dataset contents;
- generated blinded dataset contents;
- substantive analysis-artifact contents;
- the plaintext unblinding secret;
- the plaintext original-to-neutral mapping; and
- the plaintext final unblinding receipt.

The current application is therefore primarily a persistent **coordination,
authorization, artifact-identity, and audit layer**, not a general research-data
repository.

## 4. Enforcement boundary

blindstats distinguishes among hard system invariants, Study-chosen governance
rules, and user-facing defaults/warnings.

### 4.1 Hard system invariants

The current implementation enforces integrity-critical properties at the
database and/or browser protocol boundary.

Examples include:

- authenticated access to persistent workflow actions;
- Row Level Security for Study-scoped records;
- capability checks for protected actions;
- supported receipt structure and artifact hashes;
- exact binding of transformations and analysis locks to the active plan;
- immutable activated plan versions;
- immutable registered transformation/lock/request/authorization/completion
  records under ordinary application use;
- state-transition requirements;
- independent authorization requiring a different requester and authorizer;
- independent-plan activation requiring a genuine two-actor configuration;
- no server persistence of the plaintext unblinding secret or plaintext mapping;
  and
- exact-retry idempotence for selected registration/authorization operations.

Integrity-critical operations fail rather than silently degrading to a weaker
relationship.

### 4.2 Study-chosen rules that become enforceable commitments

The current BlindingPlan supports two configurable governance choices:

- whether an analysis lock is required before an unblinding request may proceed;
- whether authorization is `independent` or `self_authorization`.

The plan also records:

- one substantive protection target; and
- an optional short protection rationale.

Once activated, these values are frozen into the immutable active plan version
used by later workflow checks.

### 4.3 Defaults, explanations, and warnings

The application currently recommends:

- requiring an analysis lock; and
- using independent authorization.

A Study may choose:

- analysis lock not required; and/or
- self-authorization.

Those weaker settings require explicit acknowledgment when the plan is activated,
and the acknowledgments are retained in the plan version.

The software does not claim that one policy is universally appropriate for every
study.

## 5. Current domain model

The current relational implementation centers on the following persisted
concepts.

### 5.1 Study-level concepts

- Supabase Auth user;
- `profiles`;
- `studies`;
- `study_memberships`;
- `study_capabilities`.

Study lifecycle currently permits:

```text
active
archived
```

The current user interface creates active Studies. A broader Study-lifecycle
management UI is not yet implemented.

### 5.2 Blinding-workflow concepts

- `blinding_workflows`;
- `blinding_plan_drafts`;
- `blinding_plan_versions`;
- `blinding_transformations`;
- `analysis_locks`;
- `unblinding_requests`;
- `unblinding_authorizations`;
- `unblinding_completions`.

The current implementation does **not** use a generic `AuditEvent` table. The
Audit history is derived from these durable domain records.

The current implementation also does not yet persist a general
`ProtectedInformationExposure` record. Successful completion records who completed
the governed unblinding workflow, but broader exposure tracking remains a future
capability.

## 6. BlindingPlan

The BlindingPlan defines the protection target and governance rules for one
blinding workflow.

The UI uses the human-readable term **Blinding plan**. `BlindingPlan` remains
useful as a technical/domain name.

### 6.1 Protection target versus transformed variable

The current plan records one **protection target**: the substantive information
the workflow is intended to keep from the blinded analyst.

Examples include:

- treatment identity;
- intervention identity;
- geographic category identity; or
- another substantive group identity.

This is deliberately distinct from the concrete dataset column later selected
during the blinding transformation.

For example:

```text
Protection target: Treatment identity
Transformed CSV column: treatment
```

The current database stores protection targets as an array but requires exactly
one element.

Multiple protection targets or blinded variables remain deferred.

### 6.2 Protection rationale

The plan supports an optional short rationale.

Examples include:

- conceal treatment identity during statistical analysis;
- reduce the possibility that model/reporting decisions are influenced by
  substantive group labels.

The current rationale is limited in length and is intended to remain concise.

### 6.3 Analysis-lock policy

The current plan supports:

```text
required
not required
```

The recommended/default configuration is **required**.

If the Study selects `not required`, plan activation requires explicit
acknowledgment that this weakens the pre-unblinding commitment.

An analysis lock identifies an exact declared artifact. It does not establish that
the artifact is scientifically complete, that it was the only analysis performed,
or that later work did not occur.

#### No-lock completion path

The request, authorization, browser-local unblinding, and persistent completion
paths all honor the active plan's `require_analysis_lock` setting.

When an analysis lock is required, the governed request and final completion remain
bound to the selected registered AnalysisLock.

When an analysis lock is not required and the request intentionally omits one, the
final unblinding receipt and persistent completion record explicitly carry no
AnalysisLock identity or analysis-artifact metadata. The rest of the governed
chain remains bound to the active plan, registered transformation, request,
authorization, unblinding secret identity, and final receipt identity.

### 6.4 Unblinding-authorization policy

The current plan supports:

**Independent authorization — recommended/default**

- the request and authorization must be performed by different authenticated
  users; and
- both users must hold the relevant Study capability.

**Self-authorization permitted**

- the same user may request and authorize if the active plan permits
  self-authorization and the user holds both required capabilities.

The database enforces the independent-requester/authorizer distinction at
authorization time.

It also enforces two-actor readiness when an independent plan is activated, so
the requirement cannot be bypassed by calling the activation RPC directly.

### 6.5 Role separation is Study-scoped, not embedded in the plan

The current plan does not directly store a list of blinded users, secret
custodians, or permitted recipients.

Those responsibilities are currently represented through Study membership and
capabilities.

This is an intentional simplification for the first release.

### 6.6 Secret custody

The unblinding secret is generated locally and exported by the person creating the
blinded package.

The server does not store the plaintext secret.

The current workflow expects the custodian to retain the secret outside blindstats
and transfer it to the analyst only after authorization.

blindstats does not currently prove where the custodian stored the secret or
whether the external transfer channel was secure.

### 6.7 Unblinded recipient capability

Permission to complete the local unblinding workflow is represented by:

```text
unblinded.receive
```

This capability is distinct from:

```text
unblinding.authorize
```

The distinction allows an authorizer to approve unblinding without necessarily
being the person who performs the local release.

## 7. Plan activation, immutability, and amendment status

### 7.1 Draft during setup

When a workflow is created, blindstats maintains an editable BlindingPlan draft.

While:

```text
workflow.state = setup
active_plan_version_id = null
```

a user with `blinding.configure` can edit the supported draft fields.

### 7.2 Activation creates immutable Plan v1

Plan activation:

1. verifies authentication and `blinding.configure`;
2. requires workflow state `setup`;
3. validates one nonblank protection target;
4. validates the configured policies;
5. requires acknowledgment for weaker settings;
6. enforces independent two-actor readiness when applicable;
7. inserts immutable `blinding_plan_versions` version `1`; and
8. stores that version as `active_plan_version_id`.

Importantly, **plan activation does not move the workflow to `blinded`**.

After activation the workflow remains in `setup` until the blinded package is
successfully created and registered.

This separation lets the user review/freeze governance before creating the actual
blinded transformation.

### 7.3 Historical plan versions

Activated plan rows are read-only to normal authenticated clients and are treated
as immutable historical records.

The current first-release UI/logic supports one active plan version (`v1`).

### 7.4 Prospective amendments are deferred

The earlier design anticipated later plan amendments and multiple historical plan
versions.

That mechanism is **not yet implemented**.

After Plan v1 is activated, the current workflow does not expose ordinary edits to
the active plan.

A future amendment model should preserve prior plan versions rather than silently
rewriting history.

## 8. Capabilities and current role bundles

Authorization is Study-scoped and capability-based.

The current allowed capabilities are:

```text
study.manage
membership.manage
capability.manage
blinding.configure
blinding.create
analysis.lock
unblinding.request
unblinding.authorize
unblinded.receive
audit.view
```

### 8.1 Initial Study creator

Creating a Study automatically:

- creates the creator's Study membership; and
- grants the creator all ten capabilities.

This makes a fresh Study usable by one authenticated person.

### 8.2 Blinding custodian bundle

The current separated two-party workflow uses a custodian side with:

```text
study.manage
membership.manage
capability.manage
blinding.configure
blinding.create
unblinding.authorize
audit.view
```

The custodian does not retain the analyst-side capabilities after the dedicated
analyst role is assigned.

### 8.3 Blinded analyst bundle

The current analyst assignment grants exactly:

```text
analysis.lock
unblinding.request
unblinded.receive
```

The selected analyst must already have a blindstats account and must be a
different authenticated user from the assigning custodian.

Assigning the blinded analyst replaces that account's existing Study capabilities
with the narrow analyst bundle.

### 8.4 Independent authorizer helper

A separate database helper can add an existing authenticated Study member/account
with only:

```text
unblinding.authorize
```

The current primary UI flow instead emphasizes the simpler custodian/analyst
split.

### 8.5 Study-scoped limitation

Capabilities currently apply to the entire Study, not to an individual workflow.

That is acceptable while the product effectively supports one blinding workflow
per Study.

If multiple concurrent workflows become a real requirement, capability scope
should be revisited rather than assumed to generalize automatically.

## 9. Authorization versus exposure

The product preserves the conceptual distinction:

> **Request ≠ authorization ≠ exposure**

Current persistent records directly represent:

- request;
- authorization; and
- successful completion of the governed local unblinding workflow.

The current implementation does **not** maintain a generalized exposure ledger
for every person who may have learned protected information.

The completion record identifies the authenticated user who completed unblinding.
It cannot establish whether other people learned the mapping outside blindstats.

A future exposure model should therefore be treated as an extension, not as a
claim of the current system.

## 10. Workflow state machine

The implemented blinding workflow uses:

```text
setup
  ↓
blinded
  ↓
unblinding_authorized
  ↓
unblinded
```

`AnalysisLock` is a durable artifact/event, not a universal workflow state.

### 10.1 `setup`

Meaning:

- the workflow exists;
- the plan may still be a draft, or Plan v1 may already be active;
- no blinded transformation has yet been registered.

During setup:

- the plan can be edited before activation;
- role separation can be configured when independent authorization requires it;
- the active plan can be frozen; and
- after plan activation the blinded package can be created locally.

### 10.2 Plan activation while remaining in setup

This is an explicit intermediate condition:

```text
workflow.state = setup
active_plan_version_id = Plan v1
```

The UI describes this as ready for blinding.

### 10.3 Transition: `setup → blinded`

The transition occurs when a supported browser-local blinded package is
successfully registered.

Registration requires:

- authentication;
- `blinding.create`;
- workflow state `setup`;
- an active immutable plan version;
- a valid schema-`0.3` public receipt;
- supported transformation metadata; and
- successful server-side verification of the submitted receipt.

The registration:

- stores the exact public receipt text;
- computes/preserves its exact identity;
- records safe transformation metadata;
- binds the transformation to the active plan; and
- atomically moves the workflow to `blinded`.

### 10.4 `blinded`

Meaning:

- a registered blinding transformation exists;
- the exact public receipt is persistent;
- the workflow is bound to the active Plan v1;
- blinded analysis may proceed; and
- unblinding has not yet been authorized.

While blinded, authorized members may:

- register one or more AnalysisLocks;
- submit one ordinary unblinding request; and
- authorize that request when the active plan permits the actor to do so.

### 10.5 AnalysisLock event

An AnalysisLock is created from a local analysis artifact.

The browser creates an analysis-lock receipt containing the linked public-receipt
identity and analysis-artifact identity.

Persistent registration stores:

- lock identity;
- workflow and Study identity;
- linked transformation;
- active plan version;
- exact lock receipt text;
- exact lock-receipt SHA-256;
- analysis filename;
- analysis-artifact SHA-256;
- byte length;
- registering user; and
- database registration time.

The analysis artifact contents are not stored.

Multiple AnalysisLocks may be registered for the same blinded workflow.

### 10.6 Unblinding request

A user with `unblinding.request` may create the workflow's ordinary unblinding
request while state is `blinded`.

The request is bound to:

- the active Plan v1;
- the registered transformation;
- the requester; and
- a selected AnalysisLock when supplied/required.

One ordinary request is currently supported per workflow.

Repeating the exact same request by the same user is treated idempotently.

### 10.7 Transition: `blinded → unblinding_authorized`

Authorization requires:

- a valid request;
- `unblinding.authorize`;
- workflow state `blinded`;
- binding to the active plan/transformation;
- satisfaction of the plan's lock rule; and
- satisfaction of the plan's independent/self-authorization rule.

For independent authorization, `authorized_by` must differ from `requested_by`.

Successful authorization:

- creates a persistent authorization record; and
- atomically moves the workflow to `unblinding_authorized`.

It does **not** decrypt or release the mapping.

### 10.8 `unblinding_authorized`

Meaning:

- release has been approved under the active governance rule;
- the server still does not possess the plaintext secret or mapping; and
- the analyst may complete the local unblinding operation after receiving the
  secret externally.

### 10.9 Transition: `unblinding_authorized → unblinded`

A user with `unblinded.receive` selects the local secret.

The browser:

- uses the exact registered public receipt;
- uses the request-selected analysis-lock receipt;
- authenticates/decrypts the sealed mapping;
- displays/releases the mapping locally; and
- generates the final unblinding receipt.

The application then registers safe completion metadata.

The server verifies the nonsecret governed relationships it can verify and
atomically transitions the workflow to `unblinded`.

Because the plaintext secret and mapping remain local, the server does **not**
independently repeat the cryptographic decryption.

### 10.10 `unblinded`

Meaning:

- blindstats has persistently recorded completion of the authorized local
  unblinding workflow.

The correct claim is narrow:

> blindstats recorded completion of the authorized local unblinding workflow and
> linked it to the governed artifact chain.

The state does not prove that no earlier or external exposure occurred.

## 11. Workflow closure without unblinding

The earlier design proposed terminal concepts such as:

```text
cancelled
closed_without_unblinding
```

These workflow states are **not currently implemented**.

A future release may add explicit closure without forcing mapping release.

Until then, the implemented workflow state machine remains limited to:

```text
setup
blinded
unblinding_authorized
unblinded
```

## 12. Study lifecycle

Study lifecycle is separate from blinding-workflow state.

The database currently permits:

```text
active
archived
```

The current UI creates active Studies and displays the lifecycle value.

A complete archive/restore management workflow is not yet part of the first
researcher-feedback UI.

Archiving a Study, when exposed later, must remain conceptually distinct from
unblinding.

## 13. Artifact and persistence boundary

The current architecture intentionally separates artifact identity/governance from
substantive file contents.

### 13.1 Persisted information

Current persistent records include:

- authenticated users/profiles;
- Studies;
- Study memberships;
- Study capabilities;
- BlindingPlan draft and immutable active version;
- workflow state;
- exact public blinding receipt;
- parsed transformation metadata and hashes;
- exact analysis-lock receipt;
- analysis-artifact filename/hash/byte length;
- unblinding request;
- unblinding authorization;
- safe unblinding-completion metadata; and
- database registration timestamps.

### 13.2 Information not persistently stored

The current server does not store:

- source dataset contents;
- blinded dataset contents;
- analysis-artifact contents;
- plaintext unblinding secret/key material;
- plaintext released mapping; or
- plaintext final unblinding receipt.

### 13.3 Exact-byte identity-bearing JSON artifacts

The public blinding receipt and analysis-lock receipt are persisted as exact text.

Their exact submitted representation matters because the integrity chain depends
on exact bytes/UTF-8 text rather than normalized semantic JSON equivalence.

Reformatting otherwise equivalent JSON can therefore change its artifact
identity.

## 14. Unblinding secret and mapping custody

The unblinding secret remains an export-only protected artifact.

Current behavior:

- secret generated in the browser;
- custodian downloads/saves it;
- server does not persist it;
- custodian retains it outside blindstats;
- after authorization, custodian transfers it externally to the analyst;
- analyst selects it locally; and
- local authenticated decryption releases the mapping.

The plaintext mapping also remains outside server persistence.

This boundary limits the consequences of a compromise of persistent blindstats
metadata, but it means external handoff security is outside the application's
control.

A possible future feature is an ephemeral in-app handoff layer. That idea is
deferred until field testing establishes whether external transfer is a material
usability barrier and what security model researchers would accept.

## 15. Final unblinding receipt

The browser creates the final unblinding receipt after successful local
decryption.

The readable receipt contains the released mapping and is offered to the analyst
for download.

The server stores only safe completion metadata, including the final receipt's
SHA-256 identity, not the readable receipt itself.

The persistent completion record also contains identities linking the completion
to:

- the plan;
- request;
- authorization;
- transformation;
- AnalysisLock and analysis artifact when the request used one;
- source/blinded artifacts; and
- secret hash.

## 16. Audit model

The current application does not use a separate generic append-only audit-event
table.

Instead, Audit history is assembled from durable workflow records:

- active immutable plan version;
- blinding transformation registration;
- zero or more analysis locks;
- unblinding request;
- authorization; and
- unblinding completion.

The Audit history UI exposes technical identifiers, hashes, actor relationships,
and timestamps without placing this dense detail in the primary live workflow.

This design gives the first release an auditable chain while avoiding a second
parallel event model before there is a demonstrated need for one.

A future generic audit-event layer may still be useful for broader RMS features,
Study metadata changes, membership changes, archival actions, or administrative
events.

## 17. Trusted chronology and claim boundaries

Browser-generated artifact timestamps remain part of the schema-`0.3` receipts and
are not independently trusted chronology.

Persistent records additionally receive database-generated timestamps such as:

- plan `activated_at`;
- transformation `registered_at`;
- lock `registered_at`;
- request `requested_at`;
- authorization `authorized_at`; and
- completion `registered_at`.

These timestamps support statements such as:

- blindstats registered a particular public receipt at a recorded server time;
- blindstats registered a particular lock identity at a recorded server time;
- a particular authenticated actor requested/authorized at a recorded time; and
- blindstats registered completion at a recorded time.

The system does **not** prove:

- that nobody learned protected information outside blindstats;
- that an exported secret was never copied;
- that an external handoff was secure;
- that the locked artifact was the only analysis performed;
- that the blinded dataset was the only data used;
- that a browser-generated artifact timestamp reflects trusted real-world
  chronology; or
- that a documented methodological choice was scientifically appropriate merely
  because blindstats enforced it.

The goal is auditable workflow evidence, not certification of researcher behavior.

## 18. User-interface principles

The current workflow UI follows this operating principle:

> **Show the current state. Show the current action. Show critical warnings.
> Move completed, explanatory, and technical detail out of the live task.**

The workflow uses separate destinations for:

- Blinding plan;
- Analysis roles, when independent role separation is relevant;
- Blinded package;
- Analysis lock;
- Unblinding; and
- Audit history.

The main panel renders one concern at a time.

The application intentionally avoids turning the live workflow into a long
methodology document. Deeper education belongs in project documentation,
walkthroughs, and future help material.

## 19. Deferred capabilities

The following are intentionally outside the first researcher-feedback release:

- multi-column blinding;
- multiple protection targets;
- alternative blinding transformations;
- simultaneous multiple active blinding workflows per Study;
- plan amendments / multiple active historical plan versions beyond v1;
- generalized role/capability editor UI;
- Teams / Organizations hierarchy;
- generic protected-information exposure ledger;
- workflow cancellation/closure states;
- complete Study archive/restore UI;
- server custody of source or blinded datasets;
- server custody of substantive analysis files;
- server storage of the plaintext unblinding secret;
- server storage of plaintext mappings;
- protected storage of final unblinding receipts;
- in-app secret or blinded-dataset transfer;
- emergency or partial unblinding;
- multi-party/quorum authorization;
- automated substantive evaluation of analysis artifacts;
- randomization/allocation workflows;
- data-collection tools;
- preregistration/freeze workflows; and
- broader RMS modules.

These are deferred rather than prohibited.

## 20. Infrastructure status and deferred infrastructure

### 20.1 Selected infrastructure

The current implementation uses:

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

### 20.2 Deliberately unselected or deferred infrastructure

The following remain deferred until a concrete requirement justifies them:

- general object storage for substantive research files;
- ephemeral transfer infrastructure;
- protected-file encryption architecture for in-app handoff;
- KMS/key-management service;
- generalized backup/restore policy beyond provider/project operations;
- product-level retention/deletion policy;
- deployment-provider-specific hardening; and
- formal incident-response operations.

The first deployment-hardening pass should review these boundaries without adding
new infrastructure merely for architectural completeness.

## 21. First-release success criteria: current status

The original server-backed milestone can now be assessed against implementation.

### Implemented

A research team can currently:

1. authenticate and create a Study;
2. use Study membership and capabilities;
3. create and activate immutable BlindingPlan v1;
4. configure a narrow two-party custodian/analyst split;
5. create a supported blinded package locally;
6. register the exact public receipt without uploading the substantive dataset;
7. preserve the unblinding secret outside server custody;
8. analyze using the blinded dataset outside blindstats;
9. register an exact analysis lock when required or otherwise desired;
10. request unblinding against the governed workflow;
11. authorize under independent or self-authorization policy;
12. locally authenticate/decrypt the mapping after authorization;
13. export the final unblinding receipt;
14. register safe completion metadata; and
15. inspect the durable workflow Audit history.

### Remaining before the first researcher-feedback deployment

The major remaining work is not another broad workflow build.

It is:

1. refresh stale project documentation;
2. perform deployment hardening;
3. configure and validate production authentication/redirect behavior;
4. deploy the research-preview environment; and
5. perform a focused production smoke test, including a meaningful two-account
   independent workflow.

## 22. Working architecture summary

The implemented first-release architecture is:

> **Study container + modular workflow shell + immutable Blinding plan + local
> substantive files + export-only secret + persistent exact artifact identity +
> capability-based authorization + database-enforced governance + server
> registration timestamps + durable Audit history**

The current design intentionally distinguishes:

- Study lifecycle from workflow state;
- protection target from transformed dataset variable;
- plan activation from creation of the blinded transformation;
- request from authorization from actual local release;
- authorization capability from unblinded-recipient capability;
- exact artifact identity from artifact contents;
- browser-generated artifact timestamps from database registration timestamps;
  and
- auditable workflow evidence from proof of researcher behavior.

This architecture is now sufficiently complete for a first researcher-feedback
release once documentation and deployment hardening are finished.
