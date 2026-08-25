# Phase 1, Slice 3 — The Users Admin — Design

**Parent spec:** `2026-08-20-tgc-client-health-design.md` (§7 permissions, §8 screens).
**Predecessor:** `2026-08-23-phase-1-slice-2-design.md`, complete 2026-08-24.

---

## 1. Why this slice exists

**Access is currently granted by hand, by one person, in a database console.** A second
account manager can sign in today — `adam@thegroundedcompany.com` did, on 2026-08-24 at
17:57 UTC — and then lands on the pending screen and stays there. He is still inactive a
day later. Nothing in the application can change that. The only path from "signed in" to
"can see the board" is an `UPDATE` statement run against production by the one person who
holds the account.

That is the same shape of problem Slice 2 fixed for clients: the tool does not yet do the
thing the tool exists for. It is worse here, because the missing capability is the one
that decides who may use the tool at all.

**The owner is the bottleneck, and the bottleneck is availability, not email.** The
observed friction is not the magic link. It is that a new person cannot start until the
one admin is at a keyboard. Pre-authorisation removes the admin from the critical path
entirely: the invitation is recorded ahead of time, and first sign-in applies it.

**`manage_users` already exists and enforces nothing.** `20260824160306_has_capability.sql`
names four capabilities and gives `admin` all four. Three of them gate real policies.
`manage_users` gates nothing, because there is nothing to gate. It is a promise the schema
makes and does not keep.

## 2. What is in this slice, and what is not

**In:** a `public.allowed_emails` invitation table; a conditional `handle_new_user` that
consumes an invitation on first sign-in; a `BEFORE UPDATE` guard on `public.profiles` that
makes `role` and `is_active` writable by admins and by nobody else; a users admin screen
that invites, revokes, activates, deactivates and changes roles.

**Not in: per-person permission overrides.** `has_capability.sql` also calls those Slice 3.
They are a change to that function's body and are independent of everything here. Bundling
them would double the size of the reviewable unit for no shared code. They keep their name
and wait.

**Not in: password authentication, admin-created accounts, or any Edge Function.** All
three were considered as ways to add a user without sending them anything. All three
require `service_role` in a server-side context, which this project does not have and does
not need for the problem actually being solved. Recorded in §9.

**Not in: an invitation email.** An invitation is a row, not a message. The invited person
still signs in the ordinary way, at a time of their choosing, with a magic link they
request themselves.

## 3. Email delivery — measured, and weaker than it first appeared

**Custom SMTP is not configured, and invitations work anyway.** Both halves were verified
on 2026-08-25.

Supabase documents that without custom SMTP, "Auth will refuse to deliver messages to
addresses that are not part of the project's team." That restriction is the reason this
section was originally written as a blocking precondition. It does not currently hold on
this project. Organisation `Josh's Base` has **exactly one member** — the owner — so
`adam@thegroundedcompany.com` was never team, and his magic link arrived regardless on
2026-08-24. The documented restriction and the observed behaviour disagree.

**So this slice is buildable and testable today.** SMTP is not a blocker and is removed
from §4's order of work.

**It is still required before the first real invitation**, for three reasons that survive
the measurement:

1. **The working path is undocumented.** Relying on a vendor behaving contrary to its own
   documentation is a bet that it never starts matching it. If it does, every invitation
   silently stops arriving — no error, just nothing.
2. **The built-in mailer is capped at two messages per hour** and documented as
   best-effort and not for production.
3. **The failure is invisible from inside the tool.** An unconsumed invitation looks
   identical whether the person hasn't got round to it or never received anything.

Custom SMTP (Google Workspace: `smtp.gmail.com:465`, app password, then raise the
default 30/hour limit at Authentication → Rate Limits) therefore moves from *prerequisite*
to *required before this is relied on by anyone*. Carried forward in §10.

## 4. Order of work

1. The migration (§5, §6), applied to **staging** and verified there.
2. **A real sign-in against staging**, because a broken definer grant is a total outage
   that no catalogue assertion detects.
3. `verify:privileges` and the new `verify:invites` against staging.
4. The screen (§7), against staging.
5. Production: `db:push`, then `verify:privileges`, then sign in.

`db:push` precedes every verifier. `npm run build` runs separately from `npm test`, which
does not typecheck. No SMTP step gates any of this — see §3.

## 5. The migration

### 5.1 The invitation table

```sql
create table public.allowed_emails (
  email      text primary key check (email = lower(email)),
  role       text not null default 'viewer'
             check (role in ('admin','account_manager','viewer')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
```

**Lowercase is a constraint, not a convention.** `auth.users.email` casing is not
guaranteed to match what an admin typed, and the trigger matches on `lower(new.email)`.
Enforcing the stored side too means the two halves cannot drift into a match that silently
never happens.

**No email-format validation.** It would not catch the typo that actually bites — a
well-formed address belonging to nobody — and it would reject valid unusual addresses. The
screen showing "invited, not yet signed in" makes an unconsumed invitation visible, which
is the real mitigation.

**`created_by` is set null on profile delete**, following `clients.owner_id`: losing a
person must not delete the record.

The migration opens with `revoke all on public.allowed_emails from anon, authenticated;`
before any grant, per the standing rule for every new table in `public`. `authenticated`
then receives table-level `select, insert, update, delete`; RLS decides who actually
reaches a row, and all four policies gate on `private.has_capability('manage_users')`
scoped `to authenticated`.

`anon` receives nothing. An unauthenticated caller has no business reading a list of
people who have been invited.

### 5.2 `handle_new_user` becomes conditional

The function keeps its shape — `security definer`, `set search_path = ''`, in `private`,
no `EXECUTE` grant — and gains a lookup:

- **Invitation found:** insert the profile with the invited `role` and `is_active = true`,
  then delete the invitation.
- **No invitation:** insert `(id, email)` exactly as today, letting `role` default to
  `viewer` and `is_active` to `false`.

The miss path is byte-for-byte today's behaviour. An uninvited person who signs in still
gets a pending profile and still lands on the pending screen, and the admin can activate
them from the new screen. That path is how Adam gets fixed, since no trigger will ever
fire for him again.

**The invitation is deleted on use.** `allowed_emails` therefore means exactly one thing:
invited, not yet arrived. There is no consumed state, no union of two sources to render,
and no way for the two lists on the screen to disagree about a person. The cost is that
`created_by` dies with the row — the profile keeps no record of who invited them. Accepted
at this size; recorded in §9.

## 6. The guard trigger, and the constraint that forced it

**Postgres has no per-column row level security.** This is the fact the whole design bends
around, so it is stated before the mechanism.

`20260820225903_restrict_profiles_grants.sql` established that `authenticated` holds
column-level `UPDATE` on `full_name` and nothing else, and that this narrow grant — not any
policy — is the structural reason a user cannot promote themselves. `verify-privileges.sql`
section 2 pins it in five directions.

The obvious way to let an admin write `role` and `is_active` is to grant those columns and
add a `manage_users` policy. **That reopens the exact vulnerability the repair closed.**
Postgres OR-combines permissive policies, `profiles_update_own` already permits a user to
update their own row, and a column grant belongs to the *role*, not to the policy that
admitted the row. The moment `authenticated` can write `role`, anyone passing
`profiles_update_own` can set their own to `admin`.

Two alternatives were rejected. A `security definer` RPC keeps the grants narrow but must
live in `public` for PostgREST to reach it, which contradicts this project's rule that
definer helpers stay in `private` because functions in `public` are anon-callable by
default; it also adds a second write path beside the policies. An Edge Function holding
`service_role` works and is what `20260820225903` anticipated, but it introduces the
server-side code this approach exists to avoid, plus a secret to manage.

### 6.1 The mechanism

Three pieces, and all three are required. Any one alone does nothing useful.

**A policy, so another person's row is reachable.** `profiles_update_own` permits only your
own row, so today an admin cannot write to Adam's record at all:

```sql
create policy profiles_update_manage_users
  on public.profiles
  for update
  to authenticated
  using ((select private.has_capability('manage_users')))
  with check ((select private.has_capability('manage_users')));
```

`using` and `with check` both, or a row could be reassigned. The policy deliberately does
**not** carry the self-exclusion: the trigger owns that rule, in one place, and splitting it
across two mechanisms would create exactly the drift this schema keeps designing against.

**A grant, so the columns are writable:**
`grant update (role, is_active) on public.profiles to authenticated`.

**A `BEFORE UPDATE` trigger, which is the actual guard.** It supplies the column-level
enforcement Postgres lacks, raising `42501` when `role` or `is_active` changed unless the
caller holds `manage_users` **and** `new.id <> (select auth.uid())`.

So: the policy is *which rows*, the grant is *which columns*, the trigger is *who, and not
themselves*.

`INSERT` and `DELETE` on `public.profiles` are granted to neither `anon` nor
`authenticated` and gain no policy here. Rows are created only by the definer trigger on
`auth.users` and are never deleted from the browser, so neither is a path around the guard.

### 6.2 Three details that are load-bearing

**It must be `security definer`.** A `security invoker` trigger runs as `authenticated`,
and calling `private.has_capability` **by name** requires `USAGE` on schema `private`,
which `authenticated` deliberately does not have — the property that lets policies
reference the function without any role being able to call it. Under `security definer` the
function resolves as its owner. `auth.uid()` still returns the real caller, because it
reads a request-level setting rather than the current role.

**No `EXECUTE` grant.** Trigger-function execute is checked at `CREATE TRIGGER` time
against the creator, not at fire time against the caller — measured on this project and
already relied on by `handle_new_user` and `touch_updated_at`. It is revoked from `public,
anon, authenticated` like its siblings.

**The guard applies only when `auth.uid()` is not null.** Direct SQL — migrations,
`service_role`, a repair run from a terminal — carries no uid and already bypasses RLS
entirely. Guarding it would add no security while removing the only recovery path that
exists on a project with no backups. This exemption is what makes a mistake survivable.

### 6.3 What the self-edit rule buys

`new.id <> (select auth.uid())` is one clause and it purchases two separate guarantees.

**Self-promotion is structurally impossible again.** A viewer cannot write their own
`role` under any policy, so the widened column grant does not reintroduce the 20260820225903
vulnerability.

**Lockout is provably impossible.** No one can demote themselves, and only an admin holds
`manage_users`, so admin A may demote admin B but B — now without the capability — cannot
demote A. At least one active admin always survives. There is no counting logic anywhere,
and no state in which the tool has no administrator.

The cost is real and should be stated: with exactly one admin, that admin's own row cannot
be changed by anybody, including themselves. Promoting a second admin is the only way to
make your own row editable.

## 7. The users admin screen

Reached from `Board` behind `can(profile.role, 'manage_users')` — the second caller of
`can()` in the application — and structured exactly as `ClientsAdmin`: a screen with an
`onBack`, a `useUsers` hook, module CSS, no routing.

Files: `src/users/UsersAdmin.tsx`, `useUsers.ts`, `InviteForm.tsx`, `userForm.ts`,
`UsersAdmin.module.css`.

**Two lists, and a person is in exactly one.** Because the invitation is consumed, they
cannot overlap.

*People*, from `profiles`: email, name, role, active state, with a role selector and an
activate/deactivate control per row.

*Invitations*, from `allowed_emails`: email, role, when invited, with revoke. Headed
"Invited — not yet signed in", so an invitation that never lands is visible rather than
silent.

**Your own row is inert**, with the reason stated on the row rather than left to be
inferred. The database refuses it regardless; this is the convenience half of §7.2's split
and it must agree with §6.1 exactly, or the screen offers a control that fails when used.

**Two failure shapes, both handled.** A non-admin editing another row is refused by RLS —
zero rows, `PGRST116`. An admin editing their own row passes RLS via `profiles_update_own`
and is stopped by the trigger — `42501` with a message. Same outcome on screen, two codes
through `errorText.ts`.

**Inviting an address that already has a profile** succeeds at the database and then sits
inert forever, because no trigger will fire for it. Harmless but confusing, so the form
checks the people list first and points at the existing row instead.

**Deactivation takes effect on the next query, not the next login**, because every policy
calls `has_capability` per statement. The deactivated user's next read returns nothing and
the app drops them to the pending screen.

Navigation is disabled while a write is in flight, following `ClientsAdmin`'s existing
reasoning: leaving unmounts the screen and the write then lands with nobody to read its
confirmation.

## 8. Testing

**Unit.** `capabilities.test.ts` grows a third source. Role names now live in
`ROLE_CAPABILITIES`, the `has_capability` CASE, and the `allowed_emails` check constraint;
the existing drift guard already reads migrations off disk, so extending it means a role
added in one place fails the build rather than diverging quietly.

**`verify-privileges.sql`.** Catalogue: `anon` holds nothing on `allowed_emails`; RLS
enabled and not forced; the four `allowed_emails` policies **and `profiles_update_manage_users`**
exist and are scoped `to authenticated`; `authenticated` holds no `INSERT` or `DELETE` on
`public.profiles`. The new table is added to section 4's and section 5's allowlists.

Section 2's existing five-direction assertion on the `profiles` column grants **changes
shape here and must be updated deliberately, not deleted**: `role` and `is_active` become granted
columns, so the assertion moves from "these columns are ungrantable" to "these
columns are writable only through the trigger's conditions". That is the single largest
review risk in this slice — the old assertion failing is the expected outcome, and the
temptation will be to relax it rather than re-aim it.

Live probes, which are what actually pin this design. As a simulated **viewer**: cannot
read or insert `allowed_emails`; cannot change own `role`; cannot change own `is_active`;
**can** still update own `full_name` — the regression guard proving the trigger did not
break `profiles_update_own`. As a simulated **admin**: can manage invitations; can change
another user's `role` and `is_active`; and **cannot** change either on their own row,
failing `42501`. Both directions, for the reason section 9c exists.

**`verify-invites.sql`, new, with a `verify:invites` script** following `verify:lifecycle`.
The only honest test of the signup path: insert into `auth.users` with a matching
invitation and assert the profile emerged `is_active = true` with the invited role and the
invitation was consumed; then a non-matching address and assert `viewer`/inactive. Cleans
up after itself. **Staging only.**

Three recorded gotchas govern how these are written. `supabase db query` returns only the
**last** statement's rows, so each script ends with an echoing SELECT. A success `NOTICE`
is invisible through it, so exit 0 plus that SELECT is the entire evidence of a pass. And
`format` needs `%L::boolean` for booleans, never `%s`.

## 9. Decisions recorded, with what they cost if wrong

**Trigger guard rather than RPC or Edge Function.** Keeps every write inside the RLS model
and keeps definer surface out of `public`. If wrong: the enforcement is in a trigger rather
than beside the policies, so a reviewer reading only the policies sees a widened grant and
no visible guard. §6 exists to make that impossible to miss, and `verify-privileges.sql`
asserts the behaviour rather than the mechanism.

**Nobody edits their own row.** If wrong: a sole admin is locked out of changing their own
record until a second admin exists. Recoverable by SQL, and the `auth.uid() is null`
exemption is what keeps it recoverable.

**Invitation deleted on consumption.** If wrong: no record of who invited whom. Recovering
it later means adding a column to `profiles` and backfilling nothing, since the information
is gone. Judged acceptable at five people.

**Admin is assignable from the screen.** If wrong: a mis-click grants full control of
clients, scores and users. No typed confirmation was specified. Mitigated only by the fact
that the person doing it already holds every capability, and by the role being reversible
by any other admin.

**No email is sent by an invitation.** If wrong: an invited person never learns they were
invited and never signs in. Mitigated by the invitation being visible on the screen as
unconsumed, and by the admin telling them out of band — which they were going to do anyway.

## 10. Open items carried forward

1. **Custom SMTP is not configured** (§3). Does not block the build, but is required
   before anyone outside the two existing accounts is invited — the path that works today
   is one the vendor documents as not working.
2. **`Test Client` and the seeded fixture rows** are unrelated to this slice but still in
   production, skewing counts on the board.
3. **No backup exists.** `db:dump` remains designed and unbuilt. This slice writes no
   client data, but it is the first to make it possible for a second person to.
4. **Per-person permission overrides** keep the Slice 3 name in `has_capability.sql` and
   are deferred (§2).
5. **The pillar-floor question** — a client scoring 2 on relationship sitting invisibly in
   `watch` — arose from the 2026-08-25 scoring pass and belongs to a scoring slice, not
   this one.
