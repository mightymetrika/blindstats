# blindstats researcher preview — testing kit

**Two short protocols:**

- **[Paired exercise (recommended)](PAIRED_TESTING_PROTOCOL.md)** — two invited accounts; custodian and analyst follow independent authorization.
- **[Single-person exercise (alternative)](SINGLE_TESTING_PROTOCOL.md)** — one invited account; self-authorization.

Each protocol is self-contained: direct file links, OS-specific analysis helper commands, and a future private feedback-form link. The invitation email links to the chosen protocol and files directly; participants do not need to navigate this README.

**Use synthetic data only.** This is early research-preview software, not intended for real, confidential, regulated, or client datasets.

## Files

- [Ready-made synthetic CSV](synthetic_study.csv) — default; no data generation required.
- [Windows analysis helper](../../scripts/researcher-preview/researcher-preview-windows.ps1)
- [macOS analysis helper](../../scripts/researcher-preview/researcher-preview-macos.command)
- [Linux analysis helper](../../scripts/researcher-preview/researcher-preview-linux.sh)
- [Feedback questions](FEEDBACK_QUESTIONS.md) — draft only; the feedback form does **not** yet exist.
- [Invitation email template](INVITATION_EMAIL_TEMPLATE.md) — organizer draft, not sent.

The offline helpers can also generate the synthetic CSV for development use; participants should download the already-created dataset from GitHub instead. Helpers analyze only the neutral-label blinded CSV and write `analysis_artifact.txt` to `~/blindstats-preview-files`. They require no R or Python packages. Mac/Linux commands use `sh`; Windows commands use PowerShell.

**Before inviting researchers:** enable invitation-only account creation, provide a private feedback destination and privacy/retention notice, replace both protocol feedback placeholders, and verify both invite and download links. Do not collect research files or secrets in feedback.
