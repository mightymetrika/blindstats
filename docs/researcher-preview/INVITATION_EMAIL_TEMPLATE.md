# Invitation email template (draft — do not send before access and feedback links are ready)

**Subject:** Invitation to try blindstats — short researcher feedback exercise

Hello [first name],

I'm inviting a small group of researchers to try **blindstats**, an early research-preview tool for auditable analyst blinding. The purpose is to learn whether the workflow is understandable and useful, and what we should build next—both for blinding and for a broader research management system.

Please use **only the supplied synthetic data**. Do not use any real, confidential, identifiable, regulated, or client research data. You can use your normal email address to create an account once your invitation is enabled; we won't ask you to send a password or secret.

**Application:** https://blindstats.com

**Testing instructions:** [link to the versioned protocol on GitHub]

**Select the helper for your operating system (download and inspect before running):**

- **Windows:** [link to researcher-preview-windows.ps1]
- **macOS:** [link to researcher-preview-macos.command]
- **Linux:** [link to researcher-preview-linux.sh]
- **No scripting:** [link to synthetic_study.csv]

The helper generates synthetic test data and, after you've blinded it in blindstats, a small analysis file for the Analysis Lock step. It runs locally and does not connect to any online service. You can choose the short individual exercise; a paired exercise is also available for those who want to evaluate independent authorization.

**Private feedback form:** [link to private survey or authenticated feedback form]

We're especially interested in what made the workflow difficult, possible improvements (such as short-lived recipient-only file transfer), and features you'd value in a broader research management system, including data collection and research collaboration.

[Brief privacy/voluntariness/retention notice and contact]

Thanks,
[Sender]

---

**Organizer checklist before sending**

1. Verify the test scripts, protocol, and sample CSV are committed and the links point to a **fixed release version or commit** (not placeholders).
2. Decide and **enforce** invitation-only enrollment; an invitation email alone does not prevent public self-signup.
3. Confirm real researcher invitations work with Production Supabase Auth. Don't assume the previous ordinary-signup test covers invitation-specific links.
4. Set up a private feedback destination plus clear privacy/retention/contact information.
5. Ensure only synthetic data are requested; never ask respondents to share passwords, receipt secrets, or sensitive files.
