# blindstats

**Open-source tools for auditable analyst blinding.**

blindstats is an early-stage research software project designed to help research
teams separate statistical analysis decisions from knowledge of meaningful study
labels.

The initial goal is deliberately narrow:

> **Analyst blinding → locked analysis → documented unblinding**

By making the blinding and unblinding process explicit and auditable, blindstats
aims to support reproducible analysis workflows and reduce opportunities for
analysis or reporting decisions to be influenced by knowledge of which groups,
conditions, or labels favor a particular conclusion.

## Why analyst blinding?

Statistical analyses often involve legitimate researcher decisions, including
model specification, transformations, exclusions, sensitivity analyses,
presentation, and reporting choices.

When analysts already know which labels correspond to treatments, comparison
groups, favored hypotheses, or other substantively meaningful conditions, those
decisions can be influenced consciously or unconsciously by the results they
produce.

Analyst blinding provides one way to reduce that influence.

blindstats is intended to make that process easier to implement, document, and
reproduce.

## First-release workflow

The first public release is being built as a browser-local, file-mediated
workflow:

1. Create a blinded dataset with a public blinding receipt and separate private
   key.
2. Give the blinded analyst the blinded dataset and public receipt while keeping
   the private key separate.
3. Conduct the analysis while blinded.
4. Lock an exact pre-unblinding analysis artifact and generate an analysis-lock
   receipt linked to the blinded dataset.
5. Complete documented unblinding and generate the corresponding audit artifact.

This initial workflow does not require accounts, a database, or server-side file
storage. Later versions are expected to add stronger role separation,
authentication, persistent study records, controlled file access, and durable
server-side audit history.

## Design principles

blindstats is being developed around several principles:

- **Auditability.** Important study actions should leave a clear record of what
  happened, when it happened, and who was authorized to perform the action.
- **Reproducibility.** Blinding transformations should be deterministic or
  reproducibly generated and documented well enough to verify later.
- **Least-privilege access.** Users should receive only the information needed
  for their role in the study.
- **Explicit study states.** Blinding, analysis locking, authorization, and
  unblinding should occur through deliberate state transitions rather than
  informal file sharing.
- **Artifact integrity.** Finalized blinded analysis materials should not be
  silently replaceable after they have been locked.
- **Human control.** Integrity-critical operations such as mapping and
  unblinding should not depend on generative AI.

## Longer-term vision

blindstats may eventually support additional research workflows, including
random assignment, data collection, study tracking, controlled project-file
sharing, and integrations with external research repositories.

Those possibilities are intentionally outside the initial development scope.

The immediate objective is to make analyst blinding exceptionally clear,
auditable, and useful before expanding the platform.

## Project status

blindstats is in **early development**.

The repository now includes a functional browser-local workflow for creating a
blinded package and locking an exact pre-unblinding analysis artifact. The
current prototype can:

- read and validate a UTF-8, comma-delimited CSV locally in the browser;
- blind one selected categorical column using securely randomized neutral labels;
- preserve unrelated data, row order, column order, and missing selected values;
- generate a blinded CSV, public blinding receipt, and separate private blinding
  key;
- accept the exact public receipt, blinded CSV, and one nonempty analysis
  artifact in a later browser session;
- verify that the blinded CSV matches the SHA-256 recorded in the public receipt;
  and
- generate an analysis-lock receipt linking the exact blinded dataset and exact
  analysis-artifact bytes.

Documented unblinding is the next major first-release stage. The current
prototype does **not** yet implement accounts, role-based separation, persistent
study records, cloud storage, or controlled multi-user access. The person
creating the blinded package can access both the source data and private key.

See [`docs/blinding-workspace-v0.md`](docs/blinding-workspace-v0.md) for the
original blinding-workspace scope and
[`docs/analysis-lock-v0.md`](docs/analysis-lock-v0.md) for the current
analysis-lock contract.

**Do not use the current software to store or transfer sensitive, confidential,
regulated, or client research data.**

## Technical direction

The application is being developed with:

- [Next.js](https://nextjs.org/)
- [TypeScript](https://www.typescriptlang.org/)
- [React](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Papa Parse](https://www.papaparse.com/) for CSV parsing and serialization
- [Vitest](https://vitest.dev/) for automated testing
- [Testing Library](https://testing-library.com/) for React UI workflow tests

The browser-local workflow uses Web Crypto for secure randomized mappings,
SHA-256 hashing, transformation identifiers, and analysis-lock identifiers.
Research data, analysis artifacts, and private keys remain browser-local in the
current prototype.

A relational PostgreSQL architecture is currently anticipated for study,
membership, permission, workflow, and audit metadata. Specific database,
authentication, file-storage, and deployment services will be selected as their
requirements are implemented.

See [`docs/vision.md`](docs/vision.md) for the current product and technical
vision.

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

The project is at an early stage, and its APIs, data model, architecture, and
workflow may change substantially during development.
