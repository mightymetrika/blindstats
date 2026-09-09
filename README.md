# blindstats

**Open-source tools for auditable analyst blinding.**

blindstats is an early-stage research software project designed to help research
teams separate statistical analysis decisions from knowledge of meaningful study
labels.

The initial goal is deliberately narrow:

> **Analyst blinding → locked analysis → documented unblinding**

By making this sequence explicit and auditable, blindstats aims to support
reproducible analysis workflows and reduce opportunities for analysis or reporting
choices to be influenced by knowledge of which groups, conditions, or labels favor
a particular conclusion.

## Why analyst blinding?

Statistical analyses often involve legitimate researcher decisions, including
model specification, transformations, exclusions, sensitivity analyses,
presentation, and reporting choices.

When analysts already know which labels correspond to treatments, comparison
groups, favored hypotheses, or other substantively meaningful conditions, those
decisions can be influenced consciously or unconsciously by the results they
produce.

Analyst blinding is one tool for reducing that influence. It is not a substitute
for appropriate study design, preregistration when relevant, transparent
reporting, replication, or researcher judgment.

blindstats is intended to make analyst blinding easier to conduct, link, document,
and reproduce.

## Research literature

The rationale for blindstats is consistent with the broader literature on
blinding in research. Monaghan et al. (2021) describe blinding as withholding
information that could influence study results and note that randomization alone
does not prevent differential interpretation and analysis of outcomes. Although
their review focuses on clinical trials, it also notes that the relevance of
blinding extends across study designs.

For statisticians specifically, Monaghan et al. identify statisticians as one of
the groups for whom blinding merits separate consideration. Their reporting
example lists participant and group identities as information that may be withheld
from statisticians, with numerical identifiers used to preserve blinding. The
review also treats blinding as a continuum rather than an all-or-nothing feature
and emphasizes reporting who was blinded, what information was withheld, and how
blinding was performed.

blindstats operationalizes a narrow part of that broader methodological idea:
helping analysts work with neutral labels, lock an exact analysis artifact before
unblinding, and retain linked receipts that document the workflow. The software
does not assume that statistician blinding is appropriate or sufficient for every
study, nor does it claim to eliminate bias.

**Reference:** Monaghan, T. F., Agudelo, C. W., Rahman, S. N., Wein, A. J.,
Lazar, J. M., Everaert, K., & Dmochowski, R. R. (2021). Blinding in clinical
trials: Seeing the big picture. *Medicina, 57*(7), 647.
https://doi.org/10.3390/medicina57070647

## First-release workflow

The current prototype implements a browser-local, file-mediated workflow:

1. **Create blinded package**
   - input: original CSV;
   - outputs: blinded CSV, public blinding receipt, and unblinding secret.
2. **Analyze while blinded**
   - the analyst works with the blinded data outside blindstats.
3. **Lock blinded analysis**
   - inputs: public blinding receipt and one analysis artifact;
   - output: analysis-lock receipt.
4. **Unblind**
   - inputs: the same public blinding receipt, the unblinding secret, and the
     analysis-lock receipt;
   - output: unblinding receipt containing the released mapping.

The study owner can retain the unblinding secret while the analyst receives the
blinded CSV and public receipt. After the analysis is locked, the owner can release
the unblinding secret to the analyst.

The current software does not enforce those roles. File separation is the v0
substitute for the role and authorization controls expected in a later
server-backed platform.

## Current artifact model

The pre-unblinding artifacts are deliberately small:

- **Blinded CSV:** the source data with the selected categorical values replaced
  by randomized neutral labels.
- **Public blinding receipt:** transformation metadata, artifact hashes, and an
  AES-GCM sealed mapping.
- **Unblinding secret:** the 256-bit AES-GCM key needed to decrypt that sealed
  mapping.
- **Analysis-lock receipt:** the exact public-receipt hash plus the exact
  analysis-artifact filename, SHA-256, and byte length.
- **Unblinding receipt:** the post-unblinding audit artifact containing the
  released original-to-neutral mapping and references to the linked workflow
  artifacts.

The current artifact schema is `0.3`. It is pre-release and may change.

## Cryptographic design

The browser-local workflow uses Web Crypto for:

- cryptographically secure random assignment of neutral labels;
- SHA-256 artifact hashing;
- UUID generation;
- generation of a random 256-bit unblinding key;
- generation of a fresh 96-bit AES-GCM IV; and
- authenticated encryption of the mapping with AES-GCM and a 128-bit
  authentication tag.

The sealed mapping is stored in the public receipt. Important transformation
metadata is included as AES-GCM additional authenticated data, so changing that
bound metadata causes authenticated decryption to fail.

The unblinding secret contains the decryption key, not the plaintext mapping.

## What the current workflow establishes

The current prototype can create verifiable relationships among artifacts
processed through blindstats:

- the public receipt identifies the exact source and generated blinded CSV by
  SHA-256;
- the analysis-lock receipt identifies the exact public-receipt bytes and exact
  analysis-artifact bytes;
- the unblinding operation requires that the public receipt and analysis-lock
  receipt refer to the same transformation and blinded artifact;
- the unblinding secret must successfully authenticate and decrypt the sealed
  mapping; and
- the final unblinding receipt records the mapping that was released.

This is an auditable workflow, not a certification of researcher behavior.
blindstats does not prove that a researcher never viewed protected information,
that the locked artifact was the only analysis conducted, or that the blinded
dataset was the only data used outside the application.

The current browser-generated timestamps are also not independently trusted
timestamps.

## Design principles

blindstats is being developed around several principles:

- **Auditability.** Important workflow actions should leave clear, inspectable
  records.
- **Reproducibility.** Deterministic transformations and exact artifact identities
  should be preserved where relevant.
- **Least-privilege access.** Users should receive only the information needed for
  their study role.
- **Explicit study states.** Blinding, locking, authorization, and unblinding
  should become deliberate state transitions.
- **Artifact integrity.** A later revision should not silently appear to be the
  exact artifact that was previously locked.
- **Human control.** Integrity-critical operations should not depend on generative
  AI.
- **Open scrutiny.** Open-source development can make the implementation easier
  for researchers, statisticians, security practitioners, and software engineers
  to inspect and challenge.

Open source supports transparency; it does not replace secure architecture,
privacy controls, authorization, or sound research governance.

## Project status

blindstats is in **early development**.

The repository now includes a complete browser-local prototype of the initial
three-stage workflow. It can:

- read and validate a UTF-8, comma-delimited CSV locally in the browser;
- blind one selected categorical column using securely randomized neutral labels;
- preserve unrelated data, row order, column order, and missing selected values;
- generate a blinded CSV, public receipt with sealed mapping, and separate
  unblinding secret;
- lock one exact analysis artifact under the exact public blinding receipt;
- authenticate and decrypt the sealed mapping after a valid lock relationship is
  supplied; and
- generate linked blinding, analysis-lock, and unblinding audit artifacts.

See:

- [`docs/blinding-workspace-v0.md`](docs/blinding-workspace-v0.md)
- [`docs/analysis-lock-v0.md`](docs/analysis-lock-v0.md)
- [`docs/unblinding-v0.md`](docs/unblinding-v0.md)
- [`docs/vision.md`](docs/vision.md)

The current prototype does **not** provide accounts, server-enforced roles,
persistent study records, cloud file storage, controlled multi-user access, or
trusted server-side workflow timestamps.

**Do not use the current software as a storage, transfer, or authorization system
for sensitive, confidential, regulated, or client research data.**

## Technical direction

The application is being developed with:

- [Next.js](https://nextjs.org/)
- [TypeScript](https://www.typescriptlang.org/)
- [React](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Papa Parse](https://www.papaparse.com/) for CSV parsing and serialization
- [Vitest](https://vitest.dev/) for automated testing
- [Testing Library](https://testing-library.com/) for React UI workflow tests

The current workflow processes research files in the browser and does not
implement server-side research-file upload or persistence.

A relational PostgreSQL architecture is currently anticipated for study,
membership, permission, workflow, and audit metadata. File storage,
authentication, encryption/key management, retention, and deployment services
will be selected only after their requirements are defined.

## Development

### Requirements

- Node.js 24 LTS
- npm

### Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

### Validate

```bash
npm test
npm run lint
npm run build
```

## Open source

blindstats is intended to be developed as open-source research software.

The project is at an early stage, and its APIs, artifact schemas, data model,
architecture, and workflow may change substantially during development.
