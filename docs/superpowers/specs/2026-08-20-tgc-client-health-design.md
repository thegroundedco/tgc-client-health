# TGC Client Health — Design

**Date:** 2026-08-20
**Status:** Approved design, pending brand assets
**Supersedes:** `tgc-client-health v.1 ` (single-file HTML artifact)

## 1. Purpose

A monthly client-health check-in tool for The Grounded Company's account
management team. Several AMs score their clients across five pillars, record what
each client is contracted for and what they actually bill, and read the resulting
trends — from one shared, durable dataset.

## 2. Why a rebuild

v1 worked as a design but failed as infrastructure. It stored everything in the
Claude artifact platform's shared key-value storage, which meant a one-time
browser permission prompt, opaque save failures, and no real backup. The team hit
error messages more reliably than they hit insights.

The rebuild's central goal is therefore **boring, trustworthy persistence**. Every
other decision defers to that.

## 3. Goals and non-goals

**Goals**

- One shared dataset several AMs can read and write concurrently.
- Access controlled per person, enforced by the database.
- Client revenue derived from contracted work, overridable when billing differs.
- Zero recurring cost.
- Nothing to operate: no server to keep running, no key to rotate.

**Non-goals**

- No paid API usage of any kind. This rules out server-side LLM calls.
- No automated ingestion from Slack, Gmail, or Productive. Scoring stays a
  deliberate human judgment.
- No mobile app. A responsive web page is sufficient.

## 4. Constraints

- **No metered spend.** AI assistance, where present, is a copy-paste bridge to a
  Claude subscription the user already pays for — the tool builds a prompt, the
  user pastes it into Claude, and pastes the result back. The tool is fully
  functional if that feature is never used.
- **Available infrastructure:** Supabase, GitHub, local files. No new paid accounts.
- **The client is untrusted.** A static site ships its own source code, so the
  browser cannot be a security boundary.

## 5. Architecture

A static React single-page app talking directly to Supabase. No backend of our own.

| Concern | Choice | Reason |
|---|---|---|
| Front end | Vite + React + TypeScript | Types generated from the schema turn a renamed column into a build error, not a silent runtime break |
| Data | Supabase Postgres | Durable, backed up, queryable, free tier is ample |
| Auth | Supabase magic link | No passwords to manage or reset for teammates |
| Migrations | SQL files in `supabase/migrations/`, applied via Supabase CLI | Every schema change is reviewable in git |
| CI/Deploy | GitHub Actions → GitHub Pages | Push to `main` publishes; AMs just get a URL |

The browser holds Supabase's public anon key. This is by design — that key is
meant to be public, and **row-level security is the real access boundary**
(section 7).

**Open decision:** GitHub Pages on a *private* repo requires a paid GitHub plan.
A public repo is free and safe in substance — no secrets in the code, all data
behind auth in Supabase — but publishing the repo may be undesirable regardless.
Free alternatives serving private repos (Cloudflare Pages, Netlify) cost one more
account. Deferred to deployment time; nothing in the design depends on it.

## 6. Data model

### 6.1 Phase 1 tables

**`profiles`** — one row per login, keyed to `auth.users(id)` with cascade delete.
Email, display name, `role` (`admin` | `account_manager` | `viewer`), and
`is_active`. Leavers are deactivated, never deleted, so their submission history
survives.

**`permission_overrides`** — `(user_id, capability, granted)`, primary key on
`(user_id, capability)`. One row per exception to the role's baseline.

**`clients`** — name, optional `owner_id` → `profiles`, plus lifecycle:

- `status`: `active` | `paused` | `cancelled` | `former`
- `ended_on` (date), `end_reason_code`, `end_reason_note`

`cancelled` and `former` are the same event at different ages: `cancelled` is
recent and still under review, `former` is settled and archived. Both count as
churn in reporting; `former` is hidden from the board behind a "show archived"
toggle. A check constraint requires `ended_on` whenever status is `cancelled` or
`former`, so the churn date can never be skipped.

`end_reason_code` is drawn from a fixed list (price, scope/fit, in-housed, went
quiet, project completed, agency-initiated, other) so reasons are countable across
clients; `end_reason_note` carries the nuance. A coded reason alone loses the
story, and free text alone cannot be counted — hence both.

**`checkins`** — one row per client per month:

- `client_id` → `clients`, `period` (date, first of month)
- Five `smallint` pillar columns — `relationship`, `delivery`, `financial`,
  `sentiment`, `growth` — each constrained to 1–5, nullable while in draft
- `total_score` — generated column summing the five
- `notes`, `submitted_by` → `profiles`, `submitted_at`
- `unique (client_id, period)`

**`pillar_definitions`** — rubric anchors as data, so wording can be corrected
without a deploy.

### 6.2 Three decisions worth restating

**The period is a `date`, not a `"2026-08"` string.** v1 stored text keys and did
string arithmetic to move between months. A real date hands that work to Postgres
and removes a class of off-by-one bugs from year and quarter comparisons.

**`total_score` is generated by the database.** It cannot drift from the pillars it
sums. A check-in missing a pillar yields a *null* total rather than a misleadingly
low one — incomplete must read as incomplete, never as "at risk."

**Pillars are five columns, not five rows.** Simpler to query, constrain, and type.
The five are settled, so the cost — adding a sixth is a migration — is acceptable.

### 6.3 Phase 2 tables (designed now, built later)

**`sows`** — per client: name, value, `retainer` | `project`, start and end dates,
status.

**`client_month_revenue`** — derived monthly revenue per client, with an override
flag and an actual value.

Revenue lives in its own tables rather than as columns on `checkins` for a
structural reason: **row-level security hides rows, not columns.** Revenue sharing
a table with scores would mean anyone who can read a score can read the money,
which would defeat the per-user revenue permission outright.

### 6.4 Schema conventions

Lowercase snake_case identifiers throughout. `bigint generated always as identity`
primary keys (`profiles` excepted — it takes its UUID from `auth.users`). `text`
over `varchar(n)`, `timestamptz` over `timestamp`, `numeric` for money. Every
foreign key and every column referenced in an RLS policy gets an index.

## 7. Permissions

### 7.1 Model

Permissions are named **capabilities**, not screens. The UI hides features
according to them; the database enforces them.

Phase 1: `view_scores`, `edit_scores`, `manage_clients`, `manage_users`.
Phase 2 adds: `view_revenue`, `view_retention`, `view_sows`, `edit_sows`.

Starting with four is deliberate — the permission machinery is built and tested
before any sensitive financial data depends on it.

Role presets:

| Role | Capabilities |
|---|---|
| `admin` | all |
| `account_manager` | `view_scores`, `edit_scores`, `manage_clients` |
| `viewer` | `view_scores` |

Effective capabilities = **role preset + individually granted − individually
revoked**. Making one AM an exception is a checkbox, not a new role.

### 7.2 Enforcement

Every table has RLS enabled and forced. Policies call a
`private.has_capability(text)` helper — `security definer`, `set search_path = ''`,
execute revoked from `public`, `anon`, and `authenticated` — which resolves the
caller's role and overrides and requires `is_active`. Policies wrap it in a
subselect so Postgres evaluates it once per statement rather than once per row.

The practical test of this design: a browser querying data it lacks the capability
for, bypassing the app entirely, gets **zero rows** — in Phase 1 an inactive
account reading `clients`, and from Phase 2 a Viewer reading revenue. UI hiding is
convenience; the database refusing is the security.

### 7.3 Three holes closed by design

**No self-promotion.** Only admins may change `role` or `is_active`. Regular users
receive column-level `update` on their own display name and nothing else, so this
holds at the grant level rather than depending on the UI omitting a control.

**Signing up is not getting in.** Magic-link login means anyone knowing the URL can
request a link to their own address. New accounts are therefore created *inactive
with no capabilities*, and every policy requires the active flag. An unapproved
person logs in successfully and sees an "access pending" screen with no data. An
admin approves them in the users panel.

**No self-lockout.** A trigger refuses to demote or deactivate the last remaining
admin.

## 8. Screens (Phase 1)

| Screen | Purpose |
|---|---|
| Sign in | Email → magic link |
| Access pending | What an unapproved account sees; a dead end, not an error |
| Board | The month's check-in grid: a card per active client, scores and bands on submitted ones, visible incompleteness on the rest, a progress line, month selector, sort toggles |
| Check-in | Score five pillars against their anchors, write notes, submit; last month's scores shown alongside for comparison |
| Clients admin | Roster: add, edit, assign owner, change status, record end date and reason |
| Users admin | Approve signups, set roles, tick overrides, deactivate leavers |

Reporting views (Overview, Performance) are Phase 3.

### 8.1 Two interaction rules from v1's failures

**Nothing typed can be lost.** Check-in input is cached in the browser as it is
entered. If a save fails, the input survives with a visible "not saved yet"
marker. v1's characteristic failure was doing the work and losing it; this makes
that structurally impossible.

**Failures name themselves.** v1 rendered a failed read as "no data," leaving the
user unable to distinguish a broken tool from an empty month. v2 distinguishes four
states explicitly: not signed in, not permitted, could not reach the database, and
genuinely empty.

v1's one correct instinct is kept: **never write after a failed read**, so a
transient outage cannot overwrite real data with emptiness.

## 9. Visual design

Match The Grounded Company's brand exactly. Required assets: brand hex values
(primary, accent, neutrals), headline and body typefaces (with font files if
licensed rather than Google Fonts), and the logo as SVG.

**Pending.** Until supplied, v1's palette stands in as a placeholder — warm paper
`#F6F4EE`, ink `#211E19`, deep green accent `#28463A`, bands green `#3F7A52` /
amber `#B4822C` / red `#AE3B2C`, with Fraunces, Inter, and IBM Plex Mono. All of
it is defined as CSS custom properties in one file so the swap is a single edit.

Band thresholds carry from v1: Healthy 18–25, Watch 11–17, At risk 0–10.

## 10. Testing

| Layer | Tool | Covers |
|---|---|---|
| Permissions | SQL tests in CI | Each role's visibility, **including negative cases**: an inactive account sees no clients; a Viewer cannot write a check-in; a non-admin cannot change a role or read `permission_overrides` for anyone else; the last admin cannot be demoted |
| Logic | Vitest | Score totals, bands, month arithmetic, and the incomplete check-in reading as *no score* rather than a low one |
| Smoke | CI | The deployed page loads and reaches Supabase |

Permission tests carry the most weight because they cover the highest-consequence
failure. Clicking around as yourself proves nothing — you are an admin. Each new
capability added in Phases 2 and 3 ships with its own negative test, revenue
included.

## 11. Delivery plan

**Slice 0 — Plumbing.** Log in with a magic link, see one client, save one score to
Supabase, live on the real deploy target. Proves the exact thing v1 got wrong
before anything is built on top of it.

**Phase 1 — Foundation.** Schema, auth, roles and overrides, admin panels, client
roster with lifecycle, five-pillar monthly scoring, permission tests. Usable
alone: v1's core on solid ground.

**Phase 2 — Money.** `sows` and `client_month_revenue`, revenue derived from SOWs
and overridable per month, contracted-versus-actual variance, revenue capabilities.

**Phase 3 — Insight.** Overview and Performance views, net revenue retention,
trailing-six-month pillar trends, sparklines, and the copy-paste prompt builder.

Each phase gets its own spec, plan, and implementation cycle, and each ends
deployed and usable. Abandoning after any phase still leaves a working tool.

## 12. Open items

1. **Brand assets** — blocks final UI styling only.
2. **Private repo hosting** — GitHub Pages needs a paid plan for private repos;
   alternative is a public repo or a third-party host. Decide at deploy.
3. **Starter client roster** — the real client list to seed. v1 had a hardcoded
   starter set; v2 will take it from you, or start empty and add via the UI.
