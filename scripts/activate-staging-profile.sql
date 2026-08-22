-- Promotes the profile that staging's sign-in trigger created, so staging has
-- an active user and its policies are actually exercised. Staging had none
-- through all of step 2, which meant every policy on it was untested.
--
-- Run:
--   npm run db:which                     -- must print tgc-client-health-staging
--   npx --yes supabase@latest db query --linked -f scripts/activate-staging-profile.sql
--
-- The profile row only exists after a real sign-in at http://localhost:5173,
-- because profiles.id is a foreign key to auth.users(id). Supabase's built-in
-- email is capped at 2 messages an hour, so a mistyped address costs half an
-- hour.
--
-- Why this is a do block and not a bare update. An `update ... where email = ...`
-- that matches no row succeeds and prints nothing, so the two ways this can go
-- wrong -- nobody has signed in yet, or they signed in under a different address
-- than the one below -- would both look exactly like success. That is the same
-- shape as the defect Slice 1 exists to fix, so this raises instead, and names
-- the addresses it did find.
--
-- TARGET is the address you signed into STAGING with. The Supabase account is
-- registered on an alias, so this is not necessarily the address you read mail
-- at -- if the exception below lists something else, that listed address is the
-- one to use.
do $$
declare
  target   text := 'josh@thegroundedcompany.com';
  affected integer;
  present  text;
begin
  update public.profiles
     set role = 'admin', is_active = true
   where email = target;

  get diagnostics affected = row_count;

  if affected = 0 then
    select coalesce(string_agg(email, ', ' order by email), '(no profiles at all)')
      into present
      from public.profiles;

    raise exception
      E'activate-staging-profile MATCHED NO ROW for %.\n\nProfiles present: %.\n\nEither nobody has signed in to staging yet -- run `npm run dev`, sign in at http://localhost:5173 and click the emailed link -- or the address above is not the one the sign-in used. Set `target` to one of the addresses listed and re-run.',
      target, present;
  end if;

  raise notice 'activate-staging-profile OK -- % profile(s) now role=admin, is_active=true for %', affected, target;
end $$;
