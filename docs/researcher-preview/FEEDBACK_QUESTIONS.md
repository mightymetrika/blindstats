# blindstats researcher feedback — draft v0.1

**Status:** question bank and submission format only. No live feedback form/database integration has yet been deployed. Keep responses private. Questions are voluntary and should not solicit research files or authentication secrets.

## A. About the test

- Which test route did you attempt? Individual / Paired custodian / Paired analyst.
- Broad role: statistician / trialist / other quantitative researcher / other (optional).
- Experience with analyst blinding: none / some / substantial.
- Did you create the Study, blind a CSV, produce a blinded analysis artifact, register a lock, authorize, unblind, and inspect Audit history? Mark each: completed independently / with help / not completed / not applicable.
- Rough effort: under 15 minutes / 15–30 / 31–60 / over 60.
- Overall ease of use (1 very difficult – 5 very easy).
- Where did you get stuck, or what did you expect to happen instead?
- What, if anything, made it difficult to understand the division of responsibility between custodian and analyst?

## B. Improving the blinding workflow

- What would you **change or add** to the current blinding workflow? (Free text.)
- What is the **single most valuable** missing blinding feature? (Free text.)
- How useful would **temporary secure file transfer** be for the blinded CSV or post-authorization unblinding secret? Not useful / somewhat / very / unsure.
- For such a transfer feature, which controls would matter? Recipient-specific access; authenticated recipient; one-time download; expiry deadline; automatic deletion on successful download or expiry; audit confirmation; encryption; ability to revoke access; other.
- Would you prefer a file to be deleted immediately after the first confirmed download, or remain accessible until a deadline? What problems could either create?
- Other candidate enhancements: blinding multiple variables; more transformation methods; reusable templates; stronger or more flexible analysis locks; collaboration/role delegation; receipt verification; notifications; other. Which two matter most?
- What would prevent you from using the blinding feature for your own research, even after further validation?

## C. Wider research management system (RMS) priorities

- Beyond blinding, what research workflows would you most want integrated in an RMS? **Choose up to three**, then rank the top one.
  - Data collection / forms / survey instruments
  - Participant recruitment, screening, and consent
  - Randomization and allocation concealment
  - Study planning / protocol and SAP versioning
  - Preregistration / analysis plans
  - Secure data and document transfer
  - Permissions, teams, and collaboration
  - Data quality monitoring / validation
  - Analysis execution, notebooks, or reproducible pipelines
  - File/version custody and sharing
  - Study reporting, audit trails, and provenance
  - Integrations (e.g. R, Python, REDCap, OSF, GitHub)
  - Other (describe)
- Which workflows should be in one integrated platform, and which are better left to specialized tools?
- Which existing research systems would blindstats need to work with?
- If one RMS feature could be built next, which one would most improve your actual research process, and why?
- Would you be willing to take part in a follow-up walkthrough or interview? Yes / No (optional; contact separately).

## D. Final comments

- Is there anything we have not asked that would make this tool more useful?

## Suggested minimally structured response fields (for future private data capture)

`protocol_version`, `participant_id` (pseudonymous), `test_path`, `role`, `prior_blinding_experience`, `task_statuses`, `time_band`, `ease_rating`, `usability_notes`, `blinding_top_request`, `transfer_need`, `transfer_controls`, `rms_top_three`, `rms_top_priority`, `integration_needs`, `willing_followup`, `created_at`.

**Do not implement this as a public-write database table without access controls.** If an authenticated in-app form is later added, use a new migration and least-privilege RLS, and establish an admin reporting/access design before collecting responses. The initial evaluation can use an appropriately private survey instead, avoiding another release blocker.
