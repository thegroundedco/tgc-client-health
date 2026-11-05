-- A month's project amount must equal the sum of its line items, whenever it
-- has any (review of brief 2026-11-05 B, Critical 1).
--
-- client_month_revenue.project_cents is written from two places: the check-in's
-- payments box, through save_month_payment, which sets it to the items' sum;
-- and Revenue entry, which upserts it directly and knows nothing about items.
-- Without this guard Revenue entry could set a month with $500 + $300 of items
-- to $1,000; the check-in then showed $800 of items above "Project total
-- $1,000", and the next retainer-only save there quietly reset it to $800.
--
-- THE RULE. At commit, for every (client, period) an insert, update or delete
-- touched on either table: if the month has at least one item, project_cents
-- must equal the sum of their cents. A month with no items is not checked, so
-- every month entered before items existed, and every month Revenue entry
-- writes that has none, is unaffected.
--
-- DEFERRED, because save_month_payment legitimately passes through states
-- that break the rule mid-transaction: it upserts the new total first, then
-- deletes and re-inserts the items. Only the state at commit is judged.

----------------------------------------------------------------------------
-- 1. The check
----------------------------------------------------------------------------

-- SECURITY DEFINER, so the check sees every item and the revenue row whoever
-- fired it: a caller's RLS must not hide the rows the check is about. An empty
-- search_path, and every name schema-qualified. Execute is revoked below; a
-- trigger function's EXECUTE is checked at CREATE TRIGGER time against the
-- creator, never against the caller at query time.
create function private.check_project_items_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys     jsonb;
  v_key      jsonb;
  v_client   bigint;
  v_period   date;
  v_items    bigint;
  v_sum      bigint;
  v_project  integer;
begin
  if tg_op = 'DELETE' then
    v_keys := jsonb_build_array(jsonb_build_object('c', old.client_id, 'p', old.period));
  elsif tg_op = 'UPDATE' then
    -- An update that moves a row to another month leaves the old month
    -- behind, and that month must still add up.
    v_keys := jsonb_build_array(
      jsonb_build_object('c', new.client_id, 'p', new.period),
      jsonb_build_object('c', old.client_id, 'p', old.period));
  else
    v_keys := jsonb_build_array(jsonb_build_object('c', new.client_id, 'p', new.period));
  end if;

  for v_key in select value from jsonb_array_elements(v_keys)
  loop
    v_client := (v_key->>'c')::bigint;
    v_period := (v_key->>'p')::date;

    select count(*), coalesce(sum(i.cents), 0)
      into v_items, v_sum
      from public.client_month_project_items i
     where i.client_id = v_client and i.period = v_period;

    if v_items > 0 then
      select r.project_cents
        into v_project
        from public.client_month_revenue r
       where r.client_id = v_client and r.period = v_period;

      if v_project is distinct from v_sum then
        raise exception using
          errcode = '23514',
          message = 'This month has project line items; change them in the check-in''s payments box.',
          detail  = format('Client %s, %s: project amount %s, line items add up to %s (cents).',
                           v_client, v_period, coalesce(v_project::text, 'missing'), v_sum);
      end if;
    end if;
  end loop;

  return null;
end;
$$;

revoke execute on function private.check_project_items_total() from public, anon, authenticated;

----------------------------------------------------------------------------
-- 2. The two constraint triggers, deferred to commit
----------------------------------------------------------------------------

create constraint trigger client_month_revenue_items_total
  after insert or update on public.client_month_revenue
  deferrable initially deferred
  for each row execute function private.check_project_items_total();

create constraint trigger client_month_project_items_total
  after insert or update or delete on public.client_month_project_items
  deferrable initially deferred
  for each row execute function private.check_project_items_total();
