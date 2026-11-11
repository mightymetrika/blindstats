# blindstats — short researcher feedback questions (v0.3)

Internal reference for the `/feedback` form, pending deployment and migration. Never collect research files, passwords, tokens, or unblinding secrets. Free-text questions and ratings may be skipped.

1. **Exercise:** Individual / Paired custodian / Paired analyst.
2. **Did you complete it?** Independently / With help / Partly / No. If partly or no, where did you stop?
3. **How easy was blindstats to use?** 1 (very difficult) to 5 (very easy).
4. **What was confusing or frustrating?** What would you change first?
5. **What blinding features would you add?** Consider multi-variable blinding, alternative transformations, collaboration, analysis locks, and more flexible roles. Which is most valuable?
6. **Would temporary secure file transfer be useful?** No / Somewhat / Very / Unsure. Which controls matter most: recipient access, expiry deadline, single download, automatic deletion, revocation, notification, or other?
7. **What are your top three priorities for a broader research management system (RMS)?** Examples: data collection; recruitment/screening/consent; randomization; protocol/SAP versioning; secure file sharing; data quality; analysis tools; collaboration; reporting; integrations (R, Python, REDCap, OSF).
8. **Anything else?** Optional: interested in a follow-up conversation? Yes / No.

**For the organizer:** The insert-only `researcher_feedback` table stores protocol version, test role, completion, ease rating, comments, feature preferences, authenticated account identity, and database timestamp. Existing Study/workflow audit timestamps can describe milestone timing, **not active working time**. Do not collect time bands. Keep responses private and provide the finalized privacy/retention notice before recruitment.
