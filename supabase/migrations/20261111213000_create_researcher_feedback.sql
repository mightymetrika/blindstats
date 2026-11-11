-- Researcher-preview feedback. Governance files and substantive research data
-- remain outside this table. Feedback is associated with a signed-in user but
-- is NOT readable through the participant-facing Data API.

create table public.researcher_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  protocol_version text not null default 'researcher-preview-v0.3',
  test_role text not null,
  completion text not null,
  ease_rating smallint,
  difficulties text,
  blinding_improvements text,
  transfer_usefulness text,
  transfer_controls text,
  rms_priorities text,
  other_feedback text,
  follow_up boolean not null default false,
  created_at timestamptz not null default now(),
  constraint researcher_feedback_version_valid
    check (protocol_version = 'researcher-preview-v0.3'),
  constraint researcher_feedback_role_valid
    check (test_role in ('paired_custodian', 'paired_analyst', 'single')),
  constraint researcher_feedback_completion_valid
    check (completion in ('independent', 'with_help', 'partial', 'not_completed')),
  constraint researcher_feedback_ease_valid
    check (ease_rating is null or ease_rating between 1 and 5),
  constraint researcher_feedback_transfer_valid
    check (transfer_usefulness is null or transfer_usefulness in ('no', 'somewhat', 'very', 'unsure')),
  constraint researcher_feedback_text_valid
    check (
      (difficulties is null or char_length(difficulties) <= 1200)
      and (blinding_improvements is null or char_length(blinding_improvements) <= 1200)
      and (transfer_controls is null or char_length(transfer_controls) <= 600)
      and (rms_priorities is null or char_length(rms_priorities) <= 1200)
      and (other_feedback is null or char_length(other_feedback) <= 1000)
    )
);

create index researcher_feedback_user_created_idx
  on public.researcher_feedback(user_id, created_at desc);

alter table public.researcher_feedback enable row level security;

-- Remove all inherited/default API privileges, then allow INSERT of response
-- columns only; the database supplies id, user_id, version and timestamp.
revoke all on table public.researcher_feedback from anon, authenticated;

grant insert (
  test_role,
  completion,
  ease_rating,
  difficulties,
  blinding_improvements,
  transfer_usefulness,
  transfer_controls,
  rms_priorities,
  other_feedback,
  follow_up
) on table public.researcher_feedback to authenticated;

create policy researcher_feedback_insert_own
on public.researcher_feedback
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
);

-- No SELECT, UPDATE or DELETE grants/policies for anon or authenticated.
-- Privileged administrators can review feedback in Supabase SQL Editor.
