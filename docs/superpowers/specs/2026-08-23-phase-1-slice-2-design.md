# Phase 1, Slice 2 — The Clients Admin — Design

**Parent spec:** `2026-08-20-tgc-client-health-design.md` (§6.1 tables, §7 permissions,
§8 screens). **Predecessor:** `2026-08-21-phase-1-slice-1-design.md`, complete and
owner-verified on the deployed site 2026-08-23.

---

## 1. Why this slice exists

Four reasons. The second is the one with a deadline; the fourth was found while writing
this spec and is the one that changed its shape.

**The roster is real data with no way to maintain it.** Eleven live clients sit in
production and every change to one — a rename, an owner, a status — is hand-written SQL in
the Supabase dashboard. That is the same shape of problem Slice 0 fixed for check-ins:
the tool does not yet do the thing the tool exists for.

**Churn is currently unrecordable, and the information is lost the moment it happens.**
The parent spec's `clients` table carries `ended_on`, `end_reason_code` and
`end_reason_note`. **None of the three exists in the database.** So the first client who
leaves can be marked `cancelled` and nothing else: not when, not why. Those facts are
only available on the day, and a status column alone throws them away. Every month this
slice is deferred is a month in which one churn event could cost information that cannot
be reconstructed. That is what makes it next rather than Slice 3.

A third reason, smaller but real: **`clients.name` has no unique constraint**, so the
moment a second account manager exists, two people can create the same client twice and
the board will show it twice with the check-ins split between them.

### And a fourth, found while writing this spec: the role presets are not enforced anywhere

The parent spec's §7.1 gives `viewer` exactly one capability, `view_scores`, and is
emphatic that "the UI hides features according to them; **the database enforces them**"
and that "UI hiding is convenience; the database refusing is the security."

**The database does not enforce them.** All six policies on `clients` and `checkins` —
select, insert and update on each — gate on `private.is_active_user()`, which answers one
question: *does this caller have a profile row with `is_active`?* Read from the migration
2026-08-23, not inferred. So today an **active `viewer` can insert and update check-ins,
and can create and rename clients**, because `authenticated` holds
`select, insert, update` on both tables and the policies ask only whether the account is
active.

Nothing is exploitable right now: production has one user and he is an admin. This is a
latent gap, not a live incident. But it means the permission model exists in the spec, in
the role column, and nowhere in the enforcement — and every month it stays that way is a
month in which adding the second account manager is the event that makes it real.

**This reframes the slice.** `has_capability` is not merely scaffolding the clients admin
needs; it is the fix for a permission model that has never been enforced. That is why
step 2 converts all six existing policies rather than only adding two new ones.

## 2. What is in this slice, and what is not

**In:**

1. The migration: the three lifecycle columns, the constraint that makes churn dates
   unskippable, and the unique index on `name`.
2. `private.has_capability(text)` — the permission machinery, reading **role presets
   only** — **and the conversion of all six existing `clients` and `checkins` policies to
   call it**, retiring `private.is_active_user()`. See §1's fourth reason: this is a fix,
   not preparation.
3. The `profiles` select widening, without which an owner cannot be chosen.
4. The clients admin screen: add, rename, assign owner, change status, record end date
   and reason.
5. The board's **show archived** toggle, cut from Slice 1 because it depended on `former`
   being reachable.

**Out, deliberately:**

- **`permission_overrides` and the users admin — Slice 3.** This slice builds the
  function every policy calls; Slice 3 changes what that function considers, and rewrites
  no policies.
- `pillar_definitions` — still deferred, still unneeded (§9 of the parent spec).
- Anything revenue-shaped — Phase 2.
- **Deleting a client.** There is no delete, in the UI or in the policies.
  `checkins.client_id` is `on delete cascade`, so a delete silently destroys that
  client's entire history, and this project has no backups. `former` is the answer to
  "this client is gone"; that is what the status is for.

## 3. Precondition, and it is not optional

**A CSV export of `clients` and `checkins` exists before the migration runs.** The free
plan has no automated backups and no PITR, `supabase db dump` needs Docker which is
absent, and as of 2026-08-23 no copy of the roster exists anywhere. The migration itself
is additive and cannot fail on the current data — every row is `active`, so the new
constraint is satisfied by all eleven — but "the migration is safe" is not the same claim
as "the data is recoverable", and only the first one is true today.

Dashboard → SQL Editor, `select * from public.clients;` then `select * from
public.checkins;`, Download CSV on each. Owner's action, once, before step 1.

## 4. Order of work

Five steps. Each ends deployed or, for the two database steps, applied to staging first
and then to production by the owner.

| Step | Deliverable | Depends on |
|---|---|---|
| 1 | The migration, and `verify:privileges` updated to cover the new surface | §3's export |
| 2 | `private.has_capability`, **all six** `clients` and `checkins` policies converted to call it, and `is_active_user` dropped | 1 |
| 3 | The `profiles` select widening | 2 |
| 4 | The clients admin screen | 2, 3 |
| 5 | The board's **show archived** toggle | 1, 4 |

**Steps 1 and 2 are migrations against production.** `npm run db:which` now exits
non-zero on production, so `db:push` refuses it unless `ALLOW_PRODUCTION=1` is set
deliberately — which is the intended friction, not an obstacle to route around. Staging
first, always: apply, run `verify:privileges` against staging, then production.

## 5. The migration

```sql
alter table public.clients
  add column ended_on date,
  add column end_reason_code text,
  add column end_reason_note text;
```

**The lifecycle constraint is bidirectional**, and that is a decision rather than a
transcription. The parent spec requires `ended_on` whenever status is `cancelled` or
`former`. This also forbids it when status is `active` or `paused`:

```sql
alter table public.clients add constraint clients_lifecycle_coherent check (
  case
    when status in ('cancelled', 'former')
      then ended_on is not null and end_reason_code is not null
    else ended_on is null and end_reason_code is null and end_reason_note is null
  end
);
```

An active client carrying an end date is not a state anybody meant to create, and leaving
it representable means reporting has to decide what it means later. The cost, which the
screen must pay: **reactivating a client has to clear all three columns in the same
statement**, or the constraint refuses the update. §7 specifies that.

`end_reason_code` is required on churn and `end_reason_note` is not. A coded reason alone
loses the story and free text alone cannot be counted — but only the countable half can
be made mandatory without inviting a full stop typed to get past a form.

```sql
alter table public.clients add constraint clients_end_reason_code_known check (
  end_reason_code is null or end_reason_code in (
    'price', 'scope_fit', 'in_housed', 'went_quiet',
    'project_completed', 'agency_initiated', 'other'
  )
);
```

Text plus a check constraint, exactly as `status` is already stored on this table, so the
table stays internally consistent and no new object gains its own grants and RLS.

```sql
create unique index clients_name_unique on public.clients (lower(name));
```

**On `lower(name)`, not `name`.** "Colorfil" and "colorfil" are the same client, and a
case-sensitive index would let both exist — which is the duplicate this index is for.
`C.R. Plastics` and `CRP` are still two rows to Postgres; no index can fix that, and the
screen should not pretend otherwise.

This index can fail to create. If production already holds two names differing only in
case, the migration aborts — which is the right outcome, and the reason step 1 runs
against staging first and reports the count before touching production.

## 6. `has_capability`, and what it does not do yet

Per parent spec §7.2, whose details are load-bearing and were measured on this project:

```sql
create function private.has_capability(capability text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.is_active
       and capability = any (
         case p.role
           when 'admin' then array['view_scores', 'edit_scores', 'manage_clients', 'manage_users']
           when 'account_manager' then array['view_scores', 'edit_scores', 'manage_clients']
           when 'viewer' then array['view_scores']
           else array[]::text[]
         end
       )
  );
$$;

revoke execute on function private.has_capability(text) from public, anon;
grant execute on function private.has_capability(text) to authenticated;
```

Four things about that shape, each of which has already cost this project something:

- **`public` in the revoke is load-bearing.** Postgres grants `EXECUTE` on every new
  function to `PUBLIC`, so `anon` reaches it implicitly unless `public` is named.
- **The grant to `authenticated` is mandatory, not optional.** Postgres checks `EXECUTE`
  on a policy-referenced function at query time against the role running the query.
  Revoking it from `authenticated` is a total outage for every signed-in user, not a
  degraded read. Measured on this project 2026-08-21.
- **`authenticated` gets no `USAGE` on schema `private`.** The grant above is reachable
  only through the policies that name the function.
- **The capability is a parameter; the subject never is.** The caller is resolved from
  `(select auth.uid())` inside the function. A version taking a `user_id` would let any
  signed-in browser enumerate everyone's permissions.

**What it does not do yet:** consult `permission_overrides`, which does not exist. The
role presets above are the whole answer in this slice. Slice 3 adds the table and edits
this function body — **and no policy changes**, which is the entire reason for building it
now rather than gating on `role` and rewriting six policies later against live data.

Policies wrap it in a subselect — `using ((select private.has_capability('manage_clients')))` —
so Postgres evaluates it once per statement rather than once per row.

### The conversion, which is the substance of step 2

Six policies move off `is_active_user()` and onto the capability each one actually
enforces:

| Table | Command | Was | Becomes |
|---|---|---|---|
| `clients` | select | `is_active_user()` | `has_capability('view_scores')` |
| `clients` | insert | `is_active_user()` | `has_capability('manage_clients')` |
| `clients` | update | `is_active_user()` | `has_capability('manage_clients')` |
| `checkins` | select | `is_active_user()` | `has_capability('view_scores')` |
| `checkins` | insert | `is_active_user()` | `has_capability('edit_scores')` |
| `checkins` | update | `is_active_user()` | `has_capability('edit_scores')` |

No delete policy is written on either table.

The three `view_scores` rows are equivalent to the current behaviour for all three roles
today, because every preset includes `view_scores`. They are converted anyway: leaving a
policy that asks "are you active" while the model says "do you have this capability"
is the gap, and it reappears the first time a role is added that should not read scores.

**`private.is_active_user()` is then dropped**, because an unused `security definer`
function is attack surface that no policy justifies. Three places reference it and all
three must move in the same step:

- the six policies above;
- `scripts/verify-privileges.sql` — §9's allowlist (which is what makes a missing grant
  fail, in both directions) and §10's behaviour assertions, several of which name the
  function in their failure messages;
- `src/lib/rls.test.ts`, which probes that `anon` cannot call it as an RPC. That probe
  should be repointed at `has_capability`, not deleted — it is the test that the new
  function is not reachable from a browser without a session.

**Order within the step matters and is not negotiable:** create `has_capability` and grant
it to `authenticated` **before** altering any policy, and drop `is_active_user` **after**
the last policy stops referencing it. A policy referencing a function the querying role
cannot execute is a total outage for every signed-in user, measured on this project.

## 7. The clients admin screen

Reached from the board. One screen, a list and a form, no modal.

**The list** shows every client regardless of status — this is the screen where a former
client must remain visible — with name, owner, status, and for churned rows the end date
and coded reason. Sorted by status then name, so the active roster reads first.

**Adding** takes a name and an optional owner. Status is `active`; the form does not
offer a churned status on creation, because a client who has already left is not
something anybody needs to add.

**Editing** covers name, owner, and status. Three rules the form enforces because the
constraint in §5 will otherwise refuse the write:

1. Choosing `cancelled` or `former` **reveals** the end date and reason fields and
   requires both the date and the code.
2. Choosing `active` or `paused` from a churned status **clears** all three columns in
   the same update. The screen must say it is doing that — "reactivating will clear the
   end date and reason" — because it is destroying a recorded fact.
3. `former` and `cancelled` differ only in age, per the parent spec, so the form says so
   rather than making the reader guess: `cancelled` is recent and under review, `former`
   is settled and archived.

**The owner picker** is why §8 exists. It lists active profiles by name, or email where
`full_name` is null.

**The save confirmation is Slice 1's lesson applied again.** Every write says what
happened, names the time, and survives a reload — no toast. A failed write keeps the form
populated and says retrying is safe. A failed read does not render a form over it.

## 8. The `profiles` select widening — a real widening, stated plainly

`profiles_select_own` restricts `profiles` SELECT to `(select auth.uid()) = id`. An owner
picker cannot work under it, and neither can §6's card footer naming a person — recorded
as Slice 1's spec §10 item 7.

A second policy lets any **active** user select every profile row:

```sql
create policy profiles_select_active_users
  on public.profiles
  for select
  to authenticated
  using ((select private.has_capability('view_scores')));
```

**What this actually exposes:** every active user can read every profile's `email`,
`full_name`, `role` and `is_active`. That is the staff list, including who is an admin. It
is a deliberate widening and it is the right trade for a five-person agency tool — but it
is a widening, and this paragraph exists so nobody later reads it as a bug fix. The write
surface does not move: `authenticated` still holds column-level `UPDATE` on `full_name`
and nothing else, so nobody can promote themselves.

Once this lands, **Slice 1's card footer can name the person**, and the card's `owner`
field becomes buildable. Both were cut from Slice 1 for exactly this reason. Neither is
in this slice's scope; both should be picked up in the first slice that touches the board
after this.

## 9. Testing

| What | How |
|---|---|
| The lifecycle constraint | `scripts/verify-privileges.sql`, and a Vitest text guard pinning the constraint like `tests/generatedColumn.test.ts` pins the generated column |
| `has_capability`'s grants, both directions | `verify-privileges.sql` §9's allowlist — an unlisted EXECUTE for a browser role fails, and so does a **missing** grant the policies need |
| `has_capability`'s answers | §10 behaviour tests: an active admin gets `manage_clients`, an active viewer does not, an inactive admin gets nothing, a subject with no profile row gets nothing |
| The clients policies | §10: a viewer's insert and update are refused; an account manager's succeed |
| The conversion did not widen anything | §10, run before and after: an active admin's reads and writes are unchanged on both tables |
| The new function is unreachable from a browser without a session | `src/lib/rls.test.ts`, repointing the existing anon-RPC probe from `is_active_user` to `has_capability` |
| **A viewer cannot write check-ins** | §10. This is the assertion that would have failed on the schema as it stands today, and the reason the conversion is in this slice |
| The profiles widening | §10: an active user reads more than one profile row; an inactive one reads zero |
| The screen's states | jsdom + `@testing-library/react`, per Slice 1 step 4's pattern: the read behind a hook, the hook mocked, every state rendered |
| The form's three rules | Pure functions with the decisions in them, tested in the node environment — the `cardSummary.ts` pattern. **The rules are not ternaries in JSX.** |
| Shape | The owner, in front of the deployed site. Nothing here can see a screen. |

**Two standing instructions for every step's plan**, both earned in Slice 1 step 4:

- **Read the file before writing the step that edits it.** Nine defects were caught that
  way in step 4; five were in the plan's own first draft.
- **A number in prose needs the command that produced it run in the same breath as the
  sentence containing it.** The only two false claims that reached a commit in step 4
  were counts typed from memory between running the gates and writing the summary.

And one from 2026-08-23: **a test asserting an accessible name says nothing about whether
a sighted reader can see the same information.** Treat them as two questions.

## 10. Decisions recorded, with what they cost if wrong

1. **Build `has_capability` now, reading role presets only, and convert all six existing
   policies to it.** Cost if wrong: a definer function and its grants exist one slice
   earlier than strictly needed, and six working policies are edited. Accepted because
   those six policies currently enforce "is this account active" while the spec says they
   enforce capabilities — so an active `viewer` can write check-ins and create clients
   today. Converting is the fix; adding two new policies beside the old six would leave
   the gap in place and make it harder to see.
7. **`private.is_active_user()` is dropped rather than kept as a convenience.** Cost if
   wrong: a future policy that genuinely only cares about activity has to say
   `has_capability('view_scores')` instead, which is very slightly less direct. Accepted
   because an unused `security definer` function is a privilege-escalation surface with no
   policy justifying it, and because two overlapping helpers is how the enforcement drifts
   from the model in the first place.
2. **The lifecycle constraint is bidirectional.** Cost if wrong: reactivating a client
   needs a three-column clear in one statement, and the screen has to say so. Accepted
   because an active client with an end date is a state nobody meant and reporting would
   have to invent a meaning for.
3. **`end_reason_code` required on churn, `end_reason_note` optional.** Cost if wrong: a
   forced code produces `other` more often than it should. Accepted because the countable
   half is the half that has to be there.
4. **The unique index is on `lower(name)`.** Cost if wrong: two clients genuinely
   distinguished only by case cannot both exist. No such pair exists and none is likely.
5. **No delete, anywhere.** Cost if wrong: a client added by mistake stays as a row,
   marked `former`. Accepted because the alternative is a cascade that destroys check-in
   history on a database with no backups.
6. **Text plus a check constraint for reason codes.** Cost if wrong: rewording a label
   needs a deploy. Accepted for consistency with `status` on the same table.

## 11. Open items carried forward

1. **The `owner` field on the board card, and the card footer naming a person.** Both
   unblocked by §8, neither in this slice.
2. **Whether the board should hint at unsaved local work.** Found 2026-08-23: score
   pillars, leave without pressing Save draft, and the check-in screen remembers while
   the board says `Not started`. Per spec, and the one place the two screens disagree
   about what happened.
3. **Custom SMTP.** Still a hard blocker for a second user, and therefore for exercising
   any of §8's multi-user behaviour with real accounts. Slice 3 cannot ship without it.
4. **Staging has never had an active profile**, so no policy has ever been exercised
   there. `scripts/activate-staging-profile.sql` exists and has never been run. This
   slice adds two migrations and a function whose grants are the kind of thing staging
   exists to catch.
5. **`npm run verify:score`** has never been run.
6. **`Test Client`** (production id 2) is still `active` and still on the board. This
   slice gives it a proper end: `former`, with a date and `other`.
7. **The logo SVG will fail the build** on its brand hex the first time it lands.
8. **The token gate false-positives on prose.** Unchanged, still ~5 lines to fix, and now
   confirmed as a class rather than a one-off — it recurred in a test asserting the
   absence of a SQL keyword that appeared in a comment.
