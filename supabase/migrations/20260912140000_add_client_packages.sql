-- Which package a client is on, and when they moved.
--
-- Asked for by the owner's boss on the 2026-09-11 call: "I would love to see a
-- brand join us and we're in foundation. And then I'd love to see them graduate
-- from foundation into grow... almost being able to see which brands are moving
-- up the ladder with us. What's the correlation of someone who signed with us on
-- foundation and then graduates to grow? Do they stay with us longer?"
--
-- A TABLE OF STINTS, not a column on clients, and the requirement forces it. A
-- current-package column answers "what are they on now" and cannot answer a
-- single question he asked -- every one of them is about the JOURNEY. The
-- current package is the latest stint, derived rather than stored twice.
--
-- started_on rather than a from/to pair: a stint ends when the next one begins,
-- so storing both ends invites the two to disagree. The last stint has no end,
-- which is the correct statement about a client who is still on that package.
--
-- No end to the relationship recorded here either. That is clients.ended_on,
-- and duplicating it would create a second place to look and a second place to
-- be wrong.

create table public.client_packages (
  id bigint generated always as identity primary key,
  client_id bigint not null references public.clients (id) on delete restrict,
  package_code text not null,
  started_on date not null,
  -- The owner, on the same call: "they switch to Grow and then provide a little
  -- bit of context". Optional, for the reason spec §10 decision 3 gives about
  -- the departure note: only the countable half can be made mandatory without
  -- inviting a full stop typed to get past a form.
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One stint per client per day. Two rows the same day would leave "which
  -- package are they on" with no answer, and the screen deriving it from the
  -- latest would pick arbitrarily.
  unique (client_id, started_on)
);

comment on table public.client_packages is
  'One row per period a client spent on a package. The current package is the '
  'latest row by started_on; a stint ends when the next begins, which is why '
  'there is no end date. The relationship ending is clients.ended_on.';

comment on column public.client_packages.package_code is
  'Foundation, grow or scale -- the three named on the 2026-09-11 call. The '
  'vocabulary lives in src/clients/clientPackages.ts and there is deliberately '
  'no CHECK constraint here, so a fourth rung needs one edit rather than a '
  'migration. The same arrangement clients.end_reason_code has.';

-- Before the grants, per the standing rule for every new table in public: on
-- this project a new table can be born writable by anon and authenticated.
revoke all on public.client_packages from anon, authenticated;
grant select, insert, update on public.client_packages to authenticated;

alter table public.client_packages enable row level security;

-- Three policies, not four, exactly as client_month_revenue. There is no delete
-- policy and that is the intent: a client's history is not something the screen
-- offers to erase, and a stint entered in error is corrected by editing it.
-- With no policy, delete is refused for everyone.
--
-- Gated on manage_clients throughout rather than split the way revenue is:
-- revenue separates viewing from editing because an account manager may see the
-- numbers without changing them. A package history has no such split -- anyone
-- who can edit the roster can record what package a client is on.
create policy client_packages_select_manage_clients
  on public.client_packages
  for select
  to authenticated
  using ((select private.has_capability('manage_clients')));

create policy client_packages_insert_manage_clients
  on public.client_packages
  for insert
  to authenticated
  with check ((select private.has_capability('manage_clients')));

-- An update needs a select policy too, or the row is invisible to the statement
-- and the update silently affects nothing.
create policy client_packages_update_manage_clients
  on public.client_packages
  for update
  to authenticated
  using ((select private.has_capability('manage_clients')))
  with check ((select private.has_capability('manage_clients')));

create index client_packages_client_started_idx
  on public.client_packages (client_id, started_on desc);
