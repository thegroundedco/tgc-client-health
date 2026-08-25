-- Seeds STAGING with three fixture subjects that `npm run verify:privileges`
-- needs before three of its checks mean anything. Run with
-- `npm run seed:verifier-subjects`. Slice 3 design §8/§10.
--
-- STAGING ONLY. This inserts into auth.users, exactly as scripts/verify-invites.sql
-- does, and for the same reason: npm run db:which is wired into the npm script so
-- this can never fire against production by accident.
--
-- WHAT THIS CREATES, AND WHY EACH ONE EXISTS.
--
--   1. An ACTIVE account_manager. Built by walking the product's own invitation
--      mechanism -- a public.allowed_emails row, then an auth.users row -- rather
--      than writing the public.profiles row directly, so this seed exercises the
--      real signup path and breaks loudly if private.handle_new_user ever
--      regresses. Fills the precondition verify-privileges.sql section 10f
--      reports: "public.profiles contains no ACTIVE row with role =
--      account_manager, so the check that an account manager CAN still write
--      went UNEXERCISED -- and that is the direction in which a mistake here
--      takes the app away from everybody."
--
--   2. An INACTIVE account. An auth.users row with NO matching invitation, so
--      private.handle_new_user's miss path (20260825201446_invitation_on_signup.sql)
--      leaves it role='viewer', is_active=false -- exactly the subject section
--      10g needs to prove an unapproved signup cannot read the staff list.
--
--   3. One UNCONSUMED invitation, left sitting in public.allowed_emails because
--      nothing ever signs up with its address. Without it, section 10h's "a
--      viewer sees zero invitations" is true only because the table is empty
--      (0 = 0), and the invitation READ gate goes UNEXERCISED.
--
-- UNLIKE verify:invites, THESE ROWS ARE MEANT TO PERSIST. verify:invites cleans
-- up after itself because its whole job is to prove a code path fires correctly,
-- once, on demand. This script's job is the opposite: to give every OTHER
-- verifier a standing fixture to point at, run after run -- so it is written to
-- be idempotent rather than self-deleting. Fixed uuids and fixed addresses
-- (never gen_random_uuid(), unlike verify-invites.sql) are what let a second run
-- recognise what the first run already built and change nothing.
--
-- DOES NOT TOUCH josh@thegroundedcompany.com or beckman689@gmail.com -- staging's
-- two pre-existing profiles, neither read nor written anywhere below. Every
-- identifier this file creates is scoped to the single fake domain
-- @seed-verifier-subjects.invalid -- the .invalid TLD is reserved by RFC 2606 for
-- addresses that must never resolve, and the prefixes below (account-manager,
-- inactive, unconsumed-invite) say in the address itself what each row is for,
-- so nobody mistakes a fixture for a colleague.
--
-- HOW TO REMOVE THESE FIXTURES: see the comment block at the foot of this file.

do $$
declare
  -- FIXED, not gen_random_uuid(). A fresh random id on every run is exactly what
  -- would break idempotency -- run this twice with random ids and staging ends
  -- up with two account managers and two inactive accounts instead of one of
  -- each. "5eed" is a mnemonic for "seed", not a real UUID version marker.
  am_id    uuid := '5eed0000-0000-4000-8000-000000000001';
  am_email text := 'seed-verifier-account-manager@seed-verifier-subjects.invalid';

  inactive_id    uuid := '5eed0000-0000-4000-8000-000000000002';
  inactive_email text := 'seed-verifier-inactive@seed-verifier-subjects.invalid';

  unconsumed_email text := 'seed-verifier-unconsumed-invite@seed-verifier-subjects.invalid';

  got_role   text;
  got_active boolean;
begin
  ----------------------------------------------------------------------------
  -- Subject 1: an ACTIVE account_manager, built through the real invitation
  -- path (public.allowed_emails row, then a signup) rather than an INSERT
  -- straight into public.profiles.
  --
  -- Guarded on auth.users, not on the profile or the invitation, because that
  -- is the row every later run can check cheaply and the one that only ever
  -- gets created once: public.profiles.id references auth.users(id)
  -- ON DELETE CASCADE (20260820225355_create_profiles.sql), so as long as this
  -- row exists its profile does too, and there is nothing further to redo.
  ----------------------------------------------------------------------------
  if not exists (select 1 from auth.users where id = am_id) then
    insert into public.allowed_emails (email, role)
    values (am_email, 'account_manager')
    -- ON CONFLICT rather than a bare insert: a previous run could in principle
    -- have created the invitation and been interrupted before the auth.users
    -- insert below landed. Harmless either way -- private.handle_new_user
    -- consumes whichever row is there by email, not by when it arrived.
    on conflict (email) do nothing;

    -- The same eleven columns scripts/verify-invites.sql uses, copied verbatim.
    -- That file worked first try, so this is the known-good list for whatever
    -- Supabase platform version this project runs -- the schema is Supabase's,
    -- not this project's, and it changes between platform versions.
    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', am_id, 'authenticated', 'authenticated', am_email,
      '', now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
    );

    -- Proves the trigger actually did its job, rather than trusting that an
    -- insert with no error means the right row came out the other side. Format
    -- specifier is %L::boolean, not %s -- format('%s', <boolean>) emits an
    -- unquoted t/f, which parses as a column reference if this text ever ends
    -- up inside executed SQL, so every boolean below is cast explicitly.
    select role, is_active into got_role, got_active
      from public.profiles where id = am_id;

    if got_role is distinct from 'account_manager' or got_active is distinct from true then
      raise exception '%', format(
        'seed-verifier-subjects FAILED to build the account_manager subject -- got role %L, is_active %L::boolean, expected account_manager / true. private.handle_new_user is not applying the invitation the way scripts/verify-invites.sql already proves it should.',
        got_role, got_active);
    end if;

    if exists (select 1 from public.allowed_emails where email = am_email) then
      raise exception '%', format(
        'seed-verifier-subjects FAILED -- the invitation for %L was not consumed by private.handle_new_user, so public.allowed_emails now means two things at once (invited-not-arrived, and invited-and-already-here)',
        am_email);
    end if;
  end if;

  ----------------------------------------------------------------------------
  -- Subject 2: an INACTIVE account. No invitation is inserted for this address
  -- at all -- that absence IS the fixture. private.handle_new_user's miss path
  -- (20260825201446_invitation_on_signup.sql) leaves role='viewer',
  -- is_active=false, byte for byte the pre-Slice-3 default: an unapproved
  -- signup must never come out with access.
  ----------------------------------------------------------------------------
  if not exists (select 1 from auth.users where id = inactive_id) then
    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', inactive_id, 'authenticated', 'authenticated', inactive_email,
      '', now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
    );

    select role, is_active into got_role, got_active
      from public.profiles where id = inactive_id;

    if got_role is distinct from 'viewer' or got_active is distinct from false then
      raise exception '%', format(
        'seed-verifier-subjects FAILED to build the inactive subject -- got role %L, is_active %L::boolean, expected viewer / false. The miss path in private.handle_new_user has changed.',
        got_role, got_active);
    end if;
  end if;

  ----------------------------------------------------------------------------
  -- Subject 3: one UNCONSUMED invitation. Nothing ever signs up with this
  -- address, so it just sits in public.allowed_emails -- which is the point:
  -- section 10h's "a viewer sees zero invitations" needs a non-empty table to
  -- mean anything.
  ----------------------------------------------------------------------------
  insert into public.allowed_emails (email, role)
  values (unconsumed_email, 'viewer')
  on conflict (email) do nothing;

  raise notice 'seed-verifier-subjects OK -- an active account_manager, an inactive account, and one unconsumed invitation now exist on staging';
end $$;

-- Echoed, for the two gotchas this file was written against: `supabase db
-- query` shows only this LAST statement's rows, and the NOTICE above is
-- invisible through that path -- so this SELECT is the only visible evidence a
-- run succeeded. Three rows are expected: the account_manager profile
-- (is_active = true), the inactive profile (is_active = false), and the
-- unconsumed invitation (is_active is null -- it has no profile at all, which
-- is exactly the point of it).
select
  'profiles'::text as source,
  email,
  role,
  is_active::text  as is_active,
  created_at
from public.profiles
where email like '%@seed-verifier-subjects.invalid'
union all
select
  'allowed_emails (unconsumed)'::text as source,
  email,
  role,
  null::text as is_active,
  created_at
from public.allowed_emails
where email like '%@seed-verifier-subjects.invalid'
order by source, email;

----------------------------------------------------------------------------
-- HOW TO REMOVE THESE FIXTURES.
--
-- Not automated in this file, on purpose: this script's whole job is to make
-- rows that PERSIST across runs, so a delete path living in the same file as
-- the create path is a footgun waiting for a stray uncommented line. When
-- staging needs to be clean, confirm `npm run db:which` names
-- tgc-client-health-staging and then run the two statements below by hand
-- (dashboard SQL editor, or `supabase db query --linked` with a scratch file):
--
--   delete from auth.users
--    where email like '%@seed-verifier-subjects.invalid';
--   -- public.profiles_id_fkey is declared ON DELETE CASCADE
--   -- (20260820225355_create_profiles.sql), so both seeded profile rows go
--   -- with it. Nothing else in the schema references either row.
--
--   delete from public.allowed_emails
--    where email like '%@seed-verifier-subjects.invalid';
--   -- Removes the unconsumed invitation. The account_manager's own invitation
--   -- is already gone by this point -- private.handle_new_user deleted it the
--   -- moment that row was consumed above -- so this only ever finds the one.
----------------------------------------------------------------------------
