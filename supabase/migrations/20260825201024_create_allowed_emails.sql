-- Pre-authorised sign-ins. Slice 3 design §5.1.
--
-- An invitation is a ROW, not a message. Nothing here sends email. A row means:
-- when this address first signs in, give it this role and activate it
-- immediately, so the admin is not in the critical path.
--
-- The table means exactly one thing -- invited, not yet arrived -- because
-- private.handle_new_user DELETES the row as it consumes it (Task 2). There is
-- no consumed state and therefore no way for the two lists on the screen to
-- disagree about a person.

create table public.allowed_emails (
  email      text primary key check (email = lower(email)),
  role       text not null default 'viewer'
             check (role in ('admin', 'account_manager', 'viewer')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.allowed_emails is
  'Pre-authorised sign-ins. private.handle_new_user consumes and deletes a row on first sign-in, applying its role and activating the account.';

comment on column public.allowed_emails.email is
  'Lowercase, enforced by check constraint rather than by convention. handle_new_user matches on lower(new.email); enforcing the stored side too means the two halves cannot drift into a match that silently never happens.';

comment on column public.allowed_emails.created_by is
  'Set null on profile delete, following clients.owner_id: losing a person must never delete the record. Dies with the row when the invitation is consumed -- Slice 3 design §5.2 records that as an accepted cost.';

alter table public.allowed_emails enable row level security;

-- The standing rule for every new table in public. Projects created before
-- Supabase's 2026-04-28 change carry
--   alter default privileges in schema public grant all on tables to anon, authenticated;
-- so this table is born fully writable by both browser roles no matter how
-- narrow the explicit grants below are. Revoke must come first: revoking a
-- table-level privilege also revokes it on every column.
revoke all on public.allowed_emails from anon, authenticated;

-- anon gets nothing. An unauthenticated caller has no business reading a list of
-- people who have been invited.
grant select, insert, update, delete on public.allowed_emails to authenticated;

-- All four gate on manage_users, which only `admin` holds. Each is wrapped in a
-- subselect so Postgres evaluates it once per statement rather than once per row.
create policy allowed_emails_select_manage_users
  on public.allowed_emails
  for select
  to authenticated
  using ((select private.has_capability('manage_users')));

create policy allowed_emails_insert_manage_users
  on public.allowed_emails
  for insert
  to authenticated
  with check ((select private.has_capability('manage_users')));

-- An update needs a select policy too, or the row is invisible to the statement
-- and the update silently affects nothing. The select policy above is what makes
-- this reachable.
create policy allowed_emails_update_manage_users
  on public.allowed_emails
  for update
  to authenticated
  using ((select private.has_capability('manage_users')))
  with check ((select private.has_capability('manage_users')));

create policy allowed_emails_delete_manage_users
  on public.allowed_emails
  for delete
  to authenticated
  using ((select private.has_capability('manage_users')));
