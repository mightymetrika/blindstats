# blindstats researcher preview — testing kit

**Two short protocols:**

- **[Paired exercise (recommended)](PAIRED_TESTING_PROTOCOL.md)** — two separately registered accounts; custodian and analyst follow independent authorization.
- **[Single-person exercise (alternative)](SINGLE_TESTING_PROTOCOL.md)** — one registered account; self-authorization.

Each protocol is self-contained: direct file links, OS-specific analysis helper commands, and a link to the private feedback form (live at https://blindstats.com/feedback). The invitation email links to the chosen protocol and files directly; participants do not need to navigate this README.

**Use synthetic data only.** This is early research-preview software, not intended for real, confidential, regulated, or client datasets.

## Files

- [Ready-made synthetic CSV](synthetic_study.csv) — default; no data generation required.
- [Windows analysis helper](../../scripts/researcher-preview/researcher-preview-windows.ps1)
- [macOS analysis helper](../../scripts/researcher-preview/researcher-preview-macos.command)
- [Linux analysis helper](../../scripts/researcher-preview/researcher-preview-linux.sh)
- [Feedback questions](FEEDBACK_QUESTIONS.md) — questions implemented by the live `/feedback` form.
- [Invitation email template](INVITATION_EMAIL_TEMPLATE.md) — organizer draft, not sent.

The offline helpers can also generate the synthetic CSV for development use; participants should download the already-created dataset from GitHub instead. Helpers analyze only the neutral-label blinded CSV and write `analysis_artifact.txt` to `~/blindstats-preview-files`. They require no R or Python packages. Mac/Linux commands use `sh`; Windows commands use PowerShell.

**Before inviting researchers:** Production `/feedback` and its database are now deployed and smoke-tested. Public self-signup remains open; researchers and chosen partners register independently. Finalize concise participation/privacy/retention/contact wording and verify direct protocol/CSV/helper links. Do not collect research files or secrets in feedback.
