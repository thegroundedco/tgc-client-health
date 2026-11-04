-- Fetch last month's Productive budget hours on the 1st, 12:00 UTC, two hours
-- before the AI routine's 14:00 run, so the routine finds the month's numbers
-- already stored.
--
-- Nothing secret lives in this file. At each run the job reads three Vault
-- secrets (set by the owner, never committed):
--   productive_hours_fn_url          the edge function's address
--   productive_hours_cron_secret     the function's HOURS_CRON_SECRET
--   productive_hours_anon_key        the project's anon key; the function is
--                                    deployed with verify_jwt on, so the call
--                                    needs a bearer token as well as the secret
-- The period is the first of the previous month, computed in SQL.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- cron.schedule with an existing name replaces that job, so re-running is safe.
select cron.schedule(
  'fetch-productive-hours-monthly',
  '0 12 1 * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'productive_hours_fn_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'productive_hours_anon_key'),
      'x-hours-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'productive_hours_cron_secret')
    ),
    body := jsonb_build_object('period', date_trunc('month', now() - interval '1 month')::date),
    timeout_milliseconds := 120000
  );
  $cron$
);
