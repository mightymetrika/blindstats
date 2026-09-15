-- Clarify the BlindingPlan distinction between the information being protected
-- and the concrete variable used later by a blinding transformation.
--
-- Existing draft values are preserved; only their semantic name changes.

begin;

alter table public.blinding_plan_drafts
  rename column blinding_targets to protection_targets;

alter table public.blinding_plan_drafts
  rename constraint blinding_plan_drafts_target_count
  to blinding_plan_drafts_protection_target_count;

comment on column public.blinding_plan_drafts.protection_targets is
  'Substantive information or inferential cues the workflow is intended to protect. This is distinct from the concrete dataset variable or column used by a later blinding transformation.';

commit;
