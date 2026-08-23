-- The client lifecycle columns from parent spec §6.1, which the original clients
-- migration did not build. Until this lands, a client who leaves can be marked
-- `cancelled` and nothing else -- not when, not why -- and those two facts are
-- only available on the day it happens. Slice 2 design §5.
--
-- No grants and no revokes here, deliberately. The standing convention that a
-- new table in `public` opens with `revoke all ... from anon, authenticated`
-- applies to new tables; this is an ALTER, and the existing
-- `grant select, insert, update on public.clients to authenticated` is
-- table-level, so these three columns are already inside it. That is intended:
-- the clients admin screen writes them, and what stops the wrong person writing
-- them is the RLS policy, not a column grant. Slice 2 step 2 is where those
-- policies start asking about `manage_clients` instead of merely asking whether
-- the account is active.

alter table public.clients
  add column ended_on date,
  add column end_reason_code text,
  add column end_reason_note text;

comment on column public.clients.ended_on is
  'The date the client relationship ended. Required whenever status is cancelled '
  'or former, and forbidden otherwise: see clients_lifecycle_coherent.';

comment on column public.clients.end_reason_code is
  'Why they left, from a fixed list, so reasons are countable across clients. '
  'The note beside it carries the nuance a code cannot.';

comment on column public.clients.end_reason_note is
  'The nuance behind end_reason_code. Optional: a coded reason alone loses the '
  'story, but only the countable half can be made mandatory without inviting a '
  'full stop typed to get past a form.';

-- Bidirectional on purpose, and this is the half the parent spec does not state.
-- §6.1 requires ended_on whenever status is cancelled or former. This also
-- forbids all three columns when the status is active or paused: an active
-- client carrying an end date is not a state anybody meant to create, and
-- leaving it representable means reporting has to invent a meaning for it later.
--
-- The cost, paid by the clients admin screen: reactivating a client has to clear
-- all three columns in the SAME statement, or this constraint refuses the
-- update. Slice 2 design §7 rule 2.
--
-- end_reason_code is required on churn and end_reason_note is not, for the
-- reason in its column comment above.
alter table public.clients add constraint clients_lifecycle_coherent check (
  case
    when status in ('cancelled', 'former')
      then ended_on is not null and end_reason_code is not null
    else ended_on is null and end_reason_code is null and end_reason_note is null
  end
);

-- Text plus a check constraint, exactly as `status` is stored on this same
-- table, so the table stays internally consistent and no new object gains its
-- own grants and RLS policy. The seven codes are parent spec §6.1's list.
alter table public.clients add constraint clients_end_reason_code_known check (
  end_reason_code is null or end_reason_code in (
    'price', 'scope_fit', 'in_housed', 'went_quiet',
    'project_completed', 'agency_initiated', 'other'
  )
);

-- On lower(name), not name. "Colorfil" and "colorfil" are the same client, and a
-- case-sensitive index would let both exist -- which is the duplicate this index
-- is for. `C.R. Plastics` and `CRP` are still two rows to Postgres; no index can
-- fix that and this one does not pretend to.
--
-- THIS CAN FAIL TO CREATE. If the target already holds two names differing only
-- in case, the migration aborts, which is the correct outcome. That is why this
-- goes to staging first, and why the owner checks
--   select lower(name), count(*) from public.clients group by 1 having count(*) > 1;
-- against production before applying it there.
create unique index clients_name_unique on public.clients (lower(name));
