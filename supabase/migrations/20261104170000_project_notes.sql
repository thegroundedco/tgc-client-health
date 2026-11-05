-- A note on what a month's project amount covers, e.g. "$1,500 dev fees,
-- $2,500 photo shoot". From the Client Health call with Kurt and Nick: the
-- amount was already stored (project_cents); what it was FOR was not.

----------------------------------------------------------------------------
-- 1. The column
----------------------------------------------------------------------------

-- Nullable: no note is the ABSENCE of text, never an empty string, so the check
-- refuses '' as well as anything past 500 characters. save_month_payment turns
-- a blank or whitespace-only note into null before it gets here.
--
-- No policy and no grant change: client_month_revenue's table-level grants and
-- its view_revenue / edit_revenue policies already cover a new column
-- (20260903120000_revenue_has_capability.sql).
alter table public.client_month_revenue
  add column project_notes text,
  add constraint client_month_revenue_project_notes_length
    check (project_notes is null or char_length(project_notes) between 1 and 500);

----------------------------------------------------------------------------
-- 2. save_month_payment, now with the note
----------------------------------------------------------------------------

-- A new argument changes the signature, and create or replace would leave the
-- 5-argument function callable beside the new one. Drop it first, so exactly
-- one overload exists and the grants below are the only ones.
drop function public.save_month_payment(bigint, date, integer, integer, boolean);

-- SECURITY INVOKER with an empty search_path, exactly as before and for the
-- same reasons (see 20261102120000_client_retainers.sql). Do not "fix" this to
-- definer.
create function public.save_month_payment(
  p_client_id      bigint,
  p_period         date,
  p_retainer_cents integer,
  p_project_cents  integer,
  p_set_retainer   boolean,
  p_project_notes  text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.client_month_revenue
    (client_id, period, retainer_cents, project_cents, project_notes, entered_by)
  values
    (p_client_id, p_period, p_retainer_cents, p_project_cents,
     nullif(btrim(p_project_notes), ''), (select auth.uid()))
  on conflict (client_id, period) do update
    set retainer_cents = excluded.retainer_cents,
        project_cents  = excluded.project_cents,
        project_notes  = excluded.project_notes,
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

revoke execute on function public.save_month_payment(bigint, date, integer, integer, boolean, text) from public, anon;
grant execute on function public.save_month_payment(bigint, date, integer, integer, boolean, text) to authenticated;
