# blindstats researcher-preview evaluation protocol

**Draft:** v0.1 · 11 November 2026 · Synthetic data only · Approximate exercises, not a validated research protocol

## Purpose

Assess the feasibility and usability of analyst blinding and governance in blindstats, including: clarity of roles and custody responsibilities; ease of creating and using blinded artifacts; value of analysis locks and independent authorization; and desired future features for **both the blinding workflow and a wider research management system (RMS)**.

This is an early researcher-feedback exercise. The software is not represented as production-hardened for confidential, identifiable, regulated, or client data. No real research data should be used. Participating in a workflow does not imply that the software proves real-world researcher behavior.

## Who and what

- Recruit researchers/statisticians; ideally include both experienced and novice users of analyst blinding.
- Each participant uses their own account and email inbox (not a publicly readable temporary inbox). A paired exercise uses two **different** participants/accounts.
- Use the supplied synthetic fixture and keep files on the participant's own computer. No data from a real study should be provided.
- Participation and feedback are distinct from authorization to use real research data. Do not send passwords, tokens, secrets, or file contents to the study organizer.
- Collect only the minimum contact and feedback details necessary. Provide the final privacy/consent and retention notice before recruitment. Participation is voluntary and questions can be skipped.

## Setup — 5 minutes

1. Follow the invitation instructions to obtain or activate your blindstats account at `https://blindstats.com`.
2. Download your **operating-system-specific helper**, or the pre-generated synthetic CSV.
3. Run `generate` (see README); locate `~/blindstats-preview-files/synthetic_study.csv`.
4. Decide whether to use **Path A (individual)** or **Path B (paired)**. Path B needs coordination and a separate authorizer account.

## Path A — Individual exercise (simplest pilot)

1. Sign in and **Create Study**. Name it `Synthetic blindstats preview` (or another name marked synthetic).
2. Open its Blinding workflow and configure the Blinding plan. Select `group` as the protected column at the package stage. For this short individual exercise, explicitly choose **self-authorization permitted**; keep **Analysis Lock required** to test its value. The app may require acknowledgement of this weaker authorization policy.
3. Activate the plan and open **Blinded package**. Select `synthetic_study.csv`, select the `group` column, and generate the package.
4. Download and keep **three distinct files**: the blinded CSV, public blinding receipt, and unblinding secret. Acknowledge custody, then **Register blinded package**. Do not use the unblinding secret to produce the analysis.
5. Run your OS helper's `analyze` action using the downloaded `synthetic_study_blinded.csv`. It creates `analysis_artifact.txt` with blinded-group means and sample SDs. This operation is offline and reads **only the blinded CSV**.
6. In **Analysis lock**, select `analysis_artifact.txt`, generate a lock, download its receipt, and register the lock as instructed by the app.
7. In **Unblinding**, request unblinding **against that analysis lock**, then authorize it under the selected self-authorization policy.
8. Supply your locally saved unblinding secret when the app requests it; complete local unblinding. Download the final unblinding receipt and inspect **Audit history**.
9. Submit feedback using the private feedback channel supplied by the organizer. Record what succeeded, what failed, where you hesitated, and any feature ideas.

This route tests the complete chain with one person. It does **not** test meaningful independence of authorization.

## Path B — Paired workflow (optional, more realistic)

1. Two invited researchers each register/activate **separate real accounts**.
2. Designate a **custodian** and **blinded analyst**. The custodian creates the synthetic Study, sets **independent authorization**, assigns the other user the Blinded analyst capabilities through **Analysis roles**, and activates the plan. The app requires distinct request/authorization actors.
3. The custodian generates and registers the blinded package, keeps the unblinding secret private, and sends **only the synthetic blinded CSV** to the analyst using an agreed external channel.
4. The analyst uses their OS helper to produce `analysis_artifact.txt` from the blinded CSV, registers the analysis lock, and requests unblinding.
5. The custodian independently authorizes. Only **after** that authorization, the custodian transfers the unblinding secret through a separate agreed channel. The analyst completes local unblinding and reviews Audit history.
6. Both participants independently report any confusion about their responsibilities, external handoffs, and whether a secure temporary file-transfer feature would help.

**Important:** blindstats currently does **not** offer in-app transfer of blinded datasets or plaintext unblinding secrets. This is a proposed feature to evaluate, not an implemented control. Never use real secrets or sensitive data in this exercise.

## What researchers should notice

- How clearly does the app distinguish **request**, **authorization**, and **actual unblinding**?
- How clear is file custody: which files are safe to share, and which should remain secret?
- Does an analysis lock feel useful, understandable, and realistically usable?
- Does the workflow feel workable for an individual statistician and for separated research roles?
- Where is an explicit instruction missing? How much time/effort did the workflow require?

## Outcomes and feedback

Record self-reported task completion (each key step: completed / completed with assistance / not completed), total time in broad bands, perceived ease (1–5), confusing steps, and willingness to use the tool again. Do not require screenshots. Capture failures with non-sensitive descriptions only.

Separately solicit and prioritize **blinding workflow enhancements** and **broader RMS features**; see `FEEDBACK_QUESTIONS.md`. These are exploratory needs-assessment questions, not commitments to implement any feature.

## Privacy, retention, and interpretation

Before sending invitations, finalize a short notice covering feedback controller/contact, intended uses, storage/access, retention/deletion, optional follow-up, and who can see responses. Study records and audit events may persist in Production. Avoid collecting unnecessary identifiable details and **never request actual datasets, unblinding secrets, passwords, tokens, or sensitive participant material** in feedback.

This is formative feasibility/user-experience testing, not a security audit, effectiveness trial, or quantitative estimate representative of all researchers. Summarize descriptive results and recurrent themes; do not overinterpret a small convenience sample.
