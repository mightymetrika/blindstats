# Researcher invitation email — brief draft (do not send yet)

**Subject:** Invitation to try blindstats

Hello [first name],

I'm inviting a small group of researchers to try **blindstats**, an early tool for auditable analyst blinding. I'd value your feedback on the workflow, possible blinding improvements, and features for a future research management system.

**Please use only the supplied synthetic dataset, not real research data.** You'll use your own invited account.

- **App:** https://blindstats.com
- **Short testing protocol:** https://github.com/mightymetrika/blindstats/blob/main/docs/researcher-preview/TESTING_PROTOCOL.md
- **Synthetic CSV on GitHub:** https://github.com/mightymetrika/blindstats/blob/1c426cd/docs/researcher-preview/synthetic_study.csv
- **Analysis helper for your OS:** [insert *one* GitHub link from below]
- **Private feedback form:** [insert link when ready]

On each GitHub file page, select **Download raw file**. Nothing is attached to this email. The helper runs locally; no R or Python is needed. Please do not share passwords or unblinding secrets with us.

[Insert final participation, contact, privacy, and data-retention notice.]

Thank you,
[Sender]

---

**Organizer only — customize before sending:** Replace the analysis-helper line above with the *single* link matching the recipient's operating system:

- Windows: https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-windows.ps1
- macOS: https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-macos.command
- Linux: https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-linux.sh

The protocol itself has all three OS links. The CSV and script links are pinned to the committed v0.1 kit (`1c426cd`); the protocol link follows `main`. Verify links, activate the private feedback form and replace the placeholder in **both** the email and protocol, finish the privacy notice, enforce invitation-only registration, and test an actual invite before recruitment. **No live feedback endpoint exists yet.**
