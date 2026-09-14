-- The revenue rows as they currently stand, shaped for planImport's `existing`
-- parameter, so a re-import can report what it would CHANGE rather than only
-- where it would write.
--
-- Read-only. No transaction, nothing to roll back.
--
-- PRODUCTION AND STAGING NEED SEPARATE SNAPSHOTS AND THEY ARE NOT
-- INTERCHANGEABLE. Staging carries test fixtures production does not, so a diff
-- generated against staging is not a preview of production's -- it is a
-- different answer that looks like the same one.
--
-- Save the single returned value beside the roster snapshots, as
-- revenue-rows-staging.json or revenue-rows-production.json.
select coalesce(
  json_agg(
    json_build_object(
      'client_id', client_id,
      -- to_char, not the bare date: the driver may hand back a timestamp, and
      -- '2026-07-01T00:00:00Z' does not match the 'YYYY-MM-01' strings every
      -- period in this toolchain is compared against as text.
      'period', to_char(period, 'YYYY-MM-DD'),
      'retainer_cents', retainer_cents,
      'project_cents', project_cents
    )
    order by client_id, period
  ),
  '[]'::json
) as rows
from public.client_month_revenue;
