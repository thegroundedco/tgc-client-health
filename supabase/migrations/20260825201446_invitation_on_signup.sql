-- handle_new_user becomes conditional. Slice 3 design §5.2.
--
-- The MISS path is byte-for-byte the old behaviour: viewer, inactive, pending
-- screen. That is deliberate and load-bearing. It is how somebody who signs in
-- without an invitation is still reachable by an admin, and it is the only route
-- open to an account that already existed before this migration -- no trigger
-- will ever fire for those again.
--
-- create or replace, so the existing on_auth_user_created trigger keeps pointing
-- at it. Postgres preserves the function's ACL across a replace; the revoke below
-- is repeated anyway so this file states the whole privilege picture rather than
-- depending on a previous migration being read alongside it.
--
-- Still security definer, because the signing-up user has no rights on profiles
-- yet -- and now also none on allowed_emails, which is gated on manage_users.
-- The function owner bypasses RLS, which is what lets the lookup succeed.
-- search_path is empty, so every name below is schema-qualified.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited public.allowed_emails%rowtype;
begin
  -- lower() on the incoming side as well as the stored side. The check
  -- constraint guarantees the stored half; auth.users.email casing is not
  -- something this function controls.
  select * into invited
    from public.allowed_emails
   where email = lower(new.email);

  if found then
    insert into public.profiles (id, email, role, is_active)
    values (new.id, new.email, invited.role, true);

    -- Consumed, not marked. The table then means exactly one thing.
    delete from public.allowed_emails where email = invited.email;
  else
    -- Unchanged: role defaults to 'viewer', is_active defaults to false.
    insert into public.profiles (id, email)
    values (new.id, new.email);
  end if;

  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;
