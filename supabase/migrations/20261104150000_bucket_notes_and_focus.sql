-- Per-bucket notes and a monthly focus on each check-in.
--
-- Spec: docs/superpowers/specs/2026-11-04-bucket-notes-and-focus-design.md
-- (section 1).
--
-- Two columns on public.checkins:
--   bucket_notes jsonb not null default '{}'
--       { "<bucket>": { "why"?: text, "actions"?: text } }. Keys are only the
--       six bucket names; each value is an object with only why and/or
--       actions; each string is 1 to 2000 characters; a bucket with neither
--       field is absent (an empty object is rejected).
--   focus text
--       null, or 1 to 1000 characters.
-- The app trims text and stores an empty string as absent (key removed, focus
-- null), so these constraints only ever refuse something the app would not
-- have sent.
--
-- WHY JSONB ON THE ROW, not a notes table. The columns inherit the existing
-- checkins RLS policies and grants, so this migration adds no policy and no
-- grant on the table, and the one upsert
-- that saves a check-in saves its notes and focus in the same statement.
-- Notes never feed a score: no generated column, view or trigger reads them.
--
-- WHY private.valid_bucket_notes IS SECURITY INVOKER, NOT DEFINER. The usual
-- rule here is a definer function in private with execute revoked from
-- public, anon and authenticated. That would break this one. A CHECK
-- constraint runs the function with the privileges of the role doing the
-- INSERT or UPDATE: the executor checks EXECUTE on the function against the
-- current user when it initialises the expression (ExecInitFunc, which uses
-- GetUserId()), and does not substitute the table owner. So with execute
-- revoked from authenticated, every check-in save by a signed-in person would
-- fail with "permission denied for function valid_bucket_notes". Instead the
-- function is immutable and security invoker, with search_path pinned to the
-- empty string, and execute is granted to authenticated (the app's saves) and
-- service_role (the AI routine's writes). It reads no tables, so running it
-- with the caller's privileges exposes nothing; the definer rule exists to
-- let a function read tables the caller cannot, and this one reads none.
-- anon stays revoked: anon cannot write check-ins. Nothing needs USAGE on
-- private to run it: the constraint refers to the function by OID.
-- scripts/verify-privileges.sql section 9 sweeps every private function for
-- EXECUTE held by anon or authenticated, so the function is added to its
-- private_fn_allowed list as 'private.valid_bucket_notes(jsonb)|authenticated'.
-- It is in private, not public, so it is not an RPC-callable surface in the
-- API's exposed schema.

alter table public.checkins
  add column bucket_notes jsonb not null default '{}'::jsonb,
  add column focus text;

create function private.valid_bucket_notes(p jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p is not null
    and jsonb_typeof(p) = 'object'
    and not exists (
      select 1
      from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) as b(k, v)
      where b.k <> all (array['communication', 'growth', 'finances', 'relationship', 'delivery', 'advocacy'])
        or jsonb_typeof(b.v) <> 'object'
        or b.v = '{}'::jsonb
        or exists (
          select 1
          from jsonb_each(case when jsonb_typeof(b.v) = 'object' then b.v else '{}'::jsonb end) as f(fk, fv)
          where f.fk <> all (array['why', 'actions'])
            or jsonb_typeof(f.fv) <> 'string'
            or char_length(f.fv #>> '{}') not between 1 and 2000
        )
    )
$$;

revoke execute on function private.valid_bucket_notes(jsonb) from public, anon;
grant execute on function private.valid_bucket_notes(jsonb) to authenticated, service_role;

alter table public.checkins
  add constraint checkins_bucket_notes_valid check (private.valid_bucket_notes(bucket_notes)),
  add constraint checkins_focus_length check (focus is null or char_length(focus) between 1 and 1000);
