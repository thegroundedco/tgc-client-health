-- Suggested check-ins (spec docs/superpowers/specs/2026-10-29-suggested-checkins-design.md).
--
-- Since 2026-10-28 Claude writes a monthly "AI-suggested" check-in per client
-- straight to production, and those rows were indistinguishable from the
-- owner's own except for a note prefix. suggested_at says "written as a
-- suggestion, not yet reviewed by a person". Null means a person entered it or
-- reviewed it. The check-in screen's save always sends it as null, so any save
-- is a review; a Confirm button clears it without touching anything else.
--
-- No CHECK, policy or grant, for the reason 20260912090000 gives: the
-- table-level grant covers a new column, and checkins_update_edit_scores
-- already decides who may update a row. Anyone who may score may review.
--
-- checkin_scores is not rebuilt: the board reads checkins directly for the
-- card, and the view's columns are unchanged.

alter table public.checkins add column suggested_at timestamptz;

comment on column public.checkins.suggested_at is
  'When this check-in was written as an AI suggestion that no person has yet '
  'reviewed. Null once a person saves or confirms it, or if a person entered it.';

-- The backfill. updated_at is moved by checkins_touch_updated_at on every
-- update, so a row a person has saved since it was written has updated_at well
-- after created_at and is left alone. On production 2026-10-29 this marks 24
-- rows (11 September, 13 October); Sno-Go and Triquetra (September) and Babaloo
-- (October) were already edited by the owner.
--
-- One statement, evaluated against the pre-update rows. Setting suggested_at
-- itself fires the touch trigger, so a second run matches nothing -- it cannot
-- double-apply.
update public.checkins
set suggested_at = created_at
where notes like 'AI-suggested:%'
  and updated_at <= created_at + interval '1 minute';
