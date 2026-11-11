# Researcher invitation email — draft (do not send yet)

**Subject:** Invitation to try blindstats

Hello [first name],

I'm inviting a small group of researchers to try **blindstats**, an early tool for auditable analyst blinding. I'd value your feedback on the experience, improvements to blinding, and ideas for a broader research management system (RMS).

**Paired testing is recommended:** one researcher acts as blinding custodian and another as analyst. If you can test with a colleague, reply so we can arrange a separate account for them. You can instead try the single-person exercise—or do both.

- **Paired testing protocol (recommended):** https://github.com/mightymetrika/blindstats/blob/main/docs/researcher-preview/PAIRED_TESTING_PROTOCOL.md
- **Single-person protocol (alternative):** https://github.com/mightymetrika/blindstats/blob/main/docs/researcher-preview/SINGLE_TESTING_PROTOCOL.md
- **App:** https://blindstats.com
- **Synthetic CSV on GitHub:** https://github.com/mightymetrika/blindstats/blob/1c426cd/docs/researcher-preview/synthetic_study.csv
- **Analysis helper for your OS:** [insert one GitHub link from below]
- **Private feedback form:** [insert link when ready]

Please use **only the synthetic dataset**, not real research data. Nothing is attached to this email. On GitHub, select **Download raw file** for the CSV and script; the protocol explains the steps. Each researcher needs their own invited account.

[Insert participation, privacy/retention, and contact wording before sending.]

Thank you,
[Sender]

---

**Organizer only — remove this section before sending:** Substitute the single appropriate helper link above:

- Windows: https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-windows.ps1
- macOS: https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-macos.command
- Linux: https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-linux.sh

Before invitations: implement the *private* feedback form and replace its placeholder in this email **and both protocols**; finalize privacy/retention wording; enforce invitation-only Production signup; and test account invitations. The protocol links become live after these files are pushed to `main`. The CSV/helpers are pinned to previously tested commit `1c426cd`.
