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

## Version 1

The first version of blindstats will focus on one end-to-end workflow:

1. Create a study and research team.
2. Assign roles and access permissions.
3. Upload a study dataset.
4. Designate variables or labels to be blinded.
5. Generate a reproducibly blinded dataset.
6. Provide the blinded analyst access to the appropriate blinded materials.
7. Submit and lock the blinded analysis code and report.
8. Authorize unblinding.
9. Release the appropriate mappings and unblinded materials.
10. Produce an audit record documenting the process.

The exact workflow and role definitions are still being designed.

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

The repository now includes a functional browser-local Blinding Workspace v0.
The current prototype can:

- read and validate a UTF-8, comma-delimited CSV locally in the browser;
- blind one selected categorical column using securely randomized neutral labels;
- preserve unrelated data, row order, column order, and missing selected values;
- generate a blinded CSV and SHA-256 artifact hashes; and
- generate a public blinding receipt and a separate private blinding key.

The current prototype does **not** yet implement accounts, role-based separation,
persistent study records, cloud storage, analysis locking, or controlled multi-user
unblinding. The local operator can access both the source data and private key.

See [`docs/blinding-workspace-v0.md`](docs/blinding-workspace-v0.md) for the
current v0 scope and integrity requirements.

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

The v0 blinding workflow uses browser Web Crypto for secure randomized mappings,
SHA-256 hashing, and transformation identifiers. Research data and private keys
remain browser-local in the current prototype.

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
