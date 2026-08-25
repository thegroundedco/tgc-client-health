-- Proves the DEPLOYED signup path applies an invitation and ignores a
-- non-invitation. Run with `npm run verify:invites`. Slice 3 design §8.
--
-- STAGING ONLY. This inserts into auth.users, which is a real account on a real
-- project. npm run db:which is wired into the script for that reason.
--
-- Both directions are checked in one run, because "the hit path works" and "the
-- miss path still defaults to inactive viewer" are separate claims and the
-- second is the one that keeps an uninvited stranger out.

do $$
declare
  hit_id     uuid := gen_random_uuid();
  miss_id    uuid := gen_random_uuid();
  hit_email  text;
  miss_email text;
  got_role   text;
  got_active boolean;
  leftover   bigint;
  problems   text[] := '{}';
begin
  hit_email  := 'verify-invites-hit-'  || replace(hit_id::text,  '-', '') || '@example.test';
  miss_email := 'verify-invites-miss-' || replace(miss_id::text, '-', '') || '@example.test';

  insert into public.allowed_emails (email, role) values (hit_email, 'account_manager');

  -- The columns Supabase's auth.users requires. If Postgres complains about a
  -- NOT NULL column not listed here, add it -- the schema is Supabase's, not
  -- this project's, and it changes between platform versions.
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values
    ('00000000-0000-0000-0000-000000000000', hit_id, 'authenticated', 'authenticated', hit_email,
     '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', miss_id, 'authenticated', 'authenticated', miss_email,
     '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

  ----------------------------------------------------------------------------
  -- The hit: invited role applied, account activated, invitation consumed.
  ----------------------------------------------------------------------------
  select role, is_active into got_role, got_active
    from public.profiles where id = hit_id;

  if got_role is distinct from 'account_manager' then
    problems := problems || format(
      'an INVITED signup got role %L, expected account_manager -- handle_new_user is not reading allowed_emails.role',
      got_role)::text;
  end if;

  if got_active is distinct from true then
    problems := problems || format(
      'an INVITED signup got is_active %L::boolean, expected true -- the invitation did not activate the account, so the admin is still in the critical path',
      got_active)::text;
  end if;

  select count(*) into leftover from public.allowed_emails where email = hit_email;
  if leftover <> 0 then
    problems := problems || format(
      'the invitation for an INVITED signup was not consumed (%s row(s) left) -- allowed_emails no longer means "invited, not yet arrived" and the screen will show the person twice',
      leftover)::text;
  end if;

  ----------------------------------------------------------------------------
  -- The miss: unchanged behaviour. This is the half that keeps strangers out.
  ----------------------------------------------------------------------------
  select role, is_active into got_role, got_active
    from public.profiles where id = miss_id;

  if got_role is distinct from 'viewer' then
    problems := problems || format(
      'an UNINVITED signup got role %L, expected viewer -- the miss path is no longer the old behaviour',
      got_role)::text;
  end if;

  if got_active is distinct from false then
    problems := problems || format(
      'an UNINVITED signup got is_active %L::boolean, expected false -- SIGNING UP NOW GRANTS ACCESS, which is the vulnerability profiles.is_active exists to prevent',
      got_active)::text;
  end if;

  ----------------------------------------------------------------------------
  -- Cleanup, before any raise. The ORDER of these three deletes is what the
  -- comment here used to explain, and it explained it twice over with two
  -- reasons that are both false:
  --
  --   (a) it said profiles_id_fkey is "not declared cascading". It is:
  --       20260820225355_create_profiles.sql line 7 declares
  --       `references auth.users (id) on delete cascade`. Deleting the auth.users
  --       row first would take the profiles row with it, not fail on it.
  --   (b) it implied the ordering is what stops a failure leaving accounts
  --       behind. It is not. The raise below aborts the transaction, and every
  --       delete above it rolls back with it -- cleanup included.
  --
  -- The OUTCOME is correct either way and the code is left exactly as it was:
  -- nothing persists. On a pass, these three deletes commit. On a failure, the
  -- raise rolls the whole DO block back, which un-inserts the two auth.users
  -- rows and the invitation just as effectively. What the order actually buys is
  -- explicitness -- the profiles rows are removed by a statement a reader can
  -- see, rather than by a cascade they have to know about -- and that is worth
  -- keeping, but it is not a correctness requirement and must not be recorded as
  -- one. The echoing SELECT at the foot of this file is what proves the table is
  -- clean afterwards, whichever path ran.
  ----------------------------------------------------------------------------
  delete from public.profiles      where id    in (hit_id, miss_id);
  delete from auth.users           where id    in (hit_id, miss_id);
  delete from public.allowed_emails where email in (hit_email, miss_email);

  if array_length(problems, 1) is not null then
    raise exception E'verify:invites FAILED\n\n  - %', array_to_string(problems, E'\n  - ');
  end if;

  raise notice 'verify:invites OK -- an invited signup is activated with its invited role and the invitation is consumed; an uninvited signup is still an inactive viewer';
end $$;

-- Echoed, because a NOTICE is invisible through `supabase db query` and this
-- SELECT is the only visible artifact of a pass. Zero rows here is the correct
-- and expected result: the run cleans up after itself, so anything left behind
-- is a cleanup bug worth seeing.
select email, role, created_at
  from public.allowed_emails
 where email like 'verify-invites-%'
 order by email;
