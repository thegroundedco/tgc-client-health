-- Asserts 20261105130000_project_line_items.sql and
-- 20261105140000_project_items_total_guard.sql against the live database: a
-- month's project_cents always equals the sum of its line items when it has
-- any. Run with `npm run verify:line-items`. Raises, listing every violation,
-- on any mismatch.
--
-- LEAVES NO DATA. The scratch client, its revenue row and items all live
-- inside one inner block that always ends by raising a sentinel; its handler
-- catches the sentinel, which rolls the whole block back to its savepoint (the
-- verify-hours.sql pattern). Only the `problems` array survives.
-- clients_id_seq and the items' identity sequence advance a few numbers per
-- run; accepted.
--
-- The guard is DEFERRED to commit, and this block never commits, so every
-- check forces it with SET CONSTRAINTS ... IMMEDIATE, which runs the pending
-- checks at once, and puts it back to DEFERRED before the next RPC call (the
-- RPC passes through mismatched states mid-statement, by design).
--
-- Runs as the owner, so RLS does not stand between the probe and the rule.
--
--   (l1) save_month_payment with two items passes, and sets project_cents to
--        their sum, items in array order.
--   (l2) a direct update of project_cents on that month, as Revenue entry
--        would send it, is refused with 23514 and the plain-words message.
--   (l3) save_month_payment with '[]' deletes every item, sets project_cents
--        to 0, and passes; a month with no items then takes any amount.

do $$
declare
  problems  text[] := '{}';
  sentinel  constant text := 'verify-line-items rollback sentinel';
  per       constant date := '2026-10-01';
  two_items constant jsonb := '[{"label": "Photo shoot", "cents": 50000}, {"label": "Dev", "cents": 30000}]';
  message   constant text := 'This month has project line items; change them in the check-in''s payments box.';

  v_client  bigint;
  v_project integer;
  v_labels  text;
  n_rows    bigint;
begin
  begin
    insert into public.clients (name) values ('Client A (verify-line-items)') returning id into v_client;

    --------------------------------------------------------------------------
    -- (l1) two items through the RPC.
    --------------------------------------------------------------------------
    set constraints public.client_month_revenue_items_total, public.client_month_project_items_total deferred;
    perform public.save_month_payment(v_client, per, 400000, 0, false, null, two_items);
    begin
      set constraints public.client_month_revenue_items_total, public.client_month_project_items_total immediate;
    exception when others then
      problems := problems || format('(l1) save_month_payment with two items was REFUSED by the guard: %s %s', sqlstate, sqlerrm);
    end;
    select project_cents into v_project from public.client_month_revenue where client_id = v_client and period = per;
    if v_project is distinct from 80000 then
      problems := problems || format('(l1) project_cents is %s after saving $500 + $300 of items, expected 80000', v_project);
    end if;
    select string_agg(label, ',' order by position) into v_labels
      from public.client_month_project_items where client_id = v_client and period = per;
    if v_labels is distinct from 'Photo shoot,Dev' then
      problems := problems || format('(l1) the items read back as %s, expected Photo shoot,Dev in that order', v_labels);
    end if;

    --------------------------------------------------------------------------
    -- (l2) Revenue entry's direct update, out of step with the items.
    --------------------------------------------------------------------------
    set constraints public.client_month_revenue_items_total, public.client_month_project_items_total deferred;
    begin
      update public.client_month_revenue set project_cents = 100000 where client_id = v_client and period = per;
      set constraints public.client_month_revenue_items_total, public.client_month_project_items_total immediate;
      problems := problems || '(l2) a direct update setting project_cents to 100000 over $800 of items was ALLOWED -- the guard is missing or not firing'::text;
    exception when others then
      if sqlstate <> '23514' or sqlerrm <> message then
        problems := problems || format('(l2) the mismatched update failed, but with %s "%s", expected 23514 "%s"', sqlstate, sqlerrm, message);
      end if;
    end;
    select project_cents into v_project from public.client_month_revenue where client_id = v_client and period = per;
    if v_project is distinct from 80000 then
      problems := problems || format('(l2) project_cents is %s after the refused update, expected 80000', v_project);
    end if;

    --------------------------------------------------------------------------
    -- (l3) clearing every item through the RPC.
    --------------------------------------------------------------------------
    set constraints public.client_month_revenue_items_total, public.client_month_project_items_total deferred;
    perform public.save_month_payment(v_client, per, 400000, 999, false, null, '[]'::jsonb);
    begin
      set constraints public.client_month_revenue_items_total, public.client_month_project_items_total immediate;
    exception when others then
      problems := problems || format('(l3) save_month_payment with [] was REFUSED by the guard: %s %s', sqlstate, sqlerrm);
    end;
    select project_cents into v_project from public.client_month_revenue where client_id = v_client and period = per;
    select count(*) into n_rows from public.client_month_project_items where client_id = v_client and period = per;
    if v_project is distinct from 0 or n_rows <> 0 then
      problems := problems || format('(l3) after saving [] the month has project_cents %s and %s item(s), expected 0 and 0', v_project, n_rows);
    end if;

    set constraints public.client_month_revenue_items_total, public.client_month_project_items_total deferred;
    begin
      update public.client_month_revenue set project_cents = 12345 where client_id = v_client and period = per;
      set constraints public.client_month_revenue_items_total, public.client_month_project_items_total immediate;
    exception when others then
      problems := problems || format('(l3) a direct update on a month with NO items was refused: %s %s -- the guard must only judge months that have items', sqlstate, sqlerrm);
    end;

    raise exception '%', sentinel;
  exception when others then
    if sqlerrm <> sentinel then
      problems := problems || format(
        'the probe block stopped early: %s %s -- the checks after that point are UNVERIFIED',
        sqlstate, sqlerrm)::text;
    end if;
  end;

  if array_length(problems, 1) > 0 then
    raise exception E'verify:line-items FAILED with % violation(s):\n  - %',
      array_length(problems, 1), array_to_string(problems, E'\n  - ');
  end if;

  raise notice 'verify:line-items OK -- the RPC keeps project_cents equal to its items, a mismatched direct update is refused, and clearing the items with [] passes';
end $$;

-- `db query` does not print RAISE NOTICE, so a pass would otherwise show only
-- an empty result. Reached only if the block above did not raise.
select 'verify:line-items OK' as result;
