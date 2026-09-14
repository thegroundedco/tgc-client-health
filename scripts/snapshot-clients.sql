-- The client roster as it currently stands, shaped for planImport's `roster`
-- parameter.
--
-- Read-only. No transaction, nothing to roll back.
--
-- WHY THIS EXISTS. The roster snapshots in the import folder were taken BEFORE
-- the 2026 import and are stale by every client that import created. Planning
-- against one proposes creating clients that already exist -- which reads as a
-- list of new business rather than as a stale file, and is the kind of wrong
-- that looks plausible.
--
-- Separate per environment, for the same reason the revenue snapshot is:
-- staging carries test fixtures production does not.
select coalesce(
  json_agg(
    json_build_object(
      'id', id,
      'name', name,
      'status', status,
      -- to_char, not the bare date: '2026-07-01T00:00:00Z' does not match the
      -- 'YYYY-MM-DD' strings this toolchain compares against as text.
      'started_on', to_char(started_on, 'YYYY-MM-DD'),
      'ended_on', to_char(ended_on, 'YYYY-MM-DD')
    )
    order by name
  ),
  '[]'::json
) as clients
from public.clients;
