-- Project line items: a month's project amount as a list of labelled fees.
-- The owner, 2026-11-05: "Can we make a spot for additional 'line items' in
-- case we charge multiple project fees". client_month_revenue.project_cents
-- stays the month's project total -- every chart and report reads it -- and is
-- now the SUM of the month's items whenever the screen sends them.

----------------------------------------------------------------------------
-- 1. The table
----------------------------------------------------------------------------

-- One row per fee. cents is strictly positive: a fee of nothing is no fee, and
-- the screen drops fully empty rows rather than sending a zero. position keeps
-- the order the person typed them in.
--
-- on delete RESTRICT, like client_month_revenue: revenue history must never
-- vanish because a client row was removed.
create table public.client_month_project_items (
  id          bigint generated always as identity primary key,
  client_id   bigint   not null,
  period      date     not null check (period = date_trunc('month', period)::date),
  label       text     not null check (char_length(btrim(label)) between 1 and 120),
  cents       integer  not null check (cents > 0),
  position    smallint not null default 0,
  created_at  timestamptz not null default now(),
  constraint client_month_project_items_client_id_fkey
    foreign key (client_id) references public.clients(id) on delete restrict
);

comment on table public.client_month_project_items is
  'A month''s project fees, in CENTS, one row per line item. client_month_revenue.project_cents is their sum when the payments box saves items.';

-- Every read is "this client's items for this month" (the payments box) or a
-- sweep of the whole table (the revenue page).
create index client_month_project_items_client_period
  on public.client_month_project_items (client_id, period);

----------------------------------------------------------------------------
-- 2. Grants and row level security, exactly like client_month_revenue's
----------------------------------------------------------------------------

-- Revoke before grant, the standing rule for every new table in public. All
-- four verbs, like client_retainers: replacing a month's items is a delete and
-- an insert, done by save_month_payment as the CALLER (security invoker). No
-- sequence grant: an identity column advances its sequence without one.
revoke all on public.client_month_project_items from anon, authenticated;
grant select, insert, update, delete on public.client_month_project_items to authenticated;

alter table public.client_month_project_items enable row level security;

create policy client_month_project_items_select_view_revenue
  on public.client_month_project_items
  for select
  to authenticated
  using ((select private.has_capability('view_revenue')));

create policy client_month_project_items_insert_edit_revenue
  on public.client_month_project_items
  for insert
  to authenticated
  with check ((select private.has_capability('edit_revenue')));

create policy client_month_project_items_update_edit_revenue
  on public.client_month_project_items
  for update
  to authenticated
  using ((select private.has_capability('edit_revenue')))
  with check ((select private.has_capability('edit_revenue')));

create policy client_month_project_items_delete_edit_revenue
  on public.client_month_project_items
  for delete
  to authenticated
  using ((select private.has_capability('edit_revenue')));

----------------------------------------------------------------------------
-- 3. save_month_payment, now with the items
----------------------------------------------------------------------------

-- A new argument changes the signature, and create or replace would leave the
-- 6-argument function callable beside the new one. Drop it first, so exactly
-- one overload exists and the grants below are the only ones.
drop function public.save_month_payment(bigint, date, integer, integer, boolean, text);

-- SECURITY INVOKER with an empty search_path, exactly as before and for the
-- same reasons (see 20261102120000_client_retainers.sql). Do not "fix" this to
-- definer: RLS on all three tables is the enforcement.
--
-- p_items null: behaviour exactly as before, for old callers.
-- p_items an array of {label, cents}: it REPLACES the month's items (delete,
-- then insert in array order), and project_cents becomes their sum --
-- p_project_cents is ignored. An empty array clears the items and the amount.
create function public.save_month_payment(
  p_client_id      bigint,
  p_period         date,
  p_retainer_cents integer,
  p_project_cents  integer,
  p_set_retainer   boolean,
  p_project_notes  text  default null,
  p_items          jsonb default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_project_cents integer;
begin
  v_project_cents := p_project_cents;
  if p_items is not null then
    select coalesce(sum(x.cents), 0) into v_project_cents
    from jsonb_to_recordset(p_items) as x(label text, cents integer);
  end if;

  insert into public.client_month_revenue
    (client_id, period, retainer_cents, project_cents, project_notes, entered_by)
  values
    (p_client_id, p_period, p_retainer_cents, v_project_cents,
     nullif(btrim(p_project_notes), ''), (select auth.uid()))
  on conflict (client_id, period) do update
    set retainer_cents = excluded.retainer_cents,
        project_cents  = excluded.project_cents,
        project_notes  = excluded.project_notes,
        entered_by     = excluded.entered_by;

  if p_items is not null then
    delete from public.client_month_project_items
    where client_id = p_client_id and period = p_period;

    -- ROWS FROM, because WITH ORDINALITY cannot sit beside a column
    -- definition list on the bare function call.
    insert into public.client_month_project_items
      (client_id, period, label, cents, position)
    select p_client_id, p_period, btrim(x.label), x.cents, (x.ord - 1)::smallint
    from rows from (jsonb_to_recordset(p_items) as (label text, cents integer))
      with ordinality as x(label, cents, ord);
  end if;

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

revoke execute on function public.save_month_payment(bigint, date, integer, integer, boolean, text, jsonb) from public, anon;
grant execute on function public.save_month_payment(bigint, date, integer, integer, boolean, text, jsonb) to authenticated;
