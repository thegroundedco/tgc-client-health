# SDD ledger — plan: docs/superpowers/plans/2026-08-20-slice-0-plumbing.md

Spec: docs/superpowers/specs/2026-08-20-tgc-client-health-design.md (read, reachable)
Base commit: 60b337b (main)
Branch: slice-0-plumbing

Ruling: Work on branch `slice-0-plumbing` in the primary directory rather than a
separate git worktree — the user explicitly designated
/Users/josh/Downloads/CLAUDE/tgc-client-health as the project home and is not a
developer; a sibling worktree directory would put the code somewhere they did not
ask for and would confuse the handoff. Cost if wrong: none material — the branch
gives the same isolation from main; only parallel-task concurrency is lost, and
tasks here are strictly sequential anyway.

## Pre-flight conflict scan

### Cross-task pairs (shared file or interface)

| Pair | Produces → Consumes | Finding |
|---|---|---|
| T1 → T2 | `package.json`, `vite.config.ts` → T2 adds `@supabase/supabase-js`, `.env.local` | Clean |
| T1 → T5 | Vitest configured in T1 Step 4-5 → T5 adds `.test.ts` files | Clean |
| T2 → T3 | `readSupabaseConfig`, `supabase` client → T3 `rls.test.ts` builds its own client deliberately (no session persistence) | Clean, intentional divergence |
| T2 → T4 | `supabase` client → `useSession`, `useProfile`, `SignIn` | Clean |
| T3 → T4 | `src/types/database.ts` `Database` type → `Profile = Database[...]['profiles']['Row']` | Clean |
| T3 → T5 | `private` schema, `private.touch_updated_at()`, `public.profiles` → T5 migration references all three | Clean; strict ordering required, plan enforces it |
| T4 → T5 | `Profile` type export from `src/auth/useProfile.ts` → `Board` props | Clean |
| T4 → T6 | Redirect allowlist entry added in T4 Step 1 → verified in T6 Step 8 | Clean; T4 adds the Pages URL before it exists, deliberately, so T6 need not debug it |
| T5 → T6 | `rls.test.ts` needing live creds → excluded from CI in `test.yml` | Clean, intentional |
| T1 → T6 | `npm test` script → CI calls `npx vitest run --exclude` instead | Consistent by design: CI must skip the live-credential test |

### Per-task self-consistency

| Task | Tests vs code / files created vs later touched | Finding |
|---|---|---|
| T1 | Deletes `index.css`/`App.css`/`vite.svg`; replacement `main.tsx` and `App.tsx` import neither; `index.html` icon line removed | Clean — no dangling imports |
| T2 | 5 test cases vs impl: missing url, missing key, whitespace-only, secret-key rejection, happy path | Clean — all covered |
| T3 | SQL creates `profiles` + trigger + policies; test asserts anon reads zero rows | **Files block omits `src/lib/rls.test.ts`**, which Step 8 creates |
| T4 | `useProfile` exposes an error state; `App` renders all four states | Clean |
| T5 | `score.test.ts`/`month.test.ts` imports vs exports of `score.ts`/`month.ts` | Clean — every imported symbol exists |
| T5 | Step 13 appends to `rls.test.ts` | **Files block omits the `rls.test.ts` modify** |
| T6 | README content block nests ``` fences inside a ```markdown fence | **Transcription hazard** |

### Rulings on scan findings

Ruling: T3/T5 Files blocks omitting `src/lib/rls.test.ts` — proceed as written; the
step text is unambiguous about creating and later appending to it. Cost if wrong:
nil; a reviewer may flag an unlisted file, which I will adjudicate as plan-mandated.

Ruling: T6 Step 9's README block contains nested triple-backtick fences inside a
```markdown fence. The implementer must write the README with the inner fences
intact rather than truncating at the first inner fence. Carried into the T6
dispatch verbatim. Cost if wrong: a mangled README, caught by review, cheap to fix.

## Task log

Ruling: Task 1 Step 2 as written (`npm create vite@latest .` in the project root) is
unsafe — with `docs/`, `.git`, and `.superpowers/` present, the scaffolder prompts to
remove existing files, and an implementer answering "yes" would destroy the spec, the
plan, and the git history. Replaced with: scaffold into a fresh temp directory, then
copy the generated files into the project root, never deleting anything. Cost if
wrong: none; the outcome is identical and strictly safer.

Ruling: `.superpowers/` must be added to `.gitignore` (the plan's .gitignore list
omits it). It is controller scratch, not project source. Cost if wrong: nil.

Task 1: dispatched (implementer, sonnet), BASE 60b337b
Task 1: implementer reported DONE_WITH_CONCERNS (commit 07cca97). Concern: create-vite
9.1.2 produced a different template shape than the brief assumed (tsconfig.app.json,
oxlint, differently-named demo assets); implementer applied intent over literal
filenames. Not addressed pre-review — it is a spec-compliance judgement, so it goes to
the reviewer rather than being settled by me.
Task 1: review dispatched (sonnet), diff 60b337b..07cca97

Ruling: Task 2 does not need live Supabase credentials to be completed or verified.
Its deliverable is `readSupabaseConfig` plus the shared client, and its gate is
`npm run build` — which needs the env vars to be *present*, not valid. Task 2 will
therefore run with an obviously-fake `.env.local`, and the real values must replace
them before Task 3 (which links the CLI and cannot be faked). Cost if wrong: none;
`.env.local` is gitignored and Task 3 overwrites it. Avoids parking the whole plan on
one pending human step.
Task 1: minor (deferred): package.json adds a `lint` script + .oxlintrc.json outside the
brief's stated Produces interface — byproduct of the mandated scaffold command; later
tasks must not assume ESLint tooling exists.
Task 1: minor (deferred): typescript pinned at 6.0.2 (major-version jump the plan author
did not anticipate); track if a later task hits TS-6-specific compiler behaviour.
Ruling: Task 1 reviewer's ⚠️ (is typescript@6.0.2 genuinely current, or a mis-pin?) —
resolved as no gap. `npm run build` passed on it, no later task brief references a
TypeScript version, and the pin came from npm's own resolution at scaffold time. Cost if
wrong: a later task hits a TS 6 behaviour change, visible immediately as a build failure
and fixable by repinning.
Task 1: complete (commits 60b337b..07cca97, review clean, 2 minors deferred)
Task 2: dispatched (implementer, sonnet), BASE 07cca97
Supabase project URL: https://bdvxneuzauhvdlzbhmxo.supabase.co
Supabase project ref: bdvxneuzauhvdlzbhmxo
Publishable key: supplied (sb_publishable_ prefix — modern key style, not legacy anon JWT). Written to gitignored .env.local by the controller.
Task 2: implementer reported DONE (commit 2fca67d), 5/5 tests, supabase-js pinned 2.112.3.
Implementer observation: src/lib/supabase.ts is not imported by any module yet, so its
module-level config validation does not execute at build time — only via unit tests.
Routed to the reviewer as a possible spec gap in brief Step 8's verification claim
rather than settled by me.
Task 2: review dispatched (sonnet), diff 07cca97..2fca67d
Unknown resolved (plan "What Slice 0 will teach us" #1): project issues MODERN keys
(sb_publishable_ prefix), not legacy anon/service_role JWTs. Env var name
VITE_SUPABASE_PUBLISHABLE_KEY is correct as planned.
Unknown resolved (#2): Supabase CLI resolves to v2.115.0 — above the 2.81.3 floor, so
`db advisors` and `db query` both exist. No dashboard fallback needed.
Task 3 blocker: CLI has no access token (LegacyPlatformAuthRequiredError). `supabase
login` is interactive and `db push` needs the database password. Both require the human.
Task 2: review returned Approved with 2 Important (both labeled plan-mandated) + 2 Minor.
Task 2: minor (deferred): none — Minor 3 folded into the fix below; Minor 4 resolved by
controller (commit 2fca67d body does record "Pins @supabase/supabase-js to 2.112.3").

Ruling: Finding 1 (Steps 8/9 verification gates are hollow because src/lib/supabase.ts is
imported by nothing, so the module-level config validation never executes during build,
and the dist/ leak grep is vacuous because the key never enters the bundle) — the finding
is CORRECT and I am not dismissing it, but I am NOT fixing it inside Task 2. Adding an
artificial import purely to make a verification step fire is code written for the
checker's benefit, which is worse than an honestly-deferred check. Task 4 imports
supabase.ts for real (useSession/useProfile), at which point both the config-load
validation and the leak grep become genuinely meaningful. Therefore: the two
verifications are RELOCATED to Task 4 and carried into its dispatch as required steps,
and Task 2's report must be corrected to state plainly that Steps 8/9 gave no signal
rather than implying they validated anything. Cost if wrong: Slice 0 reaches Task 4
before anything actually verifies that a real key loads and that the bundle is
leak-free — bounded, because Task 4 is the very next task and cannot pass without both.

Ruling: Finding 2 (the `/service_role/` disjunct in the secret-key guard cannot match a
real legacy service_role key, because that string exists only inside the JWT's
base64url-encoded payload) — the finding is CORRECT and this one I AM fixing, overriding
the plan text that specified the weaker check. Rationale: the entire security posture of
a static-hosted app rests on never shipping a secret key, and a guard that looks
protective while being decorative is worse than no guard, because it creates false
confidence in exactly the place we cannot afford it. The spec (§Keys, binding authority)
requires that the secret key never reach a VITE_ variable; the plan's implementation of
that requirement is simply inadequate, so the spec wins. Minor 3 (no `i` flag) folds into
the same fix. Cost if wrong: a slightly more complex guard than the plan specified, with
tests pinning its behaviour — low.
Task 2: fix round 1/5 dispatched (resume original implementer), findings 2 + minor 3
Task 2: fix round 1/5 (3 addressed, 0 open — service_role JWT decode guard, case-insensitive
sb_secret_ prefix, report framing corrected; commits 2fca67d..e468b36). Re-reviewer
independently verified base64url padding/translation, non-throwing decode on garbage, and
that no valid key (modern sb_publishable_ or legacy anon JWT) is falsely rejected.
Task 2: complete (commits 07cca97..e468b36, review clean)
Task 3: BLOCKED on human — Supabase CLI access token (interactive login, non-TTY here) and
database password. Not dispatched.
Task 3 UNBLOCKED: human completed `supabase login` in a real TTY. Verified: projects list
works; `link --project-ref bdvxneuzauhvdlzbhmxo` succeeded WITHOUT a database password;
`migration list --linked` connected ("Initialising login role... Connecting to remote
database"). The modern CLI authenticates DB access via the access token, so the database
password is NOT required for this plan at all. Remote is Postgres 17.6.1.155, us-west-2,
ACTIVE_HEALTHY — PG17 means `security_invoker` views are natively available.
Note: only supabase/.temp exists (gitignored); there is no supabase/config.toml, so
`migration new` may require `supabase init` first. config.toml must be committed if created.
Task 3: dispatched (implementer, opus — RLS is the security boundary of the whole design),
BASE e468b36
Hosting decision (human): PUBLIC repo + GitHub Pages. Resolves spec open item #2. Task 6
Step 1's "confirm with the user before pushing" is satisfied. Flagged to the human that
docs/ (spec + plan) becomes public too; no credentials or client data are committed.
GitHub username (human): thegroundedco
=> remote: https://github.com/thegroundedco/tgc-client-health
=> Pages URL: https://thegroundedco.github.io/tgc-client-health/
This resolves the placeholder in Task 4 Step 1 (redirect allowlist) and Task 6 Steps 2/9.

Ruling: Task 4 Step 1's Supabase redirect-allowlist entries will be added by the HUMAN in
the dashboard, not by me via `supabase config push`. Rationale: config push writes the
whole [auth] block from config.toml to the remote project, which would silently reset
auth settings this plan never inspected (providers, email templates, token expiry) to
config defaults on someone else's live project. Two text fields typed by hand is the
lower-risk path. Cost if wrong: one manual step per environment, and Task 4 cannot verify
sign-in until it is done.
Human confirmed: both redirect URLs added to Supabase Authentication → URL Configuration
(http://localhost:5173/tgc-client-health/ and https://thegroundedco.github.io/tgc-client-health/).
Task 4 Step 1 is therefore satisfied before dispatch.
Task 3: implementer reported DONE_WITH_CONCERNS (commit 1cdf493). Changelog check found
nothing contradicting the brief. Advisors clean (one INFO unused_index on a brand-new
index, correctly left alone). RLS read-denial test genuinely executes and passes.

CRITICAL FINDING (implementer, self-fixed in a second migration): this Supabase project
predates the 2026-04-28 default-privileges change, so it still carries
`alter default privileges ... grant all on tables to anon, authenticated`. public.profiles
was therefore created with table-level ALL for both browser roles. Postgres privileges are
additive and table-level UPDATE covers every column, so the plan's `grant update (full_name)`
was a NO-OP: a signed-in user could have set their own role='admin' and is_active=true.
Measured has_column_privilege('authenticated','public.profiles','role','UPDATE') = true
before the fix, false after. This defeats the spec's core guarantee ("No self-promotion",
spec §7.3) and would have silently defeated it for every table in Phases 1-3.

Ruling: the implementer's corrective migration STANDS and was the right call. It repaired a
live, exploitable privilege-escalation path on the project owner's real database; waiting
for my approval would have left it open. Cost if wrong: an extra migration file, trivially
revertible.

Ruling: Concern 2 (root cause is project-wide and every future table is born wide open) is
LOAD-BEARING and is fixed NOW, inside Slice 0, not deferred. Task 5 creates `clients` and
`checkins` — both would inherit the same hole, and those carry the revenue data the entire
permission model exists to protect. Fixing the root cause while only one table exists is
strictly cheaper and safer than retrofitting it across a schema. Dispatched as Task 3 fix
round 1 rather than a new task, because Task 3's actual deliverable is "RLS genuinely
protects this data", and it does not yet. Cost if wrong: Slice 0 grows one migration and
Task 3 takes another round.

Ruling: Concern 3 (the brief's RLS test would have passed even with anon holding full
UPDATE/DELETE, because it only asserts that a read returns no rows) is a REAL PLAN DEFECT
in the spec's own testing requirement, which demands negative cases. The test is
strengthened in the same fix round to assert that unauthenticated writes are REFUSED, not
merely that reads are empty. What actually caught this bug was probing REST directly and
has_column_privilege — so the regression guard must test privileges and writes, not reads.
Cost if wrong: nil; strictly more coverage.

Task 3: minor (deferred): handle_new_user() aborts signup when auth.users.email is NULL —
unreachable on this project (email magic-link only), revisit if phone auth is ever added.
Task 3: minor (deferred): nothing can activate a user yet — by design; Task 4 Step 7 has the
human do it via SQL, and the users admin panel arrives in Phase 1.
Task 3: fix round 1/5 dispatched (resume original implementer, opus): root-cause default
privileges revoke + strengthened negative tests + stale comment in rls.test.ts.
Task 3: fix round 1/5 complete (commits 1cdf493, f1ad1fd). pg_default_acl showed TWO roles
carrying the public-schema grant: `postgres` (governs — migrations connect as it, owns
profiles, will create clients/checkins) and `supabase_admin` (Supabase-managed only,
unreachable: 42501 permission denied, confirmed and not worked around). Tables + sequences
revoked for anon/authenticated only; functions untouched. Scratch-table proof: new table in
public inherited NO anon/authenticated privileges, then dropped. profiles re-confirmed:
role/is_active NOT updatable by authenticated, full_name updatable, anon all false.
Negative tests 1 -> 6, and the implementer PROVED they fail by temporarily re-granting
select to anon (strict case broke, others stayed green, ACL restored identically).
Advisors: No issues found at warn+. 15/15 tests, none skipped.
Task 3: full task review dispatched (opus — highest-risk diff in the plan), range
e468b36..f1ad1fd. Note: Task 3 had no prior task review; concerns were correctness/scope so
the fix round ran first. This review therefore covers BOTH commits, not just the fix.
CARRY FORWARD to Task 5 brief: default privileges are now revoked, so Task 5's tables need
explicit grants or they are unreachable. The failure mode has flipped from silent
over-exposure to a loud 401 — much safer, but it must be anticipated.
CARRY FORWARD to Task 4: the assumption that the signup trigger still fires despite
revoked EXECUTE on private.handle_new_user() is reasoned, not yet executed. Task 4's first
real magic-link signup is what proves it.
Task 3: task review APPROVED. Reviewer independently verified the live schema rather than
trusting the report: profiles relacl = {postgres=arwdDxtm,service_role=arwdDxtm,
authenticated=r}, anon nothing; has_column_privilege(authenticated, role|is_active, UPDATE)
= false, full_name = true; RLS enabled not forced; exactly 2 minimal policies, both
subselect-wrapped, update has using+with check; private schema closed to anon/authenticated.
Also confirmed NO ALL_SCHEMAS (defaclnamespace=0) pg_default_acl entry exists — the one way
the schema-scoped revoke could have been a silent no-op. Reproducibility confirmed: the
three migrations converge on the same end state on a fresh project, so the schema is not an
artifact of application order.
3 Important, 7 Minor.

Ruling: Important 1 (the escalation that was fixed has NO regression test — all six tests
use the anon client, so a future `grant update on profiles to authenticated` would leave all
six green) is CORRECT and load-bearing. The only evidence for the actual guarantee is a
manual has_column_privilege run recorded in a report, which does not survive into CI. Fixed
this round via a committed SQL privilege-assertion script (runs against the live project,
fails loudly if the matrix ever widens) plus renaming the mis-named test. The
authenticated-session PATCH test is carried to Task 4, where a session exists. Cost if
wrong: a script that needs a token to run, so it guards deploys rather than PR CI.

Ruling: Important 2 (the stated reason for leaving function default privileges unrevoked is
factually wrong — `alter default privileges for role postgres` cannot affect existing
objects, and Supabase's helpers come from a distinct supabase_admin row; meanwhile
public/postgres/f still grants EXECUTE to anon/authenticated, so any future
`create function public.x()` is anon-callable the moment it exists) is CORRECT. Fixed by
actually revoking function defaults — the posture Supabase itself adopts on 2026-10-30 —
rather than by correcting the comment. Public RPCs then needing an explicit `grant execute`
is the desired posture, not a cost. Cost if wrong: a future public RPC returns 401 until
granted, which is a loud, obvious failure.

Ruling: Important 3 (the "future tables are born closed" claim holds only for tables created
by `postgres`; public/supabase_admin/r survives and still grants arwdDxtm to both browser
roles, and the project cannot revoke it) is CORRECT, and my own Task 5 carry-forward stated
the opposite. Fixed by adopting a standing convention: EVERY future table migration in
public opens with `revoke all on <table> from anon, authenticated;` before its grants —
one line, correct whichever role created the table. This supersedes my earlier carry-forward
note and MUST reach the Task 5 dispatch. Cost if wrong: one redundant line per table.

Task 3: minors 4, 5, 6 folded into fix round 2 (vacuous test that passes in every possible
DB state; a fully subsumed duplicate test; the suite silently skipping green when .env.local
is absent). Minors 7, 8, 9, 10 deferred — plan-mandated and non-behavioural (speculative
role index, NULL-email signup abort unreachable under magic-link-only auth, redundant schema
usage grant, migration 2 being dead weight on fresh installs).
Task 3: fix round 2/5 dispatched (resume original implementer, opus)

## !! SESSION INTERRUPTED 2026-08-20 — READ THIS FIRST ON RESUME !!

Task 3 fix round 2 was IN FLIGHT when the session ended. Its subagent died mid-task.
UNCOMMITTED at that moment (files are on disk, not in git):
  M  package.json
  M  supabase/migrations/20260820230559_revoke_public_default_privileges.sql
  ?? scripts/
  ?? supabase/migrations/20260820232223_revoke_public_function_defaults.sql
  ?? supabase/migrations/20260820232429_revoke_public_function_execute_from_public.sql

WARNING: those two new migrations MAY ALREADY BE APPLIED to the live remote database while
absent from git — i.e. the database may be AHEAD of the committed history. Before doing
anything else on resume, reconcile:
  npx --yes supabase@latest migration list --linked
and compare against `git ls-files supabase/migrations/`. Do NOT blindly re-apply or
re-create these migrations, and do NOT run `db reset` — it is the owner's live database.

Last committed state: f1ad1fd. Task 3 fix round 2's three Important findings and three
folded minors are specified in full in the "Ruling:" entries above — everything needed to
re-dispatch the round is recorded, so the lost subagent costs a re-run, not information.

## Interruption warning above is RESOLVED — the subagent finished before the session ended.
Verified 2026-08-20: working tree clean, 5 migrations committed, `migration list --linked`
shows local == remote for all five. Database and git are consistent. Ignore the warning
block above; it is kept only as a record.

Task 3: fix round 2/5 (commit e256e1b, 7 files, +486/-45). Delivered: scripts/verify-privileges.sql
+ `npm run verify:privileges` (exits 0 clean; exits 1 with 6 named violations when the
original escalation bug is reintroduced — the implementer verified the assertion FAILS,
not merely that it passes); mis-named test at :82 renamed with real scope; vacuous and
subsumed tests dropped; unconditional credentials test added so a missing .env.local is
loud instead of green; revoke-first convention recorded; migration 3's false comment fixed.

CORRECTION TO MY OWN RULING — Important 2's fix DOES NOT WORK, and I was wrong to specify it
as the remedy. My reasoning about `alter default privileges` being forward-only and not
reaching Supabase's helpers was correct, but incomplete: Postgres ITSELF grants EXECUTE on
every new function to PUBLIC, and the implementer measured pg_default_acl behaving ADDITIVELY
with acldefault() rather than replacing it — {=X,postgres=X} ∪ {postgres=X,service_role=X}
= the observed {=X,postgres=X,service_role=X}. A probe function was still anon-executable
after the revoke. The documented `REVOKE EXECUTE ... FROM PUBLIC` recipe also had no effect,
re-probed twice; event triggers ruled out as a cause. Both statements are retained as
declarations of intent with measurements inline, but NOTHING MAY RELY ON THEM.
What actually enforces the boundary: (a) explicit per-function `revoke execute`, and the
role list MUST include `public`, not just anon/authenticated; (b) the new assertion that no
function in `public` is anon-executable. Cost of my wrong ruling: one round spent proving a
negative — worth it, since the alternative was a security migration everyone would have
cited as protection it never provided.

Task 3: minor (deferred): two implementer self-caught bugs worth remembering — `text[] ||
<untyped literal>` made the assertion script raise 22P02 instead of reporting violations,
and `npm test` passed 14/14 while `tsc` was failing, because Vitest does not typecheck.
Both fixed. The second is a standing trap: a green `npm test` is NOT a green build.

CARRY FORWARD to Task 5 (all four, must reach its dispatch):
  1. Open every table migration in `public` with `revoke all on <table> from anon,
     authenticated;` BEFORE its grants — supabase_admin's default ACL cannot be revoked.
  2. Functions created in `public` are anon-callable by default and this CANNOT be fixed via
     default privileges. Keep helpers in `private`, and include `public` in every explicit
     `revoke execute` role list.
  3. scripts/verify-privileges.sql carries a per-table allowlist that needs deliberate
     entries for `clients` and `checkins` — otherwise the assertion will fail on them.
  4. `npm test` does not typecheck. Run `tsc` / `npm run build` separately before claiming green.

Task 3: STOPPED HERE for the day — fix round 2 is committed and clean, but its scoped
re-review has NOT been dispatched. Resume by running review-package over f1ad1fd..e256e1b
and dispatching re-review-prompt.md with the three Important findings + three folded minors.

## Session resumed 2026-08-20 (later) — state reconciled before any dispatch
Working tree clean at e256e1b. `npm run build` green (tsc -b && vite build). Five migrations
committed; scripts/verify-privileges.sql committed with its `verify:privileges` npm script.
Human confirmed the subagent-driven loop continues (this session's default is no-subagents,
so it was asked once and settled).

Task 3: fix round 2/5 scoped re-review DISPATCHED (opus — the diff is small but it is the
security boundary, and one of its two fixes was proven ineffective), range f1ad1fd..e256e1b,
package .superpowers/sdd/2026-08-20-slice-0-plumbing/review-f1ad1fd..e256e1b.diff.
Findings under verification: Importants 1-3 + folded minors 4-6. The dispatch carries the
controller's own correction on Important 2 as fact-with-measurements while explicitly leaving
NOT ADDRESSED available, and directs scrutiny at the one load-bearing question in both
Important 1 and 2: whether scripts/verify-privileges.sql can actually FAIL.
Task 3: fix round 2/5 re-review returned ALL SIX ADDRESSED, no new Critical/Important
breakage. The re-reviewer did not take the report on trust: it ran verify-privileges.sql
itself read-only (EXIT=0, matrix echoed), derived by arithmetic that re-granting table-level
UPDATE fires exactly the 6 violations the implementer reported, and — the load-bearing
check — proved section 6 detects PUBLIC-derived EXECUTE by running its predicate against
pg_catalog (6514 rows, functions reachable only via the PUBLIC grant). So the one guard the
function boundary rests on genuinely works. Also independently confirmed
acldefault('f','postgres') = {=X/postgres,postgres=X/postgres}, corroborating my correction:
migration 20260820232429 is inert and says so in its own opening comment.
Important 2 verdict recorded honestly as ADDRESSED-by-different-means with a documented,
guarded residual — the named gap (anon/authenticated in public/postgres/f) is closed and
measured gone; the broader "future public function is anon-callable" remains true and is
mitigated by convention + assertion, not closed.

Task 3: minors (deferred, 5 new from re-review): sweep scoped to relkind in ('r','p') so
views/matviews/foreign tables are unswept (a view without security_invoker is the classic
RLS leak — none exist today); sweep reads relacl only, so column-level grants go unchecked
on tables other than profiles; sequences unasserted while public/supabase_admin/S still
grants rwU to both browser roles (latent — Task 5 uses identity columns as postgres);
npm test now hard-fails without .env.local (intended remedy for minor 6, but no
credential-less environment can pass the suite — matters only once CI exists);
verify:privileges is invoked by nothing automatic (my own ruling accepted a manually-run
script, so noted, not reopened).
Task 3: complete (commits e468b36..e256e1b, review clean, 5+4 minors deferred)

CARRY FORWARD to Task 5 — supersedes and sharpens item 1 of the earlier four:
  The plan's own Task 5 migration template (plan line ~1073) goes straight to
  `grant select, insert, update on public.clients to authenticated;` with NO
  `revoke all ... from anon, authenticated` ahead of it — it contradicts the convention.
  The convention is currently recorded only in a migration file named for FUNCTION
  defaults, which is not where a Task 5 implementer will look. The Task 5 dispatch must
  state the revoke-first rule explicitly rather than relying on the plan text or the README.
CARRY FORWARD to the final whole-branch review: verify-privileges.sql asserts nothing about
the `private` schema — neither that `usage` stays revoked from anon/authenticated, nor that
`execute` stays revoked on private.handle_new_user() / private.touch_updated_at(). Those are
the definer helpers the entire boundary leans on, and they are unguarded.

Ruling: src/lib/supabase.ts creates the client as `createClient(config.url, ...)` with NO
`<Database>` generic, so every query's row type erases — `.select()` yields never, and
`.update({role})` is unassignable. Task 4 must add the generic (`createClient<Database>`)
as part of Step 2/3 rather than working around it. Rationale: the plan's own T3->T4
interface is `Profile = Database['public']['Tables']['profiles']['Row']`, and Task 3
generated src/types/database.ts precisely so queries are typed; the Task 3 implementer
already hit this exact erasure in rls.test.ts (TS2353/TS2345) and worked around it locally
with a typed makeClient wrapper. Fixing it at the shared client is the correct place.
Cost if wrong: a one-line generic that either compiles or fails loudly at `npm run build`.

Task 4: dispatched (implementer, sonnet — multi-file React/auth integration from a detailed
brief), BASE e256e1b. Step 1 pre-satisfied (human added both redirect URLs). Step 7 is
HUMAN-GATED (real magic-link email + activation SQL) and is carried as a handoff, not a
blocker on the rest of the task.
Task 4: implementer reported DONE_WITH_CONCERNS (commit 71bc2a9, 6 files, +196/-2).
npm run build PASS, npm test 14/14, npm run lint clean. Concerns are the pre-authorized
human handoff, not new correctness issues, so this proceeds straight to review.
Verifications 1 and 2 (relocated from Task 2) were done FOR REAL this time: a
headless-Chromium drive of `npm run dev` including a deliberate break/restore of
.env.local (confirmed byte-identical after), plus a dist/ grep. Verifications 3, 4, 5
are NOT automated — they need a real signed-in session, which this repo deliberately
cannot fabricate without a service_role key it has never introduced. Folded into the
Step 7 handoff with exact SQL/curl so one human session covers all three.
Task 4: review dispatched (sonnet — ~200-line React/auth diff), range e256e1b..71bc2a9.
The dispatch names the usual failure modes for this shape of task (listener cleanup,
getSession-vs-listener race, DB-error state conflated with not-permitted) and asks the
reviewer to judge whether the human handoff would actually PROVE its three properties
or could produce a false pass — the handoff is now load-bearing evidence, so it gets
reviewed like code.
Task 4: review returned Task quality APPROVED with 3 Important + 2 Minor. The reviewer did
not take the report on trust: it ran `npm run build` itself and got a byte-identical output
hash to the report's transcript, and re-ran the dist/ greps with the real .env.local
(publishable key count 1; the service_role/sb_secret_ hits are isSecretKey()'s own literals
in env.ts, not values). It also checked the handoff against the actual migrations and
confirmed profiles_update_own gates on auth.uid() = id with NO is_active predicate — which
is what makes the handoff's ordering valid (the full_name write succeeds while still
inactive, so "1 succeeds, 2 and 3 refused" is a sound test). Cross-cutting risk cleared:
rls.test.ts builds its own client via makeClient and is unaffected by the <Database> generic.
"Four states vs five rows" resolved as a report-only labeling slip: four gates plus the
product view behind them; the code is right.

Ruling: Important 3 (the report claims Step 1 "fully done and verified" with zero evidence
anywhere in its body) — NOT a gap, resolved from controller knowledge the reviewer could not
have. The prior session recorded the human confirming both redirect URLs were added to
Supabase Authentication -> URL Configuration (localhost:5173 and the Pages URL), which is
why Step 1 was marked pre-satisfied in the dispatch. The implementer's sin is an
unsubstantiated claim, not an undone step. It also self-proves the moment Josh's magic link
lands: an unregistered redirect fails the sign-in silently, so Step 7 succeeding IS the
evidence. No fix dispatched. Cost if wrong: Josh's first magic link fails to sign him in,
which is loud, immediate, and fixed by typing two URLs.

Ruling: Important 1 (useProfile's effect depends on the whole `session` object, which
supabase-js replaces on every onAuthStateChange including hourly TOKEN_REFRESHED, so a
signed-in active user's screen periodically flashes back to "Loading...") — FIXING IT,
overriding the brief's literal Step 2/3 code. Rationale: this task's entire reason for
existing is that a user must always be able to tell a broken tool from an empty one, and a
dashboard that drops to a generic spinner during uninterrupted use is the same class of
lie in a different direction. The spec is the binding authority and the plan's literal code
is merely its argument, so the spec wins. Fix is to depend on a stable primitive
(session?.user.id) and only reset to 'loading' when that id actually changes.
Cost if wrong: a small diff in one hook, with the flash reproducible by anyone who leaves
the tab open an hour.

Ruling: Important 2 (no test covers the state-machine logic, which is precisely the bug
class this task was written to fix — v1 rendered a failed read as an empty dashboard) — 
FIXING IT, and it is load-bearing rather than a coverage nicety. Every Phase 1 screen sits
behind these same gates, so a future edit that re-merges "error" into "no data" would ship
with nothing failing. The reviewer's route needs no new dependencies: the decision is pure,
so extract it (deriveAppState(sessionStatus, session, profileStatus, profile)) and unit-test
it in the existing node environment. No DOM library, no jsdom. Cost if wrong: one small pure
function and its test file, which is the cheapest possible version of this guarantee.

Task 4: minors (deferred): report's reference table headed "four app states" lists five rows
(code correct, report inconsistent); Step 7 handoff section A.5 names "no row" as Critical
but gives no severity guidance for a row with WRONG values — being handled by the controller
telling Josh directly rather than by a code change.
Task 4: fix round 1/5 dispatched (resume original implementer, sonnet), findings Important 1
and Important 2. Important 3 resolved by ruling, not dispatched.
Task 4: fix round 1/5 (commit 86be150). Both Important findings addressed. useProfile now
keys off session?.user.id; implementer reports checking supabase-js's bundled source to
confirm requests still read the current access token, so keying off the id introduced no
staleness. deriveAppState extracted to src/appState.ts as a discriminated union, App renders
from it with an exhaustiveness check, src/appState.test.ts adds 9 cases including an explicit
assertion that a failed profile query and an absent profile row never collapse into one
state. Report honesty issues corrected in place (Step 1 now says pre-satisfied-by-owner and
not verified by me; the five-row "four states" table reheaded). 23/23 tests (14 prior + 9
new), build and lint run separately and green.
Task 4: fix round 1/5 re-review dispatched (sonnet), range 71bc2a9..86be150.

## Task 5 dispatch requirements — verified against the brief, ready to paste
Confirmed by reading task-5-brief.md directly (do not re-derive):
  - Lines 81-82 ARE the predicted defect: `grant select, insert, update on public.clients
    to authenticated;` and the same for checkins, with NO `revoke all ... from anon,
    authenticated` ahead of them. The dispatch MUST require the revoke line first on both
    tables. This is the supabase_admin default ACL that cannot be revoked (42501).
  - Line 103 is already correct and needs no intervention: `revoke execute on function
    private.is_active_user() from public, anon, authenticated;` — includes `public`, and
    the function is in `private`. Carry-forward 2 is satisfied by the brief as written.
  - Line 83 claims no sequence grants are needed (identity columns). Plausible, but
    public/supabase_admin/S still grants rwU to both browser roles, so the dispatch must
    require checking the two new tables' identity sequences' ACLs after creation and
    revoking if anon/authenticated appear. This is the deferred sequence minor coming due.
  - scripts/verify-privileges.sql carries a per-table allowlist; `clients` and `checkins`
    need deliberate entries or `npm run verify:privileges` will fail on them. If checkins
    legitimately needs authenticated INSERT, that goes in the allowlist deliberately.
  - `npm test` does not typecheck; require `npm run build` separately.
ORDERING: Task 5 Step 11 renders the board and touches src/App.tsx, which Task 4's fix round
just rewrote (deriveAppState extraction). Task 5 must NOT be dispatched until Task 4's
re-review closes, or the two will collide in App.tsx.
Task 4: fix round 1/5 re-review — ALL ADDRESSED, no new breakage. The re-reviewer settled
the one risk I named by reading node_modules/@supabase/supabase-js/dist/index.mjs directly:
fetchWithAuth's returned function awaits getAccessToken() on EVERY request (not at client
construction), and _getSessionToken calls auth.getSession() fresh each time, so keying the
effect on userId cannot produce a stale-token read. Sign-out and account-switch both still
work via the early-return branch. It also diffed deriveAppState against the original inline
branches to confirm the gate ORDER is preserved (loading -> signed-out -> profile-loading ->
profile-error -> pending -> active), inspected all 9 new assertions for the vacuous form this
project was bitten by in Task 3 (none present), and independently reproduced build (identical
bundle hash DFsyd5dj), tests (23) and lint.
Task 4: complete (commits e256e1b..86be150, review clean, 2 minors deferred)

!! SLICE-LEVEL ITEM STILL OPEN, NOT A TASK 4 DEFECT: Step 7 — the real magic-link sign-in
plus manual verifications 3 (signup trigger fires despite revoked EXECUTE), 4
(touch_updated_at fires for authenticated), and 5 (no self-promotion under a real session) —
has NOT been performed by anyone. Task 4's CODE is review-clean, but the slice's definition
of done requires a human session. Handed to Josh with full procedure; he has not reported
back. Do not treat Slice 0 as done until he does, and treat a missing profiles row or wrong
default values in step A.5 as CRITICAL if he reports either.

Task 5: dispatched (implementer, opus — creates the two tables that carry the revenue data
the whole permission model exists to protect, plus a security definer function and six RLS
policies; same risk class as Task 3, which also got opus), BASE 86be150.

## !! STEP 7 / VERIFICATIONS 3, 4, 5 — DONE AND PASSED, 2026-08-20 !!
The human-gated item is CLOSED. Josh performed the two clicks (request link in the app, click
it in email); the controller did all verification. Method changed from the report's handoff:
the DevTools+curl procedure was inappropriate to hand a non-developer, AND an outbound POST
carrying the apikey was blocked by this session's safety classifier. Replaced with faithful
in-database session impersonation, which is strictly better evidence — it cannot be fooled by
a malformed header silently downgrading the request to anonymous.

Impersonation verified faithful before trusting any probe: `set local role authenticated` +
`set local request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}'` yields
current_user = authenticated and auth.uid() = 3e6845d2-a2d7-449f-9a8f-d8fccb76d8d8 — exactly
the context PostgREST constructs.

Baseline before anything: auth.users = 0, public.profiles = 0 (measured, so results are
unambiguous).

VERIFICATION 3 — PASSED. The signup trigger DOES fire despite EXECUTE being revoked on
private.handle_new_user() from public/anon/authenticated. Task 3's reasoning (triggers run as
the table owner) is now executed, not merely argued. One profile row, email confirmed,
last_sign_in_at set. Defaults exactly as the migration specifies: role='viewer',
is_active=false, full_name=null, created_at = updated_at.

VERIFICATION 4 — PASSED. Under the impersonated session, `update ... set full_name` SUCCEEDED
and updated_at advanced past created_at, so profiles_touch_updated_at fires for authenticated
despite revoked EXECUTE on private.touch_updated_at(), AND the trigger writing updated_at
does NOT trip the full_name-only column grant. Ran inside a transaction and rolled back —
confirmed afterwards that full_name is still null, so no probe data was left behind.

VERIFICATION 5 — PASSED, and this is the one the whole permission model rests on (spec §7.3).
Under the same impersonated session: `set role='admin'` and `set is_active=true` were BOTH
refused with 42501 permission denied for table profiles, and the deliberate alarm SELECT
placed after each write never printed because the transaction aborted at the write. Note the
error names the TABLE, not the column, which is the correct signature: authenticated holds
column-level UPDATE on full_name only, so any UPDATE touching another column fails at the
table level. This is the exact hole Task 3 found exploitable and closed, now proven closed
from the attacker's own position rather than from a privilege matrix.

Account then activated per handoff step C: is_active=true, role='admin'. Final state confirmed.
Slice 0's remaining unproven assumptions in the auth/RLS foundation: NONE.

Task 5: implementer reported DONE_WITH_CONCERNS (commits 6926ba9, ba14f2d; 10 files,
+810/-1). 44/44 vitest, tsc+vite build clean, oxlint clean, verify:privileges exit 0,
db advisors no issues — all four run separately.

Ruling: the brief's line 103 (`revoke execute on function private.is_active_user() from
public, anon, authenticated`) is IMPOSSIBLE AS WRITTEN and the implementer's deviation
STANDS provisionally. Postgres checks EXECUTE on a policy-referenced function at query time
against the querying role, so revoking it from `authenticated` makes every read and write by
every signed-in user fail 42501 — the brief's literal text is self-defeating, not merely
suboptimal. Shipped instead: `revoke execute ... from public, anon` + `grant execute to
authenticated`, with NO USAGE on schema `private`. The spec's INTENT (a security definer
helper must not be directly callable by a browser role) is preserved by the schema-USAGE
denial rather than by the EXECUTE revoke.
I verified both halves MYSELF rather than taking the report's word:
  - direct call as authenticated -> ERROR 42501 permission denied for schema private
  - has_schema_privilege(authenticated,'private','USAGE') = false; has_function_privilege
    (authenticated,'private.is_active_user()','EXECUTE') = true; anon false on both
  - policies functional: active authenticated user sees 1 client + 1 checkin; anon is
    refused at the TABLE level (42501), which is stronger evidence than "0 rows"
Residual risk I am NOT dismissing: this posture depends on `private` USAGE never being
granted to `authenticated`. If a future migration grants it, the definer function becomes
directly callable, whereas the spec's belt-and-braces revoke would still have held. That is
why an assertion pinning BOTH halves is mandatory, and why the reviewer is asked to consider
whether an inline `exists(...)` subquery — using no definer function at all — is strictly
safer. Cost if wrong: a redesign of six policies, cheap now while only Slice 0 exists.

Task 5: review dispatched (opus — security boundary plus a spec deviation), range
86be150..ba14f2d.
Task 5: STEP 12 (browser round trip) still open. The implementer correctly REFUSED to flip
is_active on a real account to unblock itself — good discipline. That flag is now set (the
controller activated Josh during the Step 7 work), so the round trip is unblocked and needs
only a human look at the running app, or Task 6's deployed URL.

## STEP 12 round trip — CONFIRMED WORKING by human observation, 2026-08-20
Josh reloaded the running app and screenshotted it: "Signed in as josh@thegroundedcompany.com",
"August 2026", "Test Client 15/25 · Watch" with a "Score all 3s" button. Controller confirmed
in the DB: all five pillars = 3, total_score = 15 computed BY THE DATABASE (the app is refused
if it writes that column, 428C9), period 2026-08-01, updated_at > created_at. Band label
renders as TEXT ("Watch"), satisfying the colour-is-never-the-only-signal rule, and 15 lands
correctly in the Watch band (11-17). Slice 0's stated goal — signed-in user, real client, score
in Postgres, survives reload — is PROVEN locally. Deployed-URL version still pending Task 6.

## FINDING (controller, from the screenshot): NO STYLESHEET EXISTS ANYWHERE
The app renders in browser-default Times on white. Measured: `find src public -name "*.css"`
returns nothing; grep for archivo|--ink|--paper|--teal|--blush|#1F1F1F|#FBF7EB|83C1C0 across
src/ and index.html returns nothing; main.tsx imports no CSS; index.html has no <link> or
font tag. So the spec §9 brand requirements — the six exact brand tokens and the Archivo
typeface, both listed in the plan's Global Constraints as binding EVERY task — are entirely
unimplemented across all of Slice 0.
This is a PLAN GAP, not a single task's defect: the Global Constraints assert the tokens bind
every task, Task 1 deleted the scaffold's index.css/App.css, and no task step anywhere creates
a replacement stylesheet or loads the font. Task 5 Step 10 built UI (Board.tsx) without them.
Raised to Josh as a scope decision because the readings differ materially. Controller's
recommendation: do the NARROW version inside Slice 0 — define the six tokens, load Archivo,
apply to body — on the grounds that loading a Google Font on a static GitHub Pages deploy
under a /tgc-client-health/ base path is PLUMBING, and plumbing is exactly what Slice 0 exists
to smoke out before Phase 1 builds on it. Full visual design stays Phase 1.
DECISION (Josh, 2026-08-20): DEFER ALL STYLING TO PHASE 1. Slice 0 ships deliberately
unstyled — no brand tokens, no Archivo, no stylesheet. My recommendation of the narrow
token+font fix was declined, and that is his call to make.
Consequence to carry into Phase 1, accepted knowingly: Task 6's GitHub Pages deploy will NOT
prove that a Google Font loads correctly from a static host under the /tgc-client-health/ base
path. If Phase 1 hits a font-loading or base-path problem, this is where it went unproven —
it is not a new mystery, it is this deferral coming due.
STANDING INSTRUCTION for the Task 5 review and the final whole-branch review: any finding that
the spec §9 brand tokens or Archivo are missing is ACKNOWLEDGED AND DEFERRED BY THE HUMAN, not
a defect to fix in this slice. Do not open a fix round for it. Record it and move on.
Task 5: review returned Task quality APPROVED — 0 Critical, 1 Important, 13 Minor. The
reviewer probed the live DB inside rolled-back transactions and re-read every ACL afterwards,
confirming byte-identical restoration and verify:privileges exit 0.

Ruling: the DEVIATION IS CORRECT AND THE SPEC IS WRONG — confirmed, not assumed. The reviewer
reproduced the outage directly: with `revoke execute ... from authenticated`, a signed-in
`select count(*) from public.clients` fails `42501 permission denied for function
is_active_user`; on the shipped state the same query returns 1. So on PG 17.6 EXECUTE on a
policy-referenced function IS checked at query time against the querying role. The brief's
line 103 applied literally = total outage for every signed-in user on every read and write.
The spec's constraint is not wholly wrong, it is UNDER-SPECIFIED: correct for definer helpers
NOT referenced by a policy (private.handle_new_user() rightly holds postgres=X only), wrong
for policy-referenced ones. AMENDING THE SPEC is therefore a Task 5 fix-round deliverable, not
a note — Phase 1 Task 7 builds capability helpers and would otherwise follow guidance that
causes an outage. Cost if wrong: a spec paragraph, revisable.

Ruling: the inline `exists(...)` alternative is REJECTED on measurement, not preference. The
reviewer built it: it works (active user 1 row, unknown sub 0 rows), RLS-on-RLS is fine, and
performance is a wash (InitPlan once per statement; only applicable policies run, so "six
subqueries" was illusory). But it makes every read silently dependent on the shape of the
profiles SELECT policy — narrow that in Phase 1, as is likely once profiles grows capability
columns, and the board goes EMPTY WITH NO ERROR. The definer function fails LOUD (42501,
naming the function) instead. On a project whose premise is that a false healthy reading is as
harmful as a false at-risk one, fail-loud beats fail-silent-empty. Keep the shipped design.

Ruling: the residual is smaller than I framed it, and the reviewer corrected me usefully.
is_active_user() takes no arguments and reports on the caller's own row, so even if `private`
USAGE leaked it discloses nothing the caller doesn't know; handle_new_user() stays uncallable
regardless. Today's blast radius is NIL. The risk is pattern-level: Phase 1's helpers will take
arguments (is_team_member(bigint)) and WOULD become oracles. Both halves are genuinely pinned —
the reviewer made each assertion FAIL (granting private USAGE, revoking the EXECUTE, and
granting a sequence USAGE each produced a named violation).

Ruling: §9's assertion pins ONE function BY NAME while the deviation licenses a PATTERN. The
reviewer filed this Minor; I am promoting it to the fix round as LOAD-BEARING. It is the guard
that justifies the accepted deviation, and a Phase 1 helper dropped into `private` with EXECUTE
to authenticated escapes it entirely. Generalise to an allowlist sweep over private functions,
same shape §4 already uses for tables. Cost if wrong: a slightly broader assertion.

Task 5: fix round 1/5 dispatched (resume original implementer, opus). In scope: generalise the
§9 private-function assertion to an allowlist sweep; amend the spec's definer-function
constraint to the referenced/not-referenced distinction; add the missing anon UPDATE-on-checkins
denial probe (the only verb gap, and authenticated HOLDS update there); try/finally around
Board's two awaits (without it a rejected promise latches `saving` true and permanently
disables every button); correct the report's 8-vs-7 test count.
Task 5: minors (deferred): submitted_by/owner_id unconstrained in with check (audit attribution,
not authorization — every active user can already write every row, Phase 1 owns it); redundant
checkins_client_id_idx (plan-mandated, subsumed by the unique constraint's leading column, write
overhead only); score.ts and the SQL generated column are two independent implementations of the
null-total rule with nothing tying them together (they agree today, verified); periodFor uses
local time (single-timezone agency); `saving` is one global boolean; verify-privileges.sql at 339
lines in one DO block wants splitting before it reaches fifteen sections; generated types let TS
write total_score (DB refuses with 428C9, no exposure).
CARRY FORWARD to Task 6 (reviewer's explicit escalation): tsconfig.app.json lacks `strict`, and
0 errors was MEASURED with it on. Task 6 owns CI, so if Task 6 does not enable it, it becomes
Important there — with strictNullChecks off the compiler is not enforcing nullability in exactly
the area the spec is most emphatic about, so `number | null` is currently documentation.

## !! I1 CLOSED — SLICE 0'S CORE PREMISE PROVEN END TO END, 2026-08-20 !!
The review's one Important finding (Step 12 unperformed, Board.tsx with zero verification of
any kind) is RESOLVED by human observation plus DB confirmation, so no fix dispatch was needed
for it. Controller set the seeded checkin to all 5s in SQL; Josh reloaded (saw 25/25 · Healthy),
clicked "Score all 3s" (saw 15/25 · Watch), reloaded again, and it still read 15/25 · Watch.
DB confirms: all five pillars = 3, total_score = 15 computed by the generated column,
touch trigger fired, and CRUCIALLY:
  - submitted_by = Josh's real auth uid -> the GoTrue JWT hop WORKS. auth.uid() resolved from a
    genuine signed token issued to a browser session, not from a GUC the controller set by hand.
    This is the first of the two things the reviewer correctly said SQL impersonation could not
    reach.
  - checkins row_count = 1 -> the upsert MERGED rather than inserting a duplicate, so PostgREST
    translated .upsert({...},{onConflict:'client_id,period'}) into a real
    `insert ... on conflict do update`. That is the second thing SQL could not reach.
  - Board.tsx now has genuine end-to-end evidence for its load path, its save path, the band
    rendering (both Healthy and Watch observed), and the {total}/25 display.
Slice 0's stated goal is met locally in full: a signed-in user loads the page, sees a client,
saves a pillar score to Postgres, and reloads to find it still there. Only the DEPLOYED half
(Task 6, GitHub Pages) remains.
Task 5: fix round 1/5 (commit fb0a2e1, 4 files, +220/-83). All five items reported done.
45/45 vitest, tsc+vite build, oxlint, verify:privileges — each run separately. §9 is now a
four-part sweep over ALL of `private` driven by a single text[] read by both directions
(unlisted EXECUTE fails; a listed grant GONE MISSING also fails — the outage direction);
handle_new_user/touch_updated_at deliberately kept off the allowlist as a control group.
Spec §7.2 amended. Anon UPDATE-on-checkins probe added (needed select+update granted together,
since .select() would otherwise mask the denial — a subtle point worth remembering).
Board's scoreAllThrees got try/catch/finally; load got try/catch WITHOUT finally, argued on
the grounds that load's dead-UI mode is an eternal "Loading..." rather than a latched disable.
That asymmetry is a judgement call, so it is routed to the re-reviewer rather than settled here.
Task 5: fix round 1/5 re-review dispatched (opus — the generalised assertion is the guard that
justifies the accepted deviation, so it gets the same tier as the deviation itself), range
ba14f2d..fb0a2e1.

## INCIDENT (disclosed unprompted by the implementer, 2026-08-20) — live-DB exposure
While proving the anon UPDATE probe could fail, the implementer granted `anon` `select, update`
on public.checkins for roughly 15 seconds WHILE A REAL ROW EXISTED. Its reasoning was
"checkins is empty" — and the row count printed `1` in the very output it was reading. It
proceeded anyway. It states nothing was modified (updated_at unchanged) and the ACL was
restored byte-for-byte. Outcome harmless; the REASONING failed, which is the part that matters.
Disclosing it unprompted was correct and is exactly the behaviour this process wants.
Standing lesson, second instance on this project of a live-DB experiment being the risky step
(Task 3 also proved assertions by re-granting privileges): PROVING AN ASSERTION CAN FAIL MUST
NOT REQUIRE MUTATING THE OWNER'S LIVE DATABASE. The re-reviewer is asked whether the sweep's
failure modes can be exercised without live mutation. If a mechanism exists (a scratch schema,
a transaction-local role, a fixture project), Phase 1 should adopt it BEFORE the tables hold
real client data — at which point a 15-second anon window stops being harmless.

CARRY FORWARD to Task 6 (three items):
  1. tsconfig.app.json lacks `strict`; 0 errors measured with it on. Reviewer's explicit
     escalation: if Task 6 does not enable it, it becomes Important there.
  2. Spec §7.2 still opens by claiming RLS is "enabled and FORCED", which contradicts both the
     code and verify-privileges.sql §7 (relforcerowsecurity = false, deliberately). The
     implementer flagged it and correctly left it as a separate concern. It is a real trap —
     Phase 1 adding FORCE would break postgres/service_role access — so Task 6 fixes the
     sentence while it is in the docs.
  3. The owner's account is now is_active = true, role = 'admin'. Any test assuming an INACTIVE
     account needs its own fixture; the convenient "just use the owner" path is gone.
Task 5: fix round 1/5 re-review — ALL FIVE ADDRESSED, no new Critical/Important. The
re-reviewer verified the load-bearing sweep WITHOUT mutating a single grant, which is the
answer to the incident above: it substituted allowlist literals (empty array for the widening
direction; an array naming an ungranted function and a nonexistent one for the outage
direction) and ran §9's exact predicates against the real catalog with ZERO writes. Both outage
branches fired. Control group confirmed real (handle_new_user and touch_updated_at hold
postgres=X only, are off the allowlist, and the sweep is green). It also checked the one thing
I would not have thought to check: rendering drift is FAIL-CLOSED — the runner's search_path
excludes `private`, so regprocedure renders schema-qualified; if a future allowlist entry's
spelling diverges, 9c still resolves it via to_regprocedure while 9b reports it unlisted, i.e.
a loud false failure, never a silent pass.
Live DB end state verified clean after the incident: checkins relacl grants anon and PUBLIC
nothing, byte-identical to the report's before/after; the evidence row is intact (id 8,
all pillars 3, total_score 15, updated_at 02:50:31.57437 — the timestamp that proves nothing
wrote to it, since the touch trigger would have moved it).
Ruling: the asymmetric try/finally treatment STANDS. The re-reviewer judged it on merits rather
than style: `load` holds no latch to clear — every early return and the catch either set
loadError (rendering the error screen with its Try again button) or leave prior state — so a
finally would have nothing to do. scoreAllThrees genuinely needs one. Cost if wrong: nil.
Task 5: complete (commits 86be150..fb0a2e1, review clean, 17 minors deferred)

Task 5: minors (deferred, 4 new from re-review, ALL for the final review's single fix wave):
  - verify-privileges.sql:358-364 — 9d's comment misattributes coverage. aclexplode(NULL)
    returns 0 rows (measured), so 9d is BLIND to a default-ACL function; 9b is what catches it.
    Coverage is complete but the comment is wrong, and a reader trusting it could later
    "simplify" 9b away — i.e. delete the check that actually provides the guarantee. Worth
    fixing precisely because it is a comment.
  - Board.tsx:57-58 — a rejection carrying an EMPTY message sets loadError to '', which is
    falsy, so `if (loadError)` misses it and the UI returns to an eternal "Loading..." with no
    message: the exact failure the catch was added to prevent. One-line fix (|| 'Unknown
    error'). Same shape already at :39.
  - §9 is schema-scoped (sweeps `private`), §6 sweeps `public`; a definer helper created in ANY
    OTHER schema escapes both. Theoretical today, but anon/authenticated DO hold USAGE on
    extensions, storage, graphql, auth and realtime, so a misplaced helper there is WORSE than
    one in private.
  - Board.tsx:98-105 — `saving` now stays true across `await load()`, so buttons stay disabled
    one round trip longer. Re-reviewer judged this an improvement (no double-submit during
    refresh); recorded so nobody "fixes" it back.
Out-of-scope note from re-review: verify-privileges.sql:219 (§6, untouched) still advises
"revoke execute from public, anon, authenticated in its migration" — the exact pairing the spec
amendment now documents as an outage for policy-referenced helpers. Harmless while `public`
holds zero functions; align when §6 is next edited.

## METHOD RULING for Phase 1 and all future rounds
Proving an assertion can fail MUST NOT mutate the owner's live database. The read-only technique
is proven and recorded above: substitute the allowlist/expectation literal and run the real
predicate against the real catalog. Only §9a's schema-USAGE branch has no read-only equivalent,
and it is the least likely to regress silently. Adopt this BEFORE the tables hold real client
data — two rounds have now taken the mutation route (Task 3, Task 5) and both were harmless
only because the tables were effectively empty.

Task 6: dispatched (implementer, sonnet — CI YAML + docs + a tsconfig flag), BASE fb0a2e1.
HARD BOUNDARY in the dispatch: it may NOT create the repo, push, add a remote, or run gh
(not installed, deliberately). Publishing is outward-facing and hard to reverse, and the repo
is PUBLIC, so Josh performs steps 2/3/6/7/8 himself. The implementer must end its report with
a checklist written for a non-developer.

Ruling: do NOT wire `npm run verify:privileges` into CI, overriding Task 5's own suggestion
(its concern C3 proposed exactly this once CI existed). It needs a Supabase access token with
live-project access, and this is a PUBLIC repository; a CI-resident credential that can read
and alter the live database is a worse risk than the guard's benefit, particularly with
pull_request triggers in play. It stays a manually-run pre-deploy gate, documented in the
README as a human step. Cost if wrong: the privilege guard runs only when someone remembers,
which is exactly the weakness the Task 3 review already flagged and I already accepted once.

Ruling: the credential-less CI problem is REAL and lands on Task 6, not on Task 4/5 where it
was created. Task 5 made the rls.test.ts credentials test unconditional (correctly — it
stopped the suite skipping green), which means `npm test` cannot pass in ANY credential-less
environment. CI is exactly that. Resolution is the plan's own: CI runs the suite EXCLUDING
src/lib/rls.test.ts. Explicitly NOT resolved by putting Supabase credentials into the test
workflow, and NOT by weakening the unconditional test — its whole purpose is that a human
cannot get a false green locally. Consequence to state plainly in the report: CI covers fewer
tests than a local run, and the gap must be visible rather than discovered later.
Task 6: local portion complete (commit 8f735e2, 5 files, +170/-69). 45/45 local, CI subset
32/32 across 4 files (the 13 rls.test.ts tests excluded by design), strict enabled with 0
errors, spec §7.2 corrected, README rewritten with the nested fences intact.
Task 6: review returned "Needs fixes" — but BOTH Important findings are against the REPORT'S
CHECKLIST, not the code. The code artifacts were verified accurate: the reviewer ran
`npx tsc -p tsconfig.app.json --noEmit` independently (rather than trusting `npm run build`,
whose incremental tsc -b cache could mask errors) and got 0 diagnostics; cross-checked the
§7.2 spec fix against verify-privileges.sql's actual relforcerowsecurity assertion; counted
it( blocks per file to confirm 32 vs 45; read the README directly to confirm 6 balanced
fenced blocks; and confirmed `pull_request` (not pull_request_target) correctly withholds
secrets from fork PRs.

Ruling: the two Important findings are REAL BUT MOOT — parked, no fix round. Finding 1 (the
checklist tells the owner to create a repo that already exists) and Finding 2 (it orders push
BEFORE secrets and Pages, risking a first deploy that ships an empty Supabase config or fails
outright) are both correct criticisms of the implementer's checklist. They are moot because I
did not relay that checklist: I wrote my own from the established facts, in the order
secrets -> Pages -> push, telling Josh explicitly that the repo already existed. He has
completed both steps correctly. Fixing the report's copy would be editing a gitignored
scratch artifact, describing steps already done, that this workflow deletes at the end.
Cost if wrong: nil — the artifact has no readers left.
This is worth noting as a process observation: the review caught a real defect in the one
deliverable that mattered most for the human, and the only reason it did not bite is that the
controller independently rewrote it. Had I relayed the implementer's checklist verbatim,
Josh's first action would have produced a GitHub error.
Task 6: minor (deferred): test.yml passes the secrets into `npm run build`, which verifies
nothing — readSupabaseConfig only runs at module evaluation in the BROWSER, never during
`vite build`, which merely inlines import.meta.env.*. Brief-mandated, so not an implementer
defect; the step could be dropped without losing coverage.
Task 6: complete (commits fb0a2e1..8f735e2, 2 parked with rulings, 1 minor deferred)
LOCAL PORTION ONLY. Steps 7/8 (push, then verify the DEPLOYED app) remain.

## PUSH IS BLOCKED ON CREDENTIALS, 2026-08-20
Josh authorized the push explicitly. It cannot proceed: `git push` fails with "could not read
Username for 'https://github.com': Device not configured" (no TTY to prompt), SSH returns
"Permission denied (publickey)" (no key registered), the osxkeychain helper holds no github.com
credential, Homebrew is absent so `brew install gh` is unavailable, and gh is not installed.
Deliberately NOT solved by asking Josh to paste a personal access token — same principle
already recorded for `supabase login` in the project memory. Options put to him: GitHub Desktop
(GUI, browser auth, no terminal — recommended for a non-developer) or the gh .pkg installer
followed by `gh auth login` in Terminal.app.
The repo state is confirmed: thegroundedco/tgc-client-health exists, is PUBLIC, is EMPTY
(size 0), default branch `main`, Pages not yet enabled at the time of checking. Josh reports
having added both secrets and set the Pages source. Branch to push: slice-0-plumbing (16
commits). Note `main` locally is still at 60b337b, so a push of the BRANCH alone triggers
neither workflow — deploy fires on push to main, tests on push-to-main or pull_request.

## FINAL whole-branch review dispatched (opus), range 60b337b..8f735e2 (merge-base of main).

## FINAL whole-branch review returned: NEEDS FIXES BEFORE MERGE. 4 Important, 13 Minor.
Correction to my own record: there are SIX migrations, not five — I repeatedly wrote five and
omitted 20260821021840_create_clients_and_checkins.sql.
The reviewer did all DB work read-only, using the read-only technique: writes only inside DO
blocks terminated by `raise exception` so Postgres rolled the statement back, then re-verified
all three rows byte-identical to a pre-probe snapshot. Zero privileges mutated. It made §4,
§9b and §9c each FAIL by substituting expectation literals.

Important 1 (the big one, and structurally invisible to per-task review): NO TEST ANYWHERE
EXERCISES THE `authenticated` ROLE. All 13 rls.test.ts tests use the anon client, which holds
nothing, so every one is denied at the GRANT layer before a policy is ever consulted; and
verify-privileges.sql never reads pg_policies. Consequence, stated exactly: rewrite all six
policies on clients/checkins as `using (true)` and the entire suite plus verify:privileges
stays GREEN. The spec's own §7.2 "practical test of this design" and §10's mandated negative
cases have no automated evidence at all. Posture verified correct TODAY by impersonation
(active admin 1/1 rows; no-profile user 0/0 and 42501 on insert; empty JWT claims 0 rows) —
nothing in the repo re-checks any of it.
Important 2: a missing/misnamed GitHub secret yields a GREEN CI run, a SUCCESSFUL deploy, and
a BLANK WHITE PAGE. readSupabaseConfig only runs at module evaluation in the browser; vite
build merely inlines import.meta.env, so it cannot fail the build. The throw kills the module
graph before React mounts, #root stays empty, and the only diagnostic is the browser console.
For a non-developer owner the most likely first-deploy mistake produces the least diagnosable
outcome. My ledger already recorded this mechanism for test.yml without noticing it makes the
DEPLOY silent — I missed the consequence.
Important 3: the knowledge needed to rebuild or re-point the project exists ONLY in gitignored
files that this workflow deletes. No supabase/config.toml, so nothing in the repo captures the
Auth redirect URLs, Site URL, or PostgREST exposed-schema list; nothing records that the first
admin was activated by raw SQL, or what verify:privileges needs to run. `db push` on a fresh
project yields a database nobody can sign into. Highest-value fix because the window closes.
Important 4: service_role's access to every table is INHERITED from a project-age-dependent
pg_default_acl row and never declared — no migration ever writes `grant ... to service_role`,
yet spec §7.3 and README make service_role the admin activation path. A fresh project whose
default row differs produces tables the admin path cannot touch.

Ruling: single fix wave dispatched (opus), per the workflow's one-fix-wave rule. Scope = all 4
Importants + the cheap/consequential Minors (5, 6, 9, 10, 11, 12, 13, 14, 15-as-docs, 17-as-docs,
§9d comment, §6 advice string). Deliberately NOT in scope, carried to Phase 1 with the
reviewer's own triage: attacl sweep beyond profiles (7), views/matviews unswept (8 — the
reviewer's highest-priority carried item, since a non-security_invoker view is the one thing
that defeats RLS outright and Phase 3 is where views arrive), submitted_by/owner_id attribution,
score.ts/generated-column pairing, splitting verify-privileges.sql, the global `saving` boolean,
schema-agnostic function sweep, and Minor 16 (a denied read rendering as "No active clients
yet" — scope-appropriate now with one user and one client, a lie in Phase 1's board).
Ruling: Important 4 is fixed by DECLARING the grant in a new migration, not merely documenting
it. An idempotent `grant ... to service_role` is harmless on the live project (it already holds
it) and makes the repo self-describing; documentation alone leaves reproducibility resting on
an inherited default nobody can see. Cost if wrong: one redundant grant statement.
Ruling: README's overclaim (Minor 13 — it publishes a Live URL and says "deploy proven end to
end") is fixed by SOFTENING NOW rather than waiting for the deploy to make it true. A README
that overstates is the one artifact this owner will trust literally, and if the deploy fails it
stays a lie. It can be restored accurately after the deploy is verified.
DECISION (Josh): KEEP THE DECISION LOG — do not delete it. He chose to commit it into the
public repo so git history preserves it and the push backs it up. Scanned first: no real
credentials (the only credential-shaped strings are deliberate fakes, sb_secret_oops and
sb_secret_deliberately_broken_for_verification); the publishable key appears but is
browser-public by design. The controller commits it LAST, since it is still being appended to.

## Final fix wave complete (4 commits 8f735e2..54b74b4, 21 files, +1353/-89)
06dcbd3 db/security · cb32ae8 app fixes · 8c32813 CI gating · 54b74b4 docs
Tests 45 -> 60 (7 files). tsc --noEmit, build, lint, verify:privileges all exit 0, run separately.
Item 1's DELIVERABLE was producing the failure, not the pass: new verify-privileges.sql §10
impersonates authenticated and, with the six policies widened to using(true)/with check(true)
inside a DO block ending in an unconditional raise exception, reported 7 VIOLATIONS — the
no-profile subject seeing 1 row on clients/checkins/profiles, the insert ALLOWED, and the
claim-less subject seeing 1 row on all three — then rolled back. A second read-only run
substituting expectation literals produced 15 more. No privilege was granted at any point:
the read-only technique held this round.
Item 2 was proven in a REAL BROWSER, not by unit test: built with VITE_SUPABASE_URL absent,
the headless dump shows "A required setting is missing..." plus the GitHub-secrets steps
rendered into #root, with the original error still surfacing in the console. Control build
renders the sign-in form.
Three new source files (errorText.ts, startupError.ts + tests) and changes to appState.ts,
useSession.ts, useProfile.ts, App.tsx, main.tsx, index.html.

Six concerns disclosed by the implementer, all routed to the re-review rather than settled by me:
  1. §10 FAILS on an empty/unactivated database by design (no active profile or no clients =
     violation, not skip). This is in DIRECT TENSION with Important 3's purpose: the guard that
     protects the security posture would be unrunnable on a freshly rebuilt project, which is
     exactly when someone most needs it. The re-reviewer is asked to recommend accept-or-reshape.
  2. The negative subject is a UUID with no profiles row; an inactive-WITH-profile subject is
     not separately covered (same `exists` -> false; covering it needs an auth.users write).
  3. deriveAppState gained a 6th POSITIONAL parameter with a default rather than an object-arg
     refactor, to keep 10 existing positional call sites valid.
  4. deploy.yml DUPLICATES the test job instead of using workflow_run, so the rls.test.ts
     exclusion now exists in TWO places and can drift.
  5. main.tsx dynamically imports App, code-splitting it into a second chunk, and index.html's
     fallback text FLASHES BRIEFLY ON EVERY LOAD — user-visible on every single page load, so
     it is judged as a visual defect rather than an implementation detail.
  6. §9d now reports a default-ACL function twice (once naming PUBLIC, once via §9b naming anon).
Single scoped re-review dispatched (opus), range 8f735e2..54b74b4. Per the workflow there is NO
second fix wave: whatever remains open after this, I adjudicate and record.

## BACKUP RISK CLOSED, 2026-08-20
Josh pushed via GitHub Desktop (twice — his first push predated the fix wave). Verified:
origin/slice-0-plumbing == local HEAD == 54b74b4, 20 commits on the remote, nothing unpushed.
~/Downloads is no longer the only copy of this project's history. This was the largest standing
risk to the project across both sessions and it is resolved.
Correction I made to Josh: I told him signing into GitHub Desktop would let me push from here.
Wrong — `git fetch` succeeded only because the repo is PUBLIC (anonymous read needs no auth),
and GitHub Desktop keeps credentials in its own store that plain git cannot read
(`git credential fill` returns nothing). Pushing remains a GitHub Desktop action unless the gh
CLI route is taken later. Recorded because a future session will otherwise re-derive it.
Note: pushing the BRANCH triggers no workflow — test.yml fires on push-to-main and
pull_request, deploy.yml on push-to-main. So nothing has deployed and nothing has run in CI yet.

## FINAL RE-REVIEW: all 4 Importants + all 12 Minors ADDRESSED, no new Critical/Important.
Important 1 independently re-proved by the mandated read-only technique, not accepted from the
report: substituting each expectation literal made every §10 branch fire, and the insert probe
returned `42501 new row violates row-level security policy for table "clients"` — a POLICY
refusal, distinct from the grant-layer `permission denied for table` this project previously
mistook for one. That distinction WAS the finding, and it is closed.
Important 2 reproduced in real headless Chrome on BOTH paths: configured build renders the
sign-in form with the fallback paragraphs gone; broken build renders "A required setting is
missing, so the app cannot start", names the setting, and lists the GitHub-secrets steps, while
the original error still reaches the console unswallowed. env.ts absent from the diff, so the
throw was not softened.
Live DB verifiably unchanged — md5 of all three tables measured three times, identical:
profiles e99838a8…, clients 1c35dc06…, checkins c713bef4… (total_score 15). All eight policy
predicates, table ACLs, the profiles.full_name column ACL, and the three private function ACLs
unchanged. No privilege granted at any point; no ALTER POLICY run. Only irreversible side
effect anywhere: identity-sequence advancement from rolled-back insert probes.

## FOUR RESIDUALS — adjudicated by me, NO second fix wave dispatched (workflow allows one)
Ruling: residual 1 is LOAD-BEARING and I am surfacing it to Josh rather than parking it.
`verify:privileges` is UNPASSABLE on a freshly rebuilt project, and the missing piece is not SQL
— it is that THERE IS NO DOCUMENTED WAY TO CREATE THE FIRST CLIENT. `grep -rn "\.insert(\|
\.upsert(" src` returns exactly one hit (the check-in upsert), so no client-creation UI exists
anywhere, and neither the README nor the spec documents an `insert into public.clients`. A
rebuilder following the new rebuild instructions reaches §10b's "add a client and re-run" with
no way to comply, and the guard stays red. Worse, README:306-308 tells them to treat a failure
there as a security incident. The re-reviewer's recommendation is right: keep §10's strictness
(skipping on an empty DB is the exact vacuity this branch exists to eliminate) and fix the
README — add the one-statement seed SQL, and collect the two precondition failures into a
distinctly labelled error reading "could not verify the read path (N precondition unmet); no
security violation was found". This directly undercuts Important 3, which we just built.
Ruling: residual 2 is LOAD-BEARING for a different reason — IT IS THIS PROJECT'S SIGNATURE
DEFECT CLASS. §10 guards `clients` for emptiness but not `checkins`, so at verify-privileges.sql
:575, :618 and :685 the assertions reduce to `0 = 0` when checkins is empty, and
`checkins_select_active_users` widened to `using (true)` would PASS in the reachable state
{active profile, >=1 client, 0 check-ins}. Leaving a known-vacuous assertion inside the very
guard we built this wave to be non-vacuous is not acceptable to ship knowingly. One line of SQL
mirroring :549 closes it.
Ruling: residual 3 (the fallback's SECOND paragraph — "If this message is still here after a few
seconds, the app did not start" — flashes unstyled on every single page load, lengthened by the
deliberate code-split, and reads as an error to a non-developer) is cosmetic but user-visible on
every load. Fix is to omit it from the initial markup and reveal it from a tiny inline setTimeout.
Ruling: residual 4 (README nits — where the project <ref> comes from, "It writes nothing" being
untrue since the probe burns a clients.id, and the absence of ONE ordered rebuild sequence) is
genuinely minor; the ordered-sequence one is the most valuable of the three for this owner.
DECISION PUT TO JOSH: residuals 1, 2 and 3 are each roughly one line and all three sit in the
"we built this to be trustworthy" category, so my recommendation is one small pass before the
merge rather than carrying them. Merging first would make a knowingly-vacuous security assertion
permanent in the history of a branch whose whole point was eliminating exactly that.

## CONTROLLER-FOUND BUG in the residual pass, 2026-08-20 — caught by verifying myself
Residual pass delivered 4ad7c7e, 8322611, 506cf54. Tests 60/60, tsc/build/lint/verify all exit
0, and the live privilege matrix reads correctly (auth_update_role false, auth_update_is_active
false, auth_update_full_name true, anon_select false, rls_enabled true, rls_forced false).
BUT: I did not stop at the green run. I re-proved the new checkins guard MYSELF by copying
scripts/verify-privileges.sql to the scratchpad and substituting the count read with
`... from public.checkins where false`. The repo and the live DB were never touched.
Result: NOT the expected precondition message, but
  ERROR 22503/22023: unrecognized format() type specifier " "
  HINT: For a single "%" use "%%".  CONTEXT: line 804 at RAISE
Diagnosis, then confirmed by a second doctored copy: verify-privileges.sql:836 calls
  format(E'\nAND % check(s) could not be run at all:\n  - %', ...)
using RAISE-style bare `%` placeholders inside format(), which requires `%s`. Changing the two
placeholders to %s in the scratch copy produced the correct combined report:
  "verify:privileges FAILED with 1 violation(s): - an ACTIVE user sees 1 of 0 rows in
   public.checkins ... AND 1 check(s) could not be run at all: - public.checkins is empty ..."
So the shipped guard CANNOT REPORT THE COMBINED CASE — at least one real violation AND at least
one unmet precondition — and dies with an opaque Postgres error instead. That is precisely the
state of a partially-seeded project that also has a genuine privilege problem, and the entire
stated purpose of this section was to let an operator tell "not enough data yet" from "something
is wrong". It still exits non-zero, so nothing passes silently; the failure is legibility, not
safety.
Why every proof missed it: all four implementer proofs were SINGLE-condition (violations=0
preconditions=1, or violations>0 with preconditions=0). The buggy branch only executes when both
arrays are non-empty. A reminder that "I proved the assertion fires" is not the same as "I proved
every branch of the reporting path runs".
Ruling: this is a defect IN the residual pass Josh approved, so completing it falls inside that
approval and does not constitute a second fix wave. Sent back with the exact diagnosis and a
requirement to prove the COMBINED case specifically. Cost if wrong: two characters.

## Residual pass closed, 2026-08-20
Commits 4ad7c7e (checkins guard + precondition/violation split), 8322611 (boot fallback),
506cf54 (README: ordered rebuild sequence, client seed SQL, <ref> lookup, "writes nothing"
correction), c9d9088 (the format() placeholder fix I found).
The implementer's audit was MECHANICAL rather than by eye — a script classifying all 235 string
literals in the file by owning call (29 format, 5 raise, 201 other) and checking BOTH directions
(bare % inside format(), %s/%I/%L inside raise where it would print literally) plus
placeholder-vs-argument arity for every raise. Line 836 was the only instance either way; arity
clean at 87, 679, 831, 844, 848; the seven migrations contain no format() or raise at all.
It also self-corrected a README sentence before committing: it had written that the insert/upsert
grep "returns exactly one hit" when it returns five (one real write in Board.tsx, four denial
probes in rls.test.ts). The substantive claim — the app contains exactly one write path — holds;
the count did not. Worth noting because I had repeated the wrong count to Josh from the
reviewer's report.
I re-verified the combined case MYSELF against the fixed script: P0001 with the full report
("FAILED with 1 violation(s) ... AND 1 check(s) could not be run at all"), which is the intended
user-defined exception rather than 22023. Real unmodified run exits 0.
Known and accepted: verify:privileges advances clients_id_seq by one per run (last_value 15 vs
max(id) 4) because the write predicate is probed for real and rolled back. Documented, not fixed
— avoiding it would mean not probing the write path.
Josh's decision recorded: KEEP THIS LOG. Committed to docs/superpowers/ so git history preserves
it and the push backs it up. Scanned beforehand: no real credentials; the only credential-shaped
strings are deliberate fakes; the publishable key is browser-public by design.
