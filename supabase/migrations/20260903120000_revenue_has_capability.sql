-- Slice 6c. The revenue history the Revenue page has been saying it needs, plus
-- the two capabilities that gate it.
--
-- ORDER IS LOAD-BEARING: the function is replaced BEFORE the policies that name
-- the new capabilities are created. A policy referencing a capability the
-- function does not know would not error -- has_capability simply returns false
-- -- so the failure would be a table nobody can read, discovered by a person
-- rather than by Postgres.

----------------------------------------------------------------------------
-- 1. The capability function, replaced
----------------------------------------------------------------------------

-- create or replace, not drop and create: the three policies from
-- 20260824160306_has_capability.sql store this function by OID and would be
-- dropped with it. Replacing keeps the OID and every existing policy intact.
--
-- The signature, the security definer, the empty search_path and the grants are
-- unchanged and are not restated -- replace preserves them. The reasoning for
-- each is in 20260824160306_has_capability.sql and has not changed.
--
-- account_manager gets view_revenue but NOT edit_revenue. That is the first
-- capability in this model where a non-viewer role reads without writing, and
-- it is the owner's decision of 2026-09-03: admins edit, account managers view,
-- viewers see no revenue at all.
create or replace function private.has_capability(wanted text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and wanted = any (
        case p.role
          when 'admin' then array[
            'view_scores', 'edit_scores', 'manage_clients', 'manage_users',
            'view_revenue', 'edit_revenue']
          when 'account_manager' then array[
            'view_scores', 'edit_scores', 'manage_clients',
            'view_revenue']
          when 'viewer' then array[
            'view_scores']
          else array[]::text[]
        end
      )
  );
$$;

----------------------------------------------------------------------------
-- 2. The table
----------------------------------------------------------------------------

-- The client_id foreign key is named explicitly rather than left to
-- Postgres's <table>_<column>_fkey auto-naming. The auto-generated name would
-- almost certainly come out identical, but this migration is authored and
-- never applied here -- the owner applies it -- so a wrong guess would surface
-- as a failed `comment on constraint` against production rather than as a
-- failed test on this machine. Naming it removes the guess.
create table public.client_month_revenue (
  client_id       bigint  not null,
  period          date    not null check (period = date_trunc('month', period)::date),
  retainer_cents  integer not null default 0 check (retainer_cents >= 0),
  project_cents   integer not null default 0 check (project_cents >= 0),
  entered_by      uuid    references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (client_id, period),
  constraint client_month_revenue_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete restrict
);

-- on delete RESTRICT, deliberately unlike checkins.client_id, which cascades.
-- Deleting a client there destroys its check-in history silently and the newest
-- backup is up to a day old. Financial history must refuse rather than vanish:
-- the delete fails loudly and the operator sets status = 'former' instead,
-- which is the reversible action they wanted anyway. A reviewer should not
-- "fix" this to match its neighbour.
comment on constraint client_month_revenue_client_id_fkey on public.client_month_revenue is
  'restrict, not cascade: revenue history refuses to vanish with a deleted client.';

-- Integer CENTS. 4000.10 has no exact binary floating-point representation, and
-- a retention figure summed from a hundred such values drifts invisibly until
-- somebody reconciles against an invoice. integer not bigint: the ceiling is
-- $21,474,836.47 per client-month, four orders of magnitude above anything this
-- agency bills -- naming a limit that cannot be reached is how a reader learns
-- the unit is cents.
comment on column public.client_month_revenue.retainer_cents is
  'Recurring monthly amount, in CENTS. Retention math reads this one.';
comment on column public.client_month_revenue.project_cents is
  'Variable project or overage billing for this month, in CENTS. Real revenue, but not expected to repeat.';

-- The existence of a row is data. A row with project_cents = 0 means "entered;
-- billed nothing". No row at all means "nobody has said yet". Collapsing those
-- makes an unfilled month read as a client billing nothing, which on a page
-- measuring churn reads as churn. Same rule as checkins.legacy_total_score
-- being null whenever a pillar is null.
comment on table public.client_month_revenue is
  'One row per client per month. A MISSING ROW IS NOT A ZERO: absent means unentered, not unbilled.';

----------------------------------------------------------------------------
-- 3. The updated_at trigger
----------------------------------------------------------------------------

-- Every other table in this schema with an updated_at column wires one of
-- these: public.profiles (20260820225355), public.clients and public.checkins
-- (20260821021840). Without it, updated_at never advances past insert time,
-- which would quietly gut the audit story parent spec section 8.6 claims for
-- this table -- "who changed a figure and when is recorded" -- while Task 6's
-- upsert path makes every row look like it was just written. No grant needed:
-- trigger-function EXECUTE is checked at CREATE TRIGGER time against the
-- creator, not against the caller at query time.
create trigger client_month_revenue_touch_updated_at
  before update on public.client_month_revenue
  for each row execute function private.touch_updated_at();

----------------------------------------------------------------------------
-- 4. Privileges
----------------------------------------------------------------------------

-- Before the grants, per the standing rule for every new table in public: on
-- this project a new table can be born writable by anon and authenticated, and
-- the fixing migration for the original project ran before either of the
-- current ones could be inspected.
revoke all on public.client_month_revenue from anon, authenticated;
grant select, insert, update on public.client_month_revenue to authenticated;

alter table public.client_month_revenue enable row level security;

-- Three policies, not four. There is no delete policy and that is the intent:
-- removing a month is not an operation the screen offers, and a month entered
-- in error is corrected by editing it. With no policy, delete is refused for
-- everyone -- the desired behaviour, needing no additional machinery.
create policy client_month_revenue_select_view_revenue
  on public.client_month_revenue
  for select
  to authenticated
  using ((select private.has_capability('view_revenue')));

create policy client_month_revenue_insert_edit_revenue
  on public.client_month_revenue
  for insert
  to authenticated
  with check ((select private.has_capability('edit_revenue')));

-- An update needs a select policy too, or the row is invisible to the statement
-- and the update silently affects nothing. The select policy above is what
-- makes this reachable -- and note it gates on view_revenue, which an account
-- manager holds, so the SELECT half succeeds for them and the update half does
-- not. That asymmetry is the point.
create policy client_month_revenue_update_edit_revenue
  on public.client_month_revenue
  for update
  to authenticated
  using ((select private.has_capability('edit_revenue')))
  with check ((select private.has_capability('edit_revenue')));
