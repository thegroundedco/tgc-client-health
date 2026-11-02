-- Payments on the check-in. The database half: a per-client retainer, and one
-- function that saves a month's revenue and, optionally, the retainer together.
--
-- Spec: docs/superpowers/specs/2026-11-02-payments-on-checkin-design.md (1, 4).

----------------------------------------------------------------------------
-- 1. The table
----------------------------------------------------------------------------

-- Why a table and not a column on public.clients: clients is readable by every
-- role that can see scores, viewers included, and Postgres RLS is row-level,
-- not column-level. A retainer_cents column there would be visible to anyone
-- who can read a client. A separate table can carry its own policies, so the
-- amount is gated by view_revenue exactly like client_month_revenue (spec 1).
--
-- The foreign key is named explicitly, as on client_month_revenue, so there is
-- no guess about auto-naming in anything that refers to it.
--
-- on delete RESTRICT, like client_month_revenue and unlike checkins: a client
-- with money attached must refuse deletion rather than take its figures with
-- it. The operator sets status = 'former' instead.
--
-- Integer CENTS, capped at the integer ceiling. Zero is not allowed: "no
-- retainer" is the ABSENCE of a row, which is what save_month_payment does
-- when it is told 0.
create table public.client_retainers (
  client_id      bigint  primary key,
  monthly_cents  integer not null check (monthly_cents > 0 and monthly_cents <= 2147483647),
  updated_by     uuid    references public.profiles(id) on delete set null,
  updated_at     timestamptz not null default now(),
  constraint client_retainers_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete restrict
);

comment on table public.client_retainers is
  'The standing monthly retainer for a client, in CENTS. No row means no retainer; a row is always positive.';

----------------------------------------------------------------------------
-- 2. The updated_at trigger
----------------------------------------------------------------------------

-- Same as every other table with an updated_at. Without it the column never
-- advances past insert time and the audit trail is quietly wrong.
create trigger client_retainers_touch_updated_at
  before update on public.client_retainers
  for each row execute function private.touch_updated_at();

----------------------------------------------------------------------------
-- 3. Privileges
----------------------------------------------------------------------------

-- Revoke first: on this project a new table in public can be born writable by
-- anon and authenticated.
revoke all on public.client_retainers from anon, authenticated;
grant select, insert, update, delete on public.client_retainers to authenticated;

alter table public.client_retainers enable row level security;

-- Four policies, including delete -- unlike client_month_revenue, which has
-- none. A revenue month entered in error is corrected by editing it, but a
-- retainer can genuinely END, and the only way to say "no retainer" is to
-- remove the row (the table forbids zero). save_month_payment is security
-- invoker, so that delete runs as the caller and needs a policy to be allowed.
create policy client_retainers_select_view_revenue
  on public.client_retainers
  for select
  to authenticated
  using ((select private.has_capability('view_revenue')));

create policy client_retainers_insert_edit_revenue
  on public.client_retainers
  for insert
  to authenticated
  with check ((select private.has_capability('edit_revenue')));

create policy client_retainers_update_edit_revenue
  on public.client_retainers
  for update
  to authenticated
  using ((select private.has_capability('edit_revenue')))
  with check ((select private.has_capability('edit_revenue')));

create policy client_retainers_delete_edit_revenue
  on public.client_retainers
  for delete
  to authenticated
  using ((select private.has_capability('edit_revenue')));

----------------------------------------------------------------------------
-- 4. save_month_payment
----------------------------------------------------------------------------

-- One function so it is one transaction: when the person answers "Yes" to
-- updating the retainer, the month's revenue and the retainer are written
-- together or not at all (spec 4).
--
-- SECURITY INVOKER, deliberately, not definer. The function does nothing the
-- caller could not do with two statements, so it should not borrow anyone's
-- rights: it runs as the caller, every statement passes through RLS, and an
-- account manager (view_revenue only) is refused by the same policies that
-- refuse them anywhere else. A definer function would have to re-implement
-- that check by hand, and a mistake there would be a privilege escalation.
-- Do not "fix" this to definer.
--
-- search_path is empty, so every name is schema-qualified.
create function public.save_month_payment(
  p_client_id      bigint,
  p_period         date,
  p_retainer_cents integer,
  p_project_cents  integer,
  p_set_retainer   boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.client_month_revenue
    (client_id, period, retainer_cents, project_cents, entered_by)
  values
    (p_client_id, p_period, p_retainer_cents, p_project_cents, (select auth.uid()))
  on conflict (client_id, period) do update
    set retainer_cents = excluded.retainer_cents,
        project_cents  = excluded.project_cents,
        entered_by     = excluded.entered_by;

  if p_set_retainer then
    if p_retainer_cents > 0 then
      insert into public.client_retainers (client_id, monthly_cents, updated_by)
      values (p_client_id, p_retainer_cents, (select auth.uid()))
      on conflict (client_id) do update
        set monthly_cents = excluded.monthly_cents,
            updated_by    = excluded.updated_by;
    else
      delete from public.client_retainers
      where client_id = p_client_id;
    end if;
  end if;
end;
$$;

revoke execute on function public.save_month_payment(bigint, date, integer, integer, boolean) from public, anon;
grant execute on function public.save_month_payment(bigint, date, integer, integer, boolean) to authenticated;
