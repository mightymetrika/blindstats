# Literature and Prior Art

- **Project:** blindstats
- **Status:** focused working review
- **Updated:** 2026-09-09

## 1. Purpose

This document reviews literature and existing software relevant to the design of
blindstats.

The review is intentionally product-oriented. Its purpose is not to establish
that analyst blinding is always necessary, nor to claim that blindstats is the
first software to support blinding. Instead, it asks what published methodology
and prior software can teach us about the workflow that blindstats should support.

The main design questions are:

1. What information should an analyst be blinded to?
2. What forms of analysis blinding exist, and what do they protect against?
3. When should analysis decisions be finalized relative to unblinding?
4. What should be locked, versioned, or made immutable?
5. Who should be able to authorize or perform unblinding?
6. What exceptions or alternative workflows are legitimate?
7. What should an audit trail record?
8. What related software already exists, and where does blindstats differ?

## 2. Scope and search approach

This is a focused narrative and prior-art review, not a systematic review.

The initial search was conducted on 2026-09-09 and emphasized:

- statistician and analyst blinding;
- blinded data analysis and blinded interpretation;
- statistical analysis plans and pre-unblinding finalization;
- research preregistration and immutable/frozen research records;
- blinding practices in physics and cosmology;
- role-based research systems and audit trails; and
- open-source tools that blind identifiers, labels, files, or analysis inputs.

Sources were prioritized when they directly described a workflow, identified a
failure mode, offered concrete recommendations, or represented implemented
software with design features relevant to blindstats.

This review should be updated as the project expands. It is not a patent search,
security review, regulatory assessment, or comprehensive inventory of research
software.

## 3. Main findings

### 3.1 The core rationale is broader than treatment concealment

The methodological rationale for blinding is to prevent knowledge that can
influence research behavior, judgments, analysis choices, or interpretation from
entering a stage of the research process where that knowledge is unnecessary.

Monaghan et al. (2021) review blinding across clinical research and emphasize
that blinding should be described in terms of who is blinded, what information is
withheld, and how the blinding is implemented. CONSORT reporting guidance makes
a similar point: labels such as "single blind" and "double blind" are ambiguous,
so reports should identify the people or functions that were actually blinded.

SPIRIT 2025 explicitly includes data analysts among the people whose blinding
status may matter in a randomized trial protocol.

**Implication for blindstats:** the platform should model blinding as a set of
protected information and permissions, not simply as a study-level Boolean
called `blinded`.

A future study model should be able to answer:

- Who is blinded?
- To what information?
- During which study state?
- Who is allowed to access the protected information?
- Under what condition may that access change?

### 3.2 Analysis blinding addresses a feedback loop between results and decisions

MacCoun and Perlmutter (2015) argued that blind analysis should be used more
widely to reduce experimenter bias. Dutilh, Sarafoglou, and Wagenmakers (2021)
develop this idea for experimental psychology.

Their central argument is especially relevant to blindstats: preregistration can
separate planned analyses from observed outcomes, but real data often contain
unexpected features that legitimately require analyst judgment. Analysis
blinding can preserve some flexibility because the analyst can inspect data and
refine an appropriate analysis while important outcome information remains
concealed.

Dutilh et al. describe analysis blinding as interrupting the feedback loop between
analysis choices and the outcome those choices produce. They describe multiple
approaches, including:

- withholding a subset of the data;
- adding noise;
- masking factor or condition labels;
- shifting cell means;
- shuffling variables; and
- providing decoy analyses or datasets.

These approaches do not provide identical protection.

**Implication for blindstats:** "analysis blinding" should eventually be treated
as a family of mechanisms rather than a synonym for label permutation.

The current schema-0.3 prototype implements one specific mechanism:

> categorical label permutation with neutral labels.

That is a valid and useful mechanism, but its protection boundary should be
stated precisely.

### 3.3 Neutral-label masking preserves data but does not hide all results

Dutilh et al. specifically discuss masking factor labels. Replacing meaningful
condition labels with neutral labels leaves the observed data intact and prevents
the analyst from knowing which substantive condition corresponds to a displayed
group.

However, the analyst can still see features such as:

- whether groups differ;
- approximate effect magnitude;
- statistical significance;
- variance differences;
- sample-size differences; and
- other characteristics that may indirectly reveal group identity.

The method therefore primarily conceals **substantive identity and direction
relative to the research hypothesis**, not the existence of a group difference.

This maps closely to blindstats v0.

**Implication for blindstats:** documentation should avoid suggesting that the
current transformation makes an analyst ignorant of all result-relevant
information. A future `BlindingPlan` could record the intended protection target,
for example:

- treatment/group identity;
- expected direction;
- outcome values;
- key parameter estimates;
- signal region;
- participant/source identity; or
- another study-specific target.

This is likely more useful than classifying a study as merely "blinded" or
"unblinded."

### 3.4 Good blinding preserves information needed for valid analysis

A recurring idea across psychology and physics is that blinding should conceal
enough information to protect against bias while preserving enough information
to conduct legitimate diagnostics.

Dutilh et al. emphasize that a blinding transformation can become counterproductive
if it destroys distributional or correlational features that analysts need for
model selection, diagnostics, transformations, or quality control.

Muir et al. (2020), writing about cosmological analyses, make the same principle
concrete at a different scale. Their blinding transformation is designed to hide
critical cosmological results while preserving internal consistency checks needed
to validate the analysis pipeline.

**Implication for blindstats:** the product should not pursue "maximum hiding" as
an abstract goal. The appropriate question is:

> What is the minimum information that must be concealed to protect the decision
> of interest while preserving the information needed for sound analysis?

This supports a risk- and purpose-based `BlindingPlan`.

### 3.5 Analysis decisions should be finalized before relevant information is revealed

Several literatures independently converge on the value of committing to
important analytical or interpretive decisions before the information that could
bias those decisions is revealed.

Gamble et al. (2017) recommend that statistical analysis plans include version
information, revision history, justification for revisions, and the timing of
revisions relative to interim analyses or other potentially revealing events.
They describe blind review as an opportunity to make final amendments before the
blind is broken; later deviations should be identified transparently.

Järvinen et al. (2014) describe blinded interpretation of trial results. Their
workflow asks investigators to develop interpretations while treatment labels
remain concealed, agree that there will be no further changes, document that
agreement, and only then break the treatment code.

Physics and cosmology use analogous ideas: critical results remain hidden until
analysis choices and validation procedures have been finalized.

**Implication for blindstats:** the existing analysis-lock concept has strong
methodological precedent even though the exact cryptographic/artifact design is
specific to blindstats.

The central semantic claim should remain narrow:

> this exact artifact was declared finalized under this blinding state before
> documented unblinding.

The software should not claim that the lock proves the artifact was the only
analysis ever conducted.

### 3.6 "Lock" should mean preserved historical identity, not a mutable flag

Open Science Framework registrations provide useful adjacent prior art. A
registration preserves a time-stamped, read-only version of a research plan or
project state. The editable research workspace can evolve separately rather than
silently changing the registered historical object.

This pattern is conceptually important for blindstats.

A locked analysis should not be represented only as:

`analysis.currentVersion.locked = true`

if later edits could make the same logical object appear to remain the artifact
that was locked.

The current browser-local prototype already avoids that problem by hashing exact
artifact bytes. A future server-backed system should preserve that principle.

**Implication for blindstats:** a lock should create a durable historical record
with its own identity. Later work should create a new version or submission, not
rewrite the identity of the locked artifact.

### 3.7 Blinding practice should be risk-proportionate, not universal

The BOTS project is particularly important for blindstats because it focuses
directly on trial statisticians.

Iflaifel et al. (2022) found substantial variation among UK clinical trials units.
Practical decisions depended on study design, interventions, outcomes, staffing,
resources, the statistician's other responsibilities, and interactions with
oversight groups.

The subsequent mixed-methods study and guidance (Iflaifel et al., 2023) did not
support a single rigid rule. Its overarching recommendation is that the decision
to blind or not blind a statistician should depend on the benefits and risks in
the particular trial. The work also describes multiple staffing models rather
than one universal division of labor.

Their quantitative component found no evidence that statistician blinding status
was associated with whether the primary result was statistically significant
(OR 1.02, 95% CI 0.49 to 2.13). The authors explicitly interpret this within a
broader risk-proportionate framework rather than as proof that blinding has no
value.

**Implication for blindstats:** the platform should facilitate blinding when it
serves the study, not require every project to instantiate the same workflow.

This argues for:

- configurable responsibilities;
- capability-based permissions underneath human-friendly roles;
- explicit documentation of the chosen blinding plan;
- documented exceptions; and
- avoiding claims that blinding is universally necessary.

### 3.8 Role separation is useful, but the roles should follow capabilities

Dutilh et al. describe a minimal two-party conceptual model: a data manager who
creates the blinded data and an analyst who works with it.

The BOTS studies show that real research organizations can require more complex
arrangements: trial statisticians, lead statisticians, independent or unblinded
statisticians, data monitoring committees, trial management groups, and other
participants may have different information needs.

Existing research platforms also separate permissions from broad project
membership. OSF distinguishes read, read+write, and administrator permissions.
OpenClinica implements study roles, role-based access, audit trails, and
electronic signatures.

**Implication for blindstats:** we should define capabilities first, then group
them into roles.

Candidate capabilities for the first server-backed model include:

- create/administer study;
- invite/remove members;
- configure blinding plan;
- create a blinded package;
- access blinded workflow metadata;
- register an analysis lock;
- request unblinding;
- authorize unblinding;
- access protected mapping/unblinded information;
- view audit events; and
- archive a study.

Possible role names can be chosen after these capabilities are settled.

### 3.9 Unblinding should be an explicit authorized event

SPIRIT recommends specifying the circumstances under which unblinding is
permissible and the procedure by which allocation is revealed.

This principle matters even outside clinical-trial emergency unblinding. The
general architectural idea is that unblinding should not occur simply because a
user happens to possess a button or file. It should be a deliberate workflow
event governed by a rule.

The BOTS work also emphasizes timing and legitimate circumstances in which some
statisticians or oversight personnel may need unblinded information while others
remain blinded.

**Implication for blindstats:** `unblinding_authorized` should remain distinct
from `unblinded`.

A future state sequence might be:

`setup -> blinded -> analysis_locked -> unblinding_authorized -> unblinded -> archived`

but the exact state machine should be designed after permissions and exceptions
are specified.

The audit record for authorization should eventually be capable of recording:

- study;
- actor;
- authorization type;
- prior study state;
- artifact/lock being authorized;
- time;
- reason or rule satisfied; and
- resulting state.

### 3.10 Exceptions should be modeled rather than treated as protocol failure

Clinical trials illustrate why unblinding sometimes needs exceptions: safety
monitoring, interim analyses, adaptive designs, and independent oversight can
require access to treatment information before the final analysis team is
unblinded.

BOTS describes working models in which one statistician can be unblinded while
another remains blinded.

**Implication for blindstats:** a mature system should distinguish:

- ordinary final unblinding;
- authorized partial/role-specific unblinding; and
- exceptional or early unblinding.

An exceptional event should leave an audit record. It should not require the
software to pretend that the original blind remained intact.

This does not need to be implemented in the first online release, but the data
model should avoid making it impossible.

## 4. Prior software and platforms

### 4.1 inBlindSight

- **Project:** AlexHenriques/inBlindSight
- **Type:** local Python GUI
- **Repository:** https://github.com/AlexHenriques/inBlindSight

inBlindSight generates random mappings between identifiers and labels and can use
a key file to blind or unblind Excel data or filenames. Its documentation
explicitly proposes a workflow in which group allocation is blinded, statistical
analysis is performed, and allocation is later recovered using the key.

It processes data locally.

**What blindstats can learn:**

- there is clear demand for approachable local blinding tools;
- reversible label/identifier mappings are established prior art;
- local processing is a useful privacy property.

**Difference from blindstats' current direction:**

inBlindSight centers on creating and applying a mapping. blindstats additionally
centers the identity of the blinded artifact, the exact pre-unblinding analysis
artifact, and a linked blind-lock-unblind audit chain.

### 4.2 BlindSpot

- **Project:** maddox-lab/BlindSpot
- **Type:** cross-platform file-name blinding application
- **Repository:** https://github.com/maddox-lab/BlindSpot

BlindSpot provides reproducible filename blinding for laboratory workflows,
including microscopy/image scoring. It creates a blinding key and supports later
unblinding while leaving file contents unchanged.

**What blindstats can learn:**

- filename blinding is another common protection target;
- laboratory workflows need low-friction blinding without requiring programming;
- a blinding system does not necessarily need to take custody of file contents.

### 4.3 blindanalysis

- **Project:** jimsalterjrs/blindanalysis
- **Type:** Perl utility
- **Repository:** https://github.com/jimsalterjrs/blindanalysis

This project renames files and writes the original-to-random-name mapping into a
CSV key. Its suggested workflow explicitly recommends moving the key to a trusted
location inaccessible to the person performing the analysis and returning it
after analysis.

**What blindstats can learn:**

This is close to blindstats' current file-mediated owner/analyst separation. It
demonstrates that manual custody of a mapping key is a simple and understandable
v0 mechanism, while also illustrating why a future platform might replace manual
key movement with permissions and controlled release.

### 4.4 blindr

- **Project:** U8NWXD/blindr
- **Type:** MATLAB filename-blinding scripts
- **Repository:** https://github.com/U8NWXD/blindr

blindr reversibly randomizes filenames, recommends moving the blinding key to a
trusted location, and later restores the relationship between blinded and
original filenames.

**What blindstats can learn:**

Again, separation of the key from the analyst is established practical prior art.
The distinguishing opportunity for blindstats is to make that separation part of
an auditable study workflow rather than only an operational instruction.

### 4.5 Smokescreen / LSST DESC blinding

- **Project:** LSSTDESC/Smokescreen
- **Type:** scientific blinding library
- **Repository:** https://github.com/LSSTDESC/Smokescreen

Smokescreen implements data-concealment methods for cosmological analysis,
including data-vector blinding and related methods developed in the cosmology
literature.

**What blindstats can learn:**

- sophisticated scientific applications may need to blind results rather than
  merely rename groups;
- blinding may be deeply integrated into an analysis pipeline;
- the correct transformation depends on what information must remain available
  for validation.

blindstats should therefore keep its long-term artifact/workflow architecture
general enough that other blinding mechanisms could eventually plug into it.

### 4.6 vazul

- **Project:** nthun/vazul
- **Type:** R package for analysis blinding
- **Repository:** https://github.com/nthun/vazul

The project describes masking and scrambling approaches intended to anonymize or
blind data while preserving analysis usefulness.

**What blindstats can learn:**

R-native tooling may be especially relevant to researchers who already conduct
their analyses in R. blindstats does not need to replace such tools; a later
architecture could potentially treat a blinding transformation as a pluggable or
externally produced artifact so long as its provenance and identity can be
validated.

### 4.7 Open Science Framework registrations

- **Project:** Open Science Framework / Center for Open Science
- **Type:** open-source research platform
- **Documentation:** https://help.osf.io/article/330-welcome-to-registrations

OSF registrations provide a strong adjacent model for freezing research state.
Submitted registrations are time-stamped and read-only; the frozen record is
separate from material that may continue to evolve. OSF also uses explicit
contributor permissions.

**What blindstats can learn:**

- freezing should create a durable historical object;
- permission to initiate/approve a transition can differ from permission to view
  or edit ordinary material;
- evolving work and frozen work should not share a mutable identity.

### 4.8 OpenClinica

- **Project:** OpenClinica/OpenClinica
- **Type:** open-source clinical data-management platform
- **Repository:** https://github.com/OpenClinica/OpenClinica

OpenClinica supports studies, role-based access controls, audit trails, and
electronic signatures. Its scope is much broader than blindstats and includes
clinical data capture and management.

**What blindstats can learn:**

- research platforms benefit from separating users, study membership, study
  roles, and audit events;
- role changes themselves are audit-relevant;
- events should record actor and time;
- regulated clinical infrastructure is substantially more complex than what
  blindstats should attempt in its first release.

**Design caution:** blindstats should not imitate an EDC system or imply that its
first server-backed release is appropriate for regulated clinical data merely
because it adopts familiar role/audit concepts.

## 5. What appears distinctive about blindstats

The review found several tools for:

- randomizing identifiers or filenames;
- creating blinding keys;
- masking condition labels;
- transforming analysis inputs;
- freezing preregistrations or other research records; and
- managing research users, permissions, and audit trails.

The review did **not** identify, in this focused search, an existing open-source
project whose central workflow is exactly:

> create a blinded analytic artifact -> preserve a protected mapping -> identify
> an exact finalized analysis artifact -> authorize/release the mapping -> retain
> a linked audit record across the entire sequence.

That observation should be treated cautiously. It is a finding from a focused
search, not a claim of exhaustive novelty.

The strongest current differentiation is therefore not the act of assigning
neutral labels by itself. It is the attempt to connect:

1. analyst blinding;
2. artifact identity;
3. pre-unblinding analysis commitment;
4. controlled unblinding; and
5. auditable provenance

into one coherent workflow.

## 6. Recommended design consequences

The literature and prior-art review supports the following decisions for the next
phase of blindstats.

### 6.1 Keep schema 0.3 as a valid narrow baseline

Do not replace the current categorical label-permutation protocol merely because
other forms of blinding exist.

Instead, describe it accurately as one blinding mechanism with a known protection
boundary.

### 6.2 Add a conceptual `BlindingPlan`

Before designing infrastructure, define what a study intends to protect.

Candidate fields could eventually include:

- blinding mechanism;
- protected information;
- blinded roles/capabilities;
- expected unblinding condition;
- authorized exceptions; and
- notes about indirect unblinding risk.

This should remain conceptual until the study model is designed.

### 6.3 Define capabilities before fixed role names

The evidence does not support one universal staffing model.

Design permissions first. Then create convenient roles that group those
permissions.

### 6.4 Preserve a separate unblinding-authorization transition

Do not collapse "authorized to unblind" and "unblinded" into a single state.

This supports approval workflows, delayed release, auditability, and later
server-controlled key access.

### 6.5 Treat locks as immutable historical records

A lock should preserve the identity of exactly what was committed at that point.

Later revisions should become new artifacts or submissions rather than silently
modifying the locked object.

### 6.6 Record exceptions rather than hiding them

Future early or partial unblinding should be an explicit event with a reason and
audit trail.

### 6.7 Keep research-file contents browser-local in the first server-backed slice

Nothing in the literature reviewed creates a methodological reason for blindstats
to take custody of full research datasets in order to implement study membership,
permissions, workflow states, server timestamps, and audit events.

A sensible first online architecture therefore remains:

**Server-side:**

- user accounts;
- teams;
- studies;
- study membership and permissions;
- workflow state;
- public/safe workflow metadata;
- artifact hashes and small audit records;
- authorization events; and
- server timestamps.

**Browser/local side:**

- source datasets;
- blinded datasets; and
- substantive analysis files.

Protected mapping/key material and the final readable mapping require a separate
security design before they are moved into ordinary server custody.

## 7. Questions the study-workflow specification should answer next

The next design document should resolve:

1. What is the minimum `Study` record?
2. What capabilities exist?
3. Which capabilities are mutually incompatible while a user is blinded?
4. Can one person hold multiple capabilities?
5. Who can create a blinded package?
6. Who can submit an analysis lock?
7. Who can request unblinding?
8. Who can authorize it?
9. Can request and authorization be performed by the same person?
10. What exact condition moves a study from `blinded` to `analysis_locked`?
11. Can there be multiple analysis locks?
12. What happens if the locked analysis is revised before unblinding?
13. What happens if early/partial unblinding is required?
14. Which events are append-only audit events?
15. Which timestamps need to be server-trusted?
16. Which JSON artifacts should be persisted server-side?
17. Which protected values should explicitly **not** be placed in ordinary
    application/database storage in the first release?

These questions should be answered before selecting an ORM, authentication
provider, PostgreSQL host, object store, or key-management service.

## 8. References

### Methodology and reporting

Chan, A.-W., Tetzlaff, J. M., Altman, D. G., et al. (2025). SPIRIT 2025
statement: Updated guideline for protocols of randomized trials. *JAMA*.

Dutilh, G., Sarafoglou, A., & Wagenmakers, E.-J. (2021). Flexible yet fair:
blinding analyses in experimental psychology. *Synthese, 198*, 5745-5772.
https://doi.org/10.1007/s11229-019-02456-7

Dutilh, G., Annis, J., Brown, S. D., et al. (2019). The quality of response time
data inference: A blinded, collaborative assessment of the validity of cognitive
models. *Psychonomic Bulletin & Review, 26*, 1051-1069.
https://doi.org/10.3758/s13423-017-1417-2

Gamble, C., Krishan, A., Stocken, D., et al. (2017). Guidelines for the content
of statistical analysis plans in clinical trials. *JAMA, 318*(23), 2337-2343.
https://doi.org/10.1001/jama.2017.18556

Iflaifel, M., Partlett, C., Bell, J., et al. (2022). Blinding of study
statisticians in clinical trials: A qualitative study in UK clinical trials
units. *Trials, 23*, 535. https://doi.org/10.1186/s13063-022-06481-9

Iflaifel, M., Sprange, K., Bell, J., Cook, A., Gamble, C., Julious, S. A.,
Juszczak, E., Linsell, L., Montgomery, A., & Partlett, C. (2023). Developing
guidance for a risk-proportionate approach to blinding statisticians within
clinical trials: A mixed methods study. *Trials, 24*, 71.
https://doi.org/10.1186/s13063-022-06992-5

Järvinen, T. L. N., Sihvonen, R., Bhandari, M., Sprague, S., Malmivaara, A.,
Paavola, M., Schünemann, H. J., & Guyatt, G. H. (2014). Blinded interpretation of
study results can feasibly and effectively diminish interpretation bias.
*Journal of Clinical Epidemiology, 67*(7), 769-772.
https://doi.org/10.1016/j.jclinepi.2013.11.011

MacCoun, R. J. (1998). Biases in the interpretation and use of research results.
*Annual Review of Psychology, 49*, 259-287.
https://doi.org/10.1146/annurev.psych.49.1.259

MacCoun, R., & Perlmutter, S. (2015). Blind analysis: Hide results to seek the
truth. *Nature, 526*, 187-189. https://doi.org/10.1038/526187a

Moher, D., Hopewell, S., Schulz, K. F., et al. (2010). CONSORT 2010 explanation
and elaboration: Updated guidelines for reporting parallel group randomised
trials. *BMJ, 340*, c869. https://doi.org/10.1136/bmj.c869

Monaghan, T. F., Agudelo, C. W., Rahman, S. N., Wein, A. J., Lazar, J. M.,
Everaert, K., & Dmochowski, R. R. (2021). Blinding in clinical trials: Seeing the
big picture. *Medicina, 57*(7), 647.
https://doi.org/10.3390/medicina57070647

Muir, J., Bernstein, G. M., Huterer, D., et al. (2020). Blinding multiprobe
cosmological experiments. *Monthly Notices of the Royal Astronomical Society,
494*(3), 4454-4470. https://doi.org/10.1093/mnras/staa965

Roodman, A. (2003). Blind analysis in particle physics. arXiv:physics/0312102.
https://arxiv.org/abs/physics/0312102

### Platforms and software

Center for Open Science. Open Science Framework registrations.
https://help.osf.io/article/330-welcome-to-registrations

OpenClinica. Open-source electronic data capture and clinical data-management
platform. https://github.com/OpenClinica/OpenClinica

AlexHenriques/inBlindSight. Data masking tool for blind analysis.
https://github.com/AlexHenriques/inBlindSight

maddox-lab/BlindSpot. Reproducible filename blinding.
https://github.com/maddox-lab/BlindSpot

jimsalterjrs/blindanalysis. Simple filename blinding utility.
https://github.com/jimsalterjrs/blindanalysis

U8NWXD/blindr. Reversible filename randomization.
https://github.com/U8NWXD/blindr

LSSTDESC/Smokescreen. Data-concealment/blinding methods for cosmological
analysis. https://github.com/LSSTDESC/Smokescreen

nthun/vazul. R package for analysis blinding.
https://github.com/nthun/vazul
