# Server-Backed Study and Blinding Workflow v0

- **Project:** blindstats
- **Status:** first design draft
- **Scope:** first server-backed study workflow
- **Current browser-local artifact schema:** `0.3`
- **Updated:** 2026-09-09

## 1. Purpose

This document defines the first server-backed study/workflow architecture for blindstats.

The goal is to place the proven browser-local blinding protocol inside a persistent study, membership, authorization, workflow-state, and audit architecture without prematurely taking custody of substantive research files or protected unblinding information.

The current scientific sequence remains:

> **Blind → analyze while blinded → optionally lock an exact analysis artifact → authorize unblinding → unblind → document**

The first online release should strengthen coordination and auditability while preserving the current protocol's narrow, inspectable artifact relationships.

This document is a workflow and requirements specification. It does **not** select a database provider, ORM, authentication provider, object-storage provider, or server-side key-management system.

See also:

- [`blinding-workspace-v0.md`](blinding-workspace-v0.md)
- [`analysis-lock-v0.md`](analysis-lock-v0.md)
- [`unblinding-v0.md`](unblinding-v0.md)
- [`literature-and-prior-art.md`](literature-and-prior-art.md)
- [`vision.md`](vision.md)

## 2. Architectural principle: Study versus workflow

A **Study** is the durable research and collaboration container.

A **Workflow** is a specific research process operating within a Study.

Blinding is the first workflow implemented within a Study, but it should not define the Study itself.

This separation is intentional. Future Study workflows may include, for example:

- random assignment;
- allocation concealment and allocation release;
- preregistration or protocol-freeze workflows;
- data-collection tools;
- study documentation and versioning;
- additional research-integrity workflows; and
- other study-management capabilities.

The long-term direction is therefore closer to a study-management platform with multiple research workflows than to a single-purpose blinding utility.

For the first online release, blindstats may support only one active blinding workflow per Study in the user interface. The underlying domain model should avoid making that limitation permanent.

## 3. First-release scope

The first server-backed release should add:

- authenticated users;
- persistent Studies;
- team/study membership;
- server-enforced permissions;
- a persistent BlindingPlan;
- explicit blinding-workflow state;
- persistent public-receipt records;
- persistent analysis-lock records;
- unblinding-authorization records;
- server timestamps for workflow events;
- durable audit history; and
- known-exposure history for protected information released through blindstats.

The first release should **not** require blindstats to store substantive research-file contents.

In particular, the initial architecture should keep the following local to the user's browser/device:

- source datasets;
- generated blinded datasets;
- substantive analysis files;
- the unblinding secret;
- plaintext original-to-neutral mappings; and
- the plaintext contents of the final unblinding receipt, unless a later design deliberately adds protected-artifact storage.

The first online release is therefore a persistent **coordination, authorization, integrity-metadata, and audit layer**, not a general research-data repository.

## 4. Enforcement boundary

blindstats should distinguish among three kinds of controls.

### 4.1 Hard system invariants

These are properties blindstats must enforce because allowing an override would make the system's own integrity claims false or misleading.

Examples include:

- supported cryptographic operations must validate correctly;
- exact artifact hashes must be computed and compared correctly;
- receipt relationships must be internally consistent;
- server-side permission checks must be applied to protected actions;
- immutable historical records must not be silently overwritten;
- a previously recorded workflow event must not disappear through ordinary editing;
- a later artifact revision must not silently retain the identity of an earlier locked artifact; and
- if the first-release architecture declares the unblinding secret non-persistent, the server must not retain its contents.

Integrity-critical operations should fail closed rather than silently fall back to weaker behavior.

### 4.2 Study-chosen rules that become enforceable commitments

Some methodological and governance choices legitimately vary across studies.

Examples include:

- who is intended to remain blinded;
- who will custody the unblinding secret;
- whether an analysis lock is required before ordinary unblinding;
- whether independent authorization is required;
- who may authorize unblinding; and
- who may receive unblinded information.

blindstats should provide evidence-informed defaults and warnings but allow reasonable study-to-study variation.

Once a Study adopts one of these rules in an active BlindingPlan, blindstats should enforce that declared rule until it is prospectively amended.

### 4.3 Defaults, explanations, and warnings

Where reasonable researchers may make different choices, blindstats should generally guide rather than prohibit.

The interface should:

- use sensible defaults;
- explain the methodological consequence of weaker settings;
- warn when a choice reduces role separation or blinding protection;
- require acknowledgment for important deviations when appropriate; and
- preserve the selected choice and acknowledgment in the audit history.

The application should not claim that one configuration is universally correct.

## 5. Conceptual domain model

The exact relational schema is deferred, but the server-backed design should support at least the following concepts.

### 5.1 Study-level concepts

- `User`
- `Team` or organizational container
- `TeamMembership`
- `Study`
- `StudyMembership`
- study-level capabilities/permissions

### 5.2 Blinding-workflow concepts

- `BlindingWorkflow`
- `BlindingPlan`
- `BlindingPlanVersion`
- `BlindingTarget`
- `BlindingTransformation`
- `ArtifactRecord`
- `AnalysisLock`
- `UnblindingAuthorization`
- `UnblindingEvent`
- `ProtectedInformationExposure`
- `AuditEvent`

The names above are conceptual and do not commit the implementation to specific database table or TypeScript type names.

## 6. BlindingPlan

The BlindingPlan defines the intended governance and protection rules for one blinding workflow.

It should be readable by study members with appropriate permissions and should be preserved as a versioned historical record.

### 6.1 Blinding targets

The current browser-local implementation blinds one selected categorical column.

The first server-backed implementation may retain that user-facing limitation so the database transition can be completed without simultaneously expanding the blinding algorithm.

However, the conceptual plan should represent:

```text
blindingTargets[]
```

rather than permanently defining a single `selectedColumn`.

This allows later support for multiple blinded variables, which may be especially useful in single-group or observational designs where researchers may want to mask several substantive variables such as demographic or geographic categories.

For the first implementation, the supported configuration may simply require:

```text
blindingTargets.length === 1
```

The single-target limitation should be documented as an implementation scope, not a permanent methodological requirement.

### 6.2 Protection purpose and rationale

The plan may include an optional short rationale describing why the selected information is being blinded.

Examples include:

- conceal treatment identity during statistical analysis;
- conceal geographic category identity;
- reduce the possibility that model/reporting decisions are influenced by substantive group labels.

This field should be optional and should not require users to write an extensive methodological justification.

### 6.3 Intended blinded members

The plan should identify which study members are intended to remain blinded to the protected mapping during the blinded-analysis phase.

Defaults should encourage separation between:

- members conducting blinded analysis; and
- members who custody or can access the unblinding secret.

The exact team structure must remain configurable because study staffing varies.

Intended blinding is a declared governance condition, not proof of a person's actual knowledge outside blindstats.

### 6.4 Secret custody

The BlindingPlan should identify one or more designated custodians of the unblinding secret.

For the first online release:

- the secret is generated in the browser;
- the secret is exported to the designated custodian;
- the server does not retain the secret contents; and
- the audit record documents the relevant workflow event and designated custodian without storing the secret itself.

A configuration in which an intended blinded analyst is also the secret custodian should be allowed only with a clear warning and recorded acknowledgment.

The system should not claim to prove that a custodian actually stored the exported secret safely.

Loss of the export-only secret may make ordinary unblinding difficult or impossible. This is a deliberate custody consequence that should be clearly communicated.

### 6.5 Analysis-lock policy

The BlindingPlan should make the pre-unblinding analysis-lock requirement configurable.

Recommended/default configuration:

```text
Require a qualifying analysis lock before ordinary unblinding: Yes
```

Alternative configuration:

```text
Require a qualifying analysis lock before ordinary unblinding: No
```

Turning the requirement off should produce a concise methodological warning and a durable record of the decision.

A mandatory lock is not universally sufficient evidence of a strong analysis process. In the first release, blindstats will establish the exact identity of a declared artifact but will not assess whether that artifact is scientifically meaningful or complete.

The analysis-lock mechanism therefore documents a researcher's declared pre-unblinding artifact rather than certifying its substantive adequacy.

### 6.6 Unblinding-authorization policy

The BlindingPlan should define the authorization rule used before ordinary unblinding.

Initial choices:

**Independent authorization — recommended/default**

- a user with the required authorization capability must approve unblinding;
- the user who submitted the qualifying analysis lock may not approve their own unblinding when the plan requires independence.

**Self-authorization permitted**

- a user with the required capability may both submit the analysis lock and authorize unblinding.

The interface should explain that independent authorization provides stronger separation between analysis and release.

Multi-party authorization may be supported later if concrete use cases justify it. The domain model should not make it impossible.

### 6.7 Permitted unblinded recipients

Authorization to approve unblinding and permission to receive the released mapping should be treated as separate capabilities.

A Study may therefore permit a principal investigator, administrator, or other member to approve release without requiring that person to receive the mapping.

The plan should identify which members or capabilities may receive unblinded information through blindstats.

### 6.8 Recommended initial defaults

The first-release interface should generally default toward:

- blinded analysts separate from secret custodians;
- an analysis lock required before ordinary unblinding;
- independent unblinding authorization;
- limited unblinded access; and
- export-only custody of the unblinding secret.

These defaults guide users toward stronger separation while preserving the ability to document justified alternatives.

## 7. Plan finalization, versioning, and amendment

### 7.1 Setup state

While the workflow is in `setup`, authorized users may edit the draft BlindingPlan.

The plan is not yet an immutable historical commitment.

### 7.2 Activation

When the plan is complete and the blinding transformation is successfully created/registered, blindstats should preserve the exact active plan as an immutable `BlindingPlanVersion`.

The initial active version may be represented conceptually as:

```text
BlindingPlan v1
```

Activation should record at least:

- plan version identity;
- workflow identity;
- Study identity;
- actor;
- server timestamp;
- selected blinding configuration;
- intended blinded members;
- secret custodian configuration;
- analysis-lock policy;
- authorization policy;
- permitted unblinded recipients; and
- warnings/deviations acknowledged at activation.

The workflow then leaves `setup`.

### 7.3 Historical versions are not edited in place

After activation, a historical plan version must never be silently rewritten.

If a meaningful governance setting changes, the system should create a new plan version or amendment that records:

- what changed;
- who made the change;
- server timestamp;
- workflow state at the time;
- optional or required reason, as appropriate; and
- any warning or weaker-setting acknowledgment.

For example, changing from independent authorization to self-authorization after blinding begins must not make it appear that self-authorization was the original plan.

### 7.4 Prospective amendments

Examples of settings that may be prospectively amended within an existing workflow include:

- authorization personnel;
- permitted recipients;
- secret custodian;
- lock requirement; and
- independent versus self-authorization policy.

The active plan version used to evaluate a later action should be identifiable from the audit record.

### 7.5 Changes that create a new workflow/transformation

Some changes should not be treated as ordinary amendments after a blinded package exists.

Examples include changing:

- the underlying source artifact;
- the actual blinded variable(s);
- the generated mapping;
- the blinding transformation mechanism; or
- another identity-defining element of the generated blinded artifact.

Those changes describe a new blinding transformation and should preserve the prior transformation and its history rather than rewriting it.

## 8. Capabilities and permissions

Capabilities should be defined before fixed role names.

Initial conceptual capabilities include:

- administer ordinary Study metadata;
- manage Study membership;
- assign workflow capabilities;
- configure the BlindingPlan;
- create/register a blinded package;
- participate in blinded analysis;
- submit an analysis lock;
- request unblinding;
- authorize unblinding;
- receive/access released unblinded information; and
- view audit history.

Convenient role bundles may later group these capabilities into names such as Study Administrator, Blinded Analyst, Secret Custodian, or Unblinding Approver.

The implementation should not assume that study administration implies access to unblinded information.

Likewise, authorization to approve unblinding should not automatically imply permission to receive the released mapping.

Permissions must ultimately be enforced server-side. Hiding a control or value in the browser is not sufficient authorization.

## 9. Authorization versus known exposure

Current authorization and historical knowledge are different concepts.

Removing a user's permission to access unblinded information cannot make that person blinded again after the information has already been released to them.

blindstats should therefore distinguish:

- **authorization:** what a member is currently permitted to do or receive; and
- **known exposure:** what protected information blindstats has recorded as released to that member.

Known exposure should be monotonic for a given protected workflow event. Ordinary permission changes must not erase it.

This distinction also permits future support for partial or role-specific unblinding in which one member becomes unblinded while another remains intended to stay blinded.

blindstats can record exposure that occurs through blindstats. It cannot certify that a person did not learn protected information elsewhere.

## 10. Workflow state machine

The first blinding workflow should use a small explicit state machine.

Core states:

```text
setup
  ↓
blinded
  ↓
unblinding_authorized
  ↓
unblinded
```

`AnalysisLock` is treated as a durable artifact/event rather than a universal workflow state.

This allows the plan to determine whether a qualifying lock is required and avoids making the workflow state model depend on the eventual number of analysis locks.

### 10.1 `setup`

Meaning:

- the workflow exists;
- the plan is still being configured;
- no active blinded transformation has yet been registered.

Permitted actions may include:

- configure plan;
- assign relevant permissions;
- prepare/generate a blinded package; and
- cancel the workflow.

### 10.2 Transition: `setup → blinded`

The transition should require:

- a sufficiently complete BlindingPlan;
- required membership/capability assignments for the selected configuration;
- successful creation/validation of a supported blinded package;
- registration of the corresponding public receipt;
- preservation of the active plan version; and
- acknowledgment of required custody/warning messages.

The server should create a durable, server-timestamped activation/blinding event.

### 10.3 `blinded`

Meaning:

- a valid blinding transformation is active;
- the public receipt is registered;
- blinded analysis may proceed;
- no ordinary unblinding authorization has yet been granted.

While `blinded`, users may, subject to permissions and the active plan:

- conduct analysis outside blindstats;
- submit one or more analysis-lock records;
- amend permitted governance settings prospectively;
- request unblinding; and
- close the workflow without unblinding.

### 10.4 AnalysisLock event

An `AnalysisLock` records an exact locally supplied analysis artifact without requiring blindstats to persist the artifact contents.

At minimum, it should preserve:

- lock identity;
- Study/workflow identity;
- associated blinding transformation;
- exact public-receipt identity;
- analysis artifact filename;
- analysis artifact SHA-256;
- analysis artifact byte length;
- optional short description/declaration;
- submitting user; and
- server timestamp.

A useful declaration may be:

> I am registering this artifact as an analysis record intended to precede unblinding.

blindstats should not attempt to determine whether the artifact is a complete or scientifically adequate analysis.

If the active plan requires a qualifying lock, unblinding authorization is not permitted until the required lock condition is satisfied.

### 10.5 Transition: `blinded → unblinding_authorized`

This transition requires:

- a valid active plan;
- a user with the required authorization capability;
- satisfaction of the plan's lock policy;
- satisfaction of the plan's independent/self-authorization policy; and
- any required warning acknowledgments.

The authorization record should identify:

- authorizing user;
- active plan version;
- relevant analysis lock(s), if applicable;
- workflow state at authorization;
- authorization policy applied; and
- trusted server timestamp.

Authorization should be a durable event even if actual unblinding follows immediately.

### 10.6 `unblinding_authorized`

Meaning:

- ordinary release of the protected mapping has been approved under the active plan;
- the mapping has not necessarily yet been successfully decrypted/released through blindstats.

This state should remain distinguishable from `unblinded` because approval and actual information release are separate events.

### 10.7 Transition: `unblinding_authorized → unblinded`

A permitted user supplies the export-only unblinding secret locally.

The browser:

- validates the relevant workflow artifacts;
- authenticates/decrypts the sealed mapping;
- displays the readable mapping to a permitted recipient; and
- creates the final unblinding receipt.

The server should record successful completion without requiring storage of the plaintext mapping.

### 10.8 `unblinded`

Meaning:

- blindstats has recorded successful authorized release of the mapping through the workflow.

The audit record should preserve the release event and known recipient exposure.

The state does not imply that every study member has become unblinded.

## 11. Workflow closure without unblinding

A workflow should not be forced to reveal its mapping merely because work has stopped.

The design should permit terminal closure without unblinding.

Conceptually useful outcomes include:

```text
cancelled
closed_without_unblinding
```

A workflow may be cancelled during setup.

A blinded workflow may be closed without release if the study is discontinued, analysis is abandoned, or the team otherwise elects not to unblind.

Closure should be explicit, server-timestamped, and auditable.

The exact naming and implementation of terminal states may be finalized when the state model is implemented.

## 12. Study lifecycle

Study lifecycle is separate from blinding-workflow state.

Initial lifecycle concepts:

```text
active
archived
```

Archiving a Study should not be treated as equivalent to unblinding.

This separation also allows a future Study to contain multiple workflows with different histories.

## 13. First-release artifact and persistence boundary

Research artifacts have two conceptually distinct layers:

1. artifact identity/metadata; and
2. artifact contents.

The first online release should primarily persist the first layer.

### 13.1 Server-persisted information

The server may persist:

- users/accounts;
- teams and memberships;
- Studies and Study membership;
- capabilities/permissions;
- BlindingPlan versions;
- workflow state;
- transformation identifiers;
- exact public-receipt representation;
- parsed public-receipt metadata for querying;
- analysis-lock records/receipts;
- artifact filenames, hashes, and byte lengths;
- unblinding requests and authorizations;
- final unblinding-event metadata;
- final receipt hash/identity;
- known-exposure records; and
- append-only/durable audit events.

### 13.2 Browser-local/export-only information

The first release should keep the following outside persistent server custody:

- source dataset contents;
- blinded dataset contents;
- analysis artifact contents;
- unblinding secret/key material;
- plaintext mapping; and
- final unblinding receipt plaintext, unless protected server-side storage is deliberately added later.

### 13.3 Exact-byte identity-bearing artifacts

The existing protocol hashes exact artifact bytes.

If the server stores an identity-bearing JSON artifact such as the public blinding receipt, it must preserve the exact submitted UTF-8 representation used in the integrity chain.

Parsed or normalized JSON may also be stored for querying, but it must not replace the exact representation used to compute the artifact hash.

Equivalent JSON that has been reformatted is not byte-identical.

## 14. Unblinding secret and mapping custody

The unblinding secret is the clearest example of an export-only protected artifact in the first release.

The system should:

- generate the secret locally;
- require the user to export it;
- clearly warn that loss may prevent ordinary unblinding;
- record that the workflow reached the export/custody step;
- identify the designated custodian; and
- avoid storing the secret contents server-side.

The plaintext mapping should also not be automatically persisted server-side in the first release.

After authorized unblinding, the mapping is revealed locally and may be included in an exported unblinding receipt.

This is important because the mapping may itself contain sensitive or re-identifying information. A blinded variable could represent treatment, location, demographic categories, or another characteristic whose identity the research team intentionally protected.

Not persisting the plaintext mapping reduces the protected information exposed by a compromise of the blindstats server.

## 15. Final unblinding receipt

The current browser-local protocol produces a final unblinding receipt containing the readable mapping.

The server-backed workflow should preserve this functionality.

For the first release:

- the readable final receipt is generated locally;
- the user may export/download it;
- the server may record its SHA-256 and other non-plaintext identity metadata;
- the server records the successful unblinding event and recipient exposure; and
- the server need not retain the receipt's readable contents.

A later protected-artifact storage design may revisit this boundary.

## 16. Audit model

The first online release should create durable audit events for important workflow actions.

Potential event types include:

- Study created;
- Study metadata changed;
- membership added/removed;
- capability granted/revoked;
- blinding workflow created;
- BlindingPlan created;
- BlindingPlan activated;
- BlindingPlan amended;
- warning/deviation acknowledged;
- blinding transformation registered;
- public receipt registered;
- unblinding secret generated/export step completed;
- analysis lock submitted;
- unblinding requested;
- unblinding authorized;
- successful unblinding;
- protected information released to a recipient;
- workflow cancelled;
- workflow closed without unblinding; and
- Study archived/restored.

Each audit event should generally capture:

- event identity;
- Study identity;
- workflow identity where applicable;
- actor;
- server timestamp;
- event type;
- relevant plan version;
- relevant artifact or authorization identifiers;
- safe structured metadata; and
- relationship to prior/superseded records where relevant.

Audit records must be designed so they do not themselves leak the protected mapping, secret key, or sensitive research-file contents.

## 17. Trusted chronology and claim boundaries

The server-backed release may provide server-generated timestamps for persistent workflow actions.

This is stronger than the current browser-only timestamps because the chronology is no longer based solely on the user's local browser clock.

The system can establish facts such as:

- a particular receipt was registered with the server at a recorded time;
- a particular artifact hash was declared locked at a recorded time;
- a particular user authorized release at a recorded time; and
- blindstats recorded successful mapping release at a recorded time.

The system cannot prove:

- that nobody learned protected information outside blindstats;
- that a local secret was not copied;
- that the locked artifact was the only analysis conducted;
- that an external statistical program used only the documented blinded data;
- that a user safely retained an exported secret; or
- that a scientifically weak configuration was methodologically appropriate merely because it was documented.

The goal is auditable workflow evidence, not certification of researcher behavior.

## 18. User-interface principles

The interface should make the stronger workflow easy to choose without overwhelming users with infrastructure details.

User-facing text should focus on:

- what the user needs to do;
- what a setting changes;
- what information is protected;
- what is stored versus export-only;
- genuine security/custody warnings; and
- methodological consequences of weaker settings.

The UI should not repeatedly narrate internal architecture or design history.

Recommended settings should be clearly marked.

Warnings should be concise and specific rather than alarmist.

When a user chooses a weaker but permitted configuration, the application should allow the choice after appropriate acknowledgment and preserve that choice in the Study record.

## 19. Deferred capabilities

The following are intentionally outside the first server-backed milestone unless implementation experience shows that one is necessary earlier:

- multi-column blinding in the user interface;
- alternative blinding transformations;
- simultaneous multiple active blinding workflows per Study;
- server custody of source or blinded datasets;
- server custody of substantive analysis files;
- server storage of the unblinding secret;
- server-controlled decryption/key release;
- server storage of plaintext mappings;
- protected storage of final unblinding receipts;
- emergency or partial unblinding workflows;
- multi-party approval;
- complex quorum rules;
- detailed policy templates by study design;
- automated substantive evaluation of analysis artifacts;
- randomization/allocation workflows;
- data-collection tools;
- preregistration/freeze workflows; and
- broader study-management modules.

These are deferred rather than prohibited.

## 20. Infrastructure decisions intentionally deferred

The following should be selected only after the workflow requirements are stable enough to make the tradeoffs concrete:

- PostgreSQL provider;
- ORM/query layer;
- authentication provider;
- authorization implementation details;
- deployment provider;
- object storage;
- protected-file encryption;
- key-management/KMS provider;
- backup/restore strategy;
- retention/deletion implementation; and
- incident-response operations.

A relational database remains a strong fit for persistent metadata because the domain is primarily relationships among users, teams, Studies, memberships, capabilities, plans, transformations, artifacts, workflow events, and audit records.

## 21. First-release success criteria

The first server-backed milestone should be considered successful if a research team can:

1. authenticate and create a Study;
2. add study members and assign capabilities;
3. create and activate a versioned BlindingPlan;
4. create a supported blinded package locally;
5. register the public receipt without uploading the substantive dataset;
6. preserve the unblinding secret outside server custody;
7. analyze using the blinded data outside blindstats;
8. optionally or mandatorily submit a qualifying analysis lock according to the active plan;
9. request and authorize unblinding under the plan's declared policy;
10. locally decrypt and reveal the mapping after authorization;
11. export the final unblinding receipt;
12. retain persistent server-side records linking the plan, transformation, artifact identities, lock, authorization, release event, and server timestamps; and
13. inspect an audit history that documents what blindstats knows occurred without exposing the secret or plaintext mapping.

## 22. Working design summary

The first server-backed blindstats release should strengthen the existing browser-local scientific protocol without unnecessarily expanding server custody.

The core design is:

> **Study container + modular workflows + configurable BlindingPlan + local research files + export-only secret + persistent artifact identity + server-enforced declared rules + trusted workflow timestamps + durable audit history**

The design intentionally distinguishes:

- Study lifecycle from workflow state;
- authorization from known exposure;
- methodological defaults from hard system invariants;
- plan amendments from historical rewriting;
- artifact identity from artifact contents; and
- authorization to release from permission to receive protected information.

The resulting platform should make stronger analyst-blinding practice easier and more transparent while documenting weaker or alternative configurations accurately when researchers deliberately choose them.
