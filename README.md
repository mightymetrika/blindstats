# blindstats

**Open-source research software for auditable analyst blinding.**

blindstats helps research teams separate statistical analysis decisions from knowledge of substantively meaningful study labels and document the path from blinding through analysis lock and authorized unblinding.

The current application combines:

- **browser-local research-file processing** for blinding, analysis locking, and unblinding; with
- **persistent server-backed governance** for Studies, roles/capabilities, immutable blinding plans, workflow state, artifact identities, unblinding authorization, and audit history.

The current scientific sequence is:

> **Plan → blind → analyze while blinded → lock → authorize → unblind → document**

blindstats is in **early development** and is being prepared for an initial researcher-feedback release. It should not yet be treated as production-hardened infrastructure for sensitive, confidential, regulated, or client research data.

## Why analyst blinding?

Statistical analyses often involve legitimate researcher decisions, including model specification, transformations, exclusions, sensitivity analyses, presentation, and reporting choices.

When analysts already know which labels correspond to treatments, comparison groups, favored hypotheses, or other substantively meaningful conditions, those decisions can be influenced consciously or unconsciously by the results they produce.

Analyst blinding is one tool for reducing that opportunity. It is not a substitute for appropriate study design, preregistration when relevant, transparent reporting, replication, or researcher judgment.

blindstats is intended to make analyst blinding easier to conduct, govern, document, and audit.

## Current product model

A **Study** is the durable research workspace.

**Blinding** is the first research-specific workflow implemented inside a Study. The longer-term product direction is a modular research-management environment in which additional workflows could eventually operate inside the same Study container. Those broader modules are intentionally deferred until there is researcher feedback supporting them.

The current blinding workflow uses these persistent states:

```text
setup
  ↓
blinded
  ↓
unblinding_authorized
  ↓
unblinded
```

An **analysis lock** is a durable artifact/event rather than a universal workflow state. A blinded workflow may have more than one registered analysis lock.

A central governance distinction is:

> **Request ≠ authorization ≠ exposure**

An unblinding request does not itself authorize unblinding, and authorization does not itself release the protected mapping.

## Current workflow

### 1. Create a Study and blinding workflow

Authenticated users can create persistent Studies and open a Blinding workflow inside a Study.

### 2. Configure and activate a Blinding plan

The plan records the protection target and governance choices that apply before the blinded package is created.

Current policy choices include:

- whether an analysis lock is required before unblinding; and
- whether unblinding requires **independent authorization** or permits **self-authorization**.

The current UI recommends requiring an analysis lock and using independent authorization. Weaker configurations are permitted only after an explicit acknowledgement.

Activating the plan creates an immutable historical plan version.

For independent authorization, the database requires a genuine two-actor setup: the Study must include different authenticated users who can request and authorize unblinding.

### 3. Create the blinded package locally

The blinding custodian selects a local UTF-8 CSV and one categorical column to blind.

The browser creates:

- a **blinded CSV**;
- a **public blinding receipt** containing transformation metadata, artifact hashes, and an encrypted mapping; and
- an **unblinding secret** containing the key needed to decrypt that mapping.

The source dataset, blinded dataset, plaintext mapping, and unblinding secret are not uploaded to the application.

After local generation, blindstats persistently registers the exact public blinding receipt and safe transformation metadata and moves the workflow to `blinded`.

### 4. Analyze while blinded

The blinded analyst receives the blinded dataset outside blindstats and performs the substantive analysis using their normal analysis tools.

The exact registered public blinding receipt is available through the persistent workflow; it does not need to be separately transferred to the analyst.

### 5. Register an analysis lock

When the analyst is ready to identify a pre-unblinding analysis artifact, blindstats processes that artifact locally in the browser and creates an analysis-lock receipt.

The persistent registration records the exact lock receipt and safe metadata such as:

- filename;
- SHA-256;
- byte length;
- the linked blinding receipt; and
- the linked blinded-artifact identity.

The analysis artifact itself is not uploaded.

A later revision of the analysis file is a different artifact with a different hash; registering one lock does not make the researcher's local file immutable.

### 6. Request and authorize unblinding

The analyst requests unblinding against the governed workflow and, when required, a specific registered analysis lock.

Under **independent authorization**, the requester cannot authorize their own request. A different authenticated Study member with the required capability must authorize it.

Under **self-authorization**, the requester may authorize if the active plan permits that policy and the user has the required capability.

A successful authorization moves the workflow to `unblinding_authorized`. It does not upload, decrypt, or expose the mapping.

### 7. Complete unblinding locally

After authorization, the analyst receives the saved unblinding secret outside blindstats.

The analyst selects that secret locally. The browser verifies the governed artifact chain and decrypts the mapping locally.

The analyst can download the final unblinding receipt. blindstats then registers safe completion metadata and moves the workflow to `unblinded`.

The plaintext secret, released mapping, and final unblinding-receipt text are not stored by blindstats.

### 8. Inspect Audit history

The workflow provides a separate Audit history view for durable governance and technical records, including:

- active immutable plan version;
- transformation registration;
- analysis locks;
- unblinding request;
- authorization;
- completion;
- relevant identifiers and SHA-256 values; and
- server/database registration timestamps.

This detail is intentionally separated from the main task-oriented workflow.

## Two-party role model

The current separated workflow is designed around two practical roles.

### Blinding custodian / project lead

Typically:

- has access to the source or unblinded dataset;
- configures and activates the Blinding plan;
- creates the blinded package locally;
- retains the unblinding secret;
- transfers the blinded dataset to the analyst outside blindstats;
- independently authorizes a later unblinding request; and
- transfers the saved secret to the analyst after authorization.

### Blinded analyst

Typically:

- receives the blinded dataset;
- analyzes while blinded;
- registers an analysis lock;
- requests unblinding;
- cannot authorize their own request under the independent policy;
- receives the secret only after authorization;
- completes local unblinding; and
- registers safe completion metadata.

Study authorization is implemented with capabilities underneath these human-readable roles.

## What blindstats stores

The current server-backed layer stores governance records and safe artifact metadata needed to coordinate and audit the workflow.

| Persisted by blindstats | Kept browser-local or outside blindstats |
| --- | --- |
| authenticated user and Study records | source dataset contents |
| Study membership and capabilities | blinded dataset contents |
| Blinding plan drafts and immutable activated versions | substantive analysis-artifact contents |
| workflow state | plaintext unblinding secret |
| exact public blinding receipt | plaintext released mapping |
| transformation metadata and hashes | final unblinding-receipt text |
| exact analysis-lock receipt and safe lock metadata | |
| unblinding request and authorization records | |
| safe unblinding-completion metadata | |
| database registration timestamps | |

The public blinding receipt is intentionally persistable because it contains the **sealed/encrypted mapping**, not the plaintext mapping or the unblinding key.

The current release does **not** provide general-purpose research-file storage or in-app transfer of the blinded dataset or unblinding secret.

## Artifact model

The browser-local artifact schema is currently `0.3`. It is pre-release and may change.

- **Blinded CSV:** the source data with the selected categorical values replaced by randomized neutral labels.
- **Public blinding receipt:** transformation metadata, source/blinded artifact hashes, and an AES-GCM sealed mapping.
- **Unblinding secret:** the 256-bit AES-GCM key needed to decrypt that sealed mapping.
- **Analysis-lock receipt:** the exact public-receipt identity plus the exact analysis-artifact filename, SHA-256, and byte length.
- **Unblinding receipt:** the post-unblinding audit artifact containing the released original-to-neutral mapping and references to the linked workflow artifacts.

## Cryptographic design

Browser-local integrity and blinding operations use Web Crypto for:

- cryptographically secure random assignment of neutral labels;
- SHA-256 artifact hashing;
- UUID generation;
- generation of a random 256-bit unblinding key;
- generation of a fresh 96-bit AES-GCM IV; and
- authenticated encryption of the mapping with AES-GCM and a 128-bit authentication tag.

The sealed mapping is stored in the public receipt. Important transformation metadata are included as AES-GCM additional authenticated data, so changes to the bound metadata cause authenticated decryption to fail.

The unblinding secret contains the decryption key, not the plaintext mapping.

## What the workflow establishes

For actions completed through blindstats, the current system creates durable relationships among the plan, transformation, registered artifact identities, request, authorization, and completion records.

For example:

- the public receipt identifies the exact source and generated blinded CSV by SHA-256;
- the persistent transformation registration is bound to the active immutable plan version;
- the analysis-lock receipt identifies the exact registered public receipt and exact local analysis-artifact bytes;
- a required lock must belong to the active governed transformation before unblinding can be requested or authorized;
- independent authorization requires a different authenticated Study member;
- the unblinding secret must successfully authenticate and decrypt the sealed mapping locally; and
- completion is persistently linked to the governed artifact chain.

Browser-generated artifact timestamps are not independently trusted timestamps. Persistent server records additionally receive database-generated registration timestamps.

This is an **auditable process**, not a certification of researcher behavior. blindstats does not prove that:

- a researcher never viewed protected information outside the workflow;
- the locked artifact was the only analysis conducted;
- the blinded dataset was the only data used;
- an external handoff was performed securely; or
- no one bypassed blindstats entirely.

## Current limitations and release status

blindstats is preparing for an early **researcher-feedback / research-preview** release.

The current implementation supports:

- authentication;
- persistent Studies;
- Study membership and capability-based authorization;
- a versioned immutable Blinding plan;
- browser-local single-column categorical label blinding;
- persistent transformation registration;
- persistent analysis locks;
- persistent unblinding requests and authorizations;
- independent two-actor authorization enforcement;
- browser-local authorized unblinding;
- persistent safe completion metadata; and
- durable Audit history.

Important current limitations include:

- one selected categorical variable per blinding transformation;
- no general research-file storage;
- no in-app transfer of the blinded dataset;
- no in-app transfer or server custody of the plaintext unblinding secret;
- no server custody of plaintext mappings;
- no server storage of substantive analysis-artifact contents;
- no claim of regulatory compliance or production hardening;
- no general Teams/Organizations hierarchy; and
- no broader Research Management System modules yet.

The first field release is intended to test whether the workflow is useful and understandable to researchers before the product expands.

## Research literature

The rationale for blindstats is supported by research on blinding, analysis blinding, statistical-analysis planning, and reproducible research workflows.

Blinding is generally used to withhold information that could influence research decisions or interpretation. Reporting guidance therefore recommends describing who was blinded, what information was withheld, and how blinding was performed rather than relying on ambiguous labels such as "single blind" or "double blind" (Moher et al., 2010; Monaghan et al., 2021). SPIRIT 2025 explicitly includes data analysts among the groups whose blinding status may be relevant (Chan et al., 2025).

Analysis blinding applies that principle to statistical work. MacCoun and Perlmutter (2015) argued for wider use of blind analysis to reduce experimenter bias. Dutilh et al. (2021) described blinded analysis as a way to interrupt the feedback loop between analysis choices and analysis outcomes while retaining flexibility to respond to unexpected features of the data. Masking or shuffling condition labels is one possible method, but it does not conceal every result-relevant feature.

Clinical-trial methodology provides complementary guidance about workflow and timing. Gamble et al. (2017) recommend versioning statistical analysis plans and documenting changes relative to potentially revealing events. The Blinding of Trial Statisticians (BOTS) project found substantial variation in practice and supports a risk-proportionate approach rather than a universal requirement for statistician blinding (Iflaifel et al., 2022, 2023).

Related work also supports explicit pre-unblinding commitment. Järvinen et al. (2014) described a blinded-interpretation procedure in which investigators agree that no further changes will be made before treatment codes are broken. Blinding is also established practice in areas of physics and cosmology, where critical results may remain concealed until analysis choices and validation checks are finalized (MacCoun & Perlmutter, 2015; Muir et al., 2020).

blindstats operationalizes a deliberately narrow part of this methodological landscape. It does not assume that analyst blinding is appropriate or sufficient for every study and does not claim that neutral-label masking conceals every potentially informative feature of the data.

A focused review of the literature and related software is maintained in [`docs/literature-and-prior-art.md`](docs/literature-and-prior-art.md).

### Selected references

- Chan, A.-W., Tetzlaff, J. M., Altman, D. G., et al. (2025). SPIRIT 2025 statement: Updated guideline for protocols of randomized trials. *JAMA*.
- Dutilh, G., Sarafoglou, A., & Wagenmakers, E.-J. (2021). Flexible yet fair: Blinding analyses in experimental psychology. *Synthese, 198*, 5745-5772. https://doi.org/10.1007/s11229-019-02456-7
- Gamble, C., Krishan, A., Stocken, D., et al. (2017). Guidelines for the content of statistical analysis plans in clinical trials. *JAMA, 318*(23), 2337-2343. https://doi.org/10.1001/jama.2017.18556
- Iflaifel, M., Partlett, C., Bell, J., et al. (2022). Blinding of study statisticians in clinical trials: A qualitative study in UK clinical trials units. *Trials, 23*, 535. https://doi.org/10.1186/s13063-022-06481-9
- Iflaifel, M., Sprange, K., Bell, J., et al. (2023). Developing guidance for a risk-proportionate approach to blinding statisticians within clinical trials: A mixed methods study. *Trials, 24*, 71. https://doi.org/10.1186/s13063-022-06992-5
- Järvinen, T. L. N., Sihvonen, R., Bhandari, M., et al. (2014). Blinded interpretation of study results can feasibly and effectively diminish interpretation bias. *Journal of Clinical Epidemiology, 67*(7), 769-772. https://doi.org/10.1016/j.jclinepi.2013.11.011
- MacCoun, R., & Perlmutter, S. (2015). Blind analysis: Hide results to seek the truth. *Nature, 526*, 187-189. https://doi.org/10.1038/526187a
- Moher, D., Hopewell, S., Schulz, K. F., et al. (2010). CONSORT 2010 explanation and elaboration: Updated guidelines for reporting parallel group randomised trials. *BMJ, 340*, c869. https://doi.org/10.1136/bmj.c869
- Monaghan, T. F., Agudelo, C. W., Rahman, S. N., Wein, A. J., Lazar, J. M., Everaert, K., & Dmochowski, R. R. (2021). Blinding in clinical trials: Seeing the big picture. *Medicina, 57*(7), 647. https://doi.org/10.3390/medicina57070647
- Muir, J., Bernstein, G. M., Huterer, D., et al. (2020). Blinding multiprobe cosmological experiments. *Monthly Notices of the Royal Astronomical Society, 494*(3), 4454-4470. https://doi.org/10.1093/mnras/staa965

## Design principles

blindstats is being developed around several principles:

- **Auditability.** Important workflow actions should leave clear, inspectable records.
- **Reproducibility.** Exact artifact identities and deterministic relationships should be preserved where relevant.
- **Least-privilege access.** Users should receive only the capabilities and information needed for their Study role.
- **Explicit governance.** Request, authorization, and actual exposure should be distinct events.
- **Artifact integrity.** A later revision should not silently appear to be the exact artifact previously locked.
- **Local handling of substantive files.** Governance metadata can persist without requiring blindstats to take custody of the research files themselves.
- **Human control.** Integrity-critical operations should not depend on generative AI.
- **Open scrutiny.** Open-source development makes the implementation easier for researchers, statisticians, security practitioners, and software engineers to inspect and challenge.

Open source supports transparency; it does not replace secure architecture, privacy controls, authorization, institutional review, or sound research governance.

## Technical stack

The current application uses:

- [Next.js](https://nextjs.org/)
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Supabase](https://supabase.com/) PostgreSQL and Auth
- [Papa Parse](https://www.papaparse.com/) for CSV parsing and serialization
- Web Crypto for browser-local cryptographic operations
- [Vitest](https://vitest.dev/) for automated testing
- [Testing Library](https://testing-library.com/) for React UI workflow tests

## Development

### Requirements

- Node.js 24 LTS
- npm
- a Supabase project configured with the repository migrations

### Environment

Create `.env.local` with:

```text
NEXT_PUBLIC_SUPABASE_URL=<your Supabase project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your Supabase publishable key>
```

Do not commit `.env.local` or private credentials.

### Install and run

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

### Database migrations

Database history is maintained under:

```text
supabase/migrations/
```

Applied migrations should be treated as immutable history. Database changes should be made through new migrations rather than by editing migrations that have already been deployed.

With the Supabase CLI configured and linked to the intended project, useful validation commands include:

```bash
npx supabase migration list
npx supabase db lint --linked --level warning
```

Apply new reviewed migrations with the appropriate Supabase CLI workflow for the target environment.

### Validate

```bash
npm test
npm run lint
npm run build
```

## Documentation

The repository currently includes:

- [`docs/study-workflow-v0.md`](docs/study-workflow-v0.md)
- [`docs/blinding-workspace-v0.md`](docs/blinding-workspace-v0.md)
- [`docs/analysis-lock-v0.md`](docs/analysis-lock-v0.md)
- [`docs/unblinding-v0.md`](docs/unblinding-v0.md)
- [`docs/literature-and-prior-art.md`](docs/literature-and-prior-art.md)
- [`docs/vision.md`](docs/vision.md)

Some of the older `v0` documents originated with the browser-local prototype. They are being refreshed to distinguish the browser-local artifact protocol from the now-implemented persistent governance layer.

## Open source

blindstats is intended to be developed as open-source research software.

The project remains pre-release. Its APIs, artifact schemas, data model, architecture, workflow, and security model may change as researcher feedback is collected.
