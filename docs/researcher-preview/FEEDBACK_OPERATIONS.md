# Researcher-preview feedback — organizer notes

The participant-facing link is `https://blindstats.com/feedback` **only after**
the migration and application are deployed and validated. This document is for
the organizer, not part of the participant testing protocol.

## Collection and privacy

- Sign-in is required. The form stores response fields, the authenticated account
  ID, protocol version, and server timestamp; it does not accept file uploads.
- `public.researcher_feedback` grants `INSERT` on response fields to
  `authenticated`; there are **no** participant `SELECT`, `UPDATE`, or `DELETE`
  privileges/policies. The database supplies account ID and timestamps.
- The organizer reviews answers in the Supabase dashboard SQL Editor with
  project administrator privileges; no participant-facing results browser exists.
- Do not copy raw feedback to GitHub or issue a service-role key to browsers.
- Before invitations, finalize participation, contact, account deletion, and
  feedback retention terms. Deleting an auth account also cascades its feedback.
- This first version has no study identifier. Audit events can provide milestones,
  but cannot be unambiguously matched to a response from someone with multiple
  Studies, nor be interpreted as active time-on-task.

## Safe rollout

1. Commit the application, migration, tests, and docs to `development` only.
2. Review the SQL migration and confirm the CLI is linked to the **Development**
   Supabase project before applying it. Never apply it to the wrong project.
3. Run `npm test`, `npm run lint`, and `npm run build`; deploy a fresh protected
   Preview. Sign in with an existing Development account and submit **synthetic**
   feedback via `/feedback`.
4. In **Development** Supabase SQL Editor, with privileged project access, inspect:

   ```sql
   select created_at, protocol_version, test_role, completion, ease_rating,
          difficulties, blinding_improvements, transfer_usefulness,
          transfer_controls, rms_priorities, other_feedback, follow_up
   from public.researcher_feedback
   order by created_at desc
   limit 20;
   ```

5. Verify that signed-out users are redirected to `/login`, and that ordinary
   authenticated users cannot read or modify other feedback rows. Check the
   database grants/policies, not just the UI.
6. After acceptance, apply the *same* migration to Production deliberately,
   deploy the validated app code to Production, and submit one synthetic test
   response using an authorized test account. Then remove that test account and
   verify the associated feedback row is deleted via the foreign-key cascade.
7. Do not invite researchers until Production invitation-only signup is enforced,
   administrative invite emails work, and the privacy/retention notice is ready.

Current protocol version stored by the database: `researcher-preview-v0.3`.
