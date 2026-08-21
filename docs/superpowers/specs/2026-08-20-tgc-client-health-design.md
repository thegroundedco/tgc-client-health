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
`private.has_capability(text)` helper — `security definer`, `set search_path = ''`
— which resolves the caller's role and overrides and requires `is_active`.
Policies wrap it in a subselect so Postgres evaluates it once per statement
rather than once per row.

**The grants on such a helper are not the obvious ones.** This paragraph
originally said `execute` is revoked from `public`, `anon`, and `authenticated`.
For a definer helper that is *not* referenced by a policy — `handle_new_user`,
`touch_updated_at`, invoked only as triggers — that is correct and is what
shipped: they hold `postgres=X` and nothing else. For a helper a *policy*
references it is wrong, and wrong in the worst way: **Postgres checks `EXECUTE` on
a policy-referenced function at query time against the role running the query**,
not against the table owner. Revoking it from `authenticated` makes every policy
naming that role fail `42501 permission denied for function …` for every
signed-in user — a total outage, not a degraded read. Measured on this project
(Postgres 17.6, 2026-08-21) before Slice 0's tables were created, and reproduced
independently in review; transcript in
`supabase/migrations/20260821021840_create_clients_and_checkins.sql`. Supabase's
own RLS guidance recommends the broken pairing, so expect to have to argue this.

The rule for a **policy-referenced** definer helper is therefore:

- `execute` revoked from `public` and `anon`. `public` is load-bearing, not
  belt-and-braces: Postgres grants `EXECUTE` on every new function to `PUBLIC`
  and no `ALTER DEFAULT PRIVILEGES` on this project suppresses it, so `anon`
  reaches the function implicitly unless `public` is named.
- `execute` granted to **exactly the roles its policies name** — for Phase 1's
  `to authenticated` policies, that is `authenticated` and nothing else.
- schema `private` **never** granted `USAGE` to a browser role. This is what keeps
  the grant narrow: a policy references a function by OID and so needs only
  `EXECUTE` at run time, while calling it by name needs `USAGE` on its schema. A
  role can therefore be *subject to* a helper without being able to *call* it
  (measured: `42501 permission denied for schema private`).
- the helper is **argument-free, or validates its arguments against
  `(select auth.uid())`**. `is_active_user()` is safe partly because it takes no
  arguments and reports only on the caller's own row. A helper like
  `is_team_member(bigint)` becomes an enumeration oracle the moment `private`
  USAGE leaks — one leaked grant should not also hand over a probe. Phase 1's
  `has_capability(text)` takes an argument, so it must read the caller's own
  capabilities from `auth.uid()` internally and never accept a subject as a
  parameter.
- both halves pinned by `scripts/verify-privileges.sql` §9, which sweeps every
  function in `private` against an explicit allowlist: an unlisted `EXECUTE` for a
  browser role fails, and so does a listed one whose grant has gone missing. The
  second direction is the one that catches the outage.

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

Source: `Grounded_Styleguide_Final.ai` (16 pages, 2025). Values below are read
directly from the guide, not approximated.

### 9.1 Palette

| Token | Brand name | Hex | RGB |
|---|---|---|---|
| `--ink` | Rich Black | `#1F1F1F` | 31 31 31 |
| `--paper` | Spot Cream | `#FBF7EB` | 251 247 235 |
| `--teal` | PMS 4174 C | `#83C1C0` | 131 193 192 |
| `--blush` | PMS 169 C | `#FFB3AB` | 255 179 171 |
| `--red` | PMS Warm Red C | `#F9423A` | 249 66 58 |

The guide also defines tint ramps beneath each core color, and the separations
carry PMS 3556 C and 6045 C which do not appear on the palette page — treated as
out of scope unless you say otherwise.

Usage proportion from the guide's color-usage page: Rich Black and Spot Cream
dominate; teal and warm red are accents; blush is a supporting tone.

### 9.2 Contrast — measured, and it constrains the UI

| Foreground | On cream `#FBF7EB` | On black `#1F1F1F` |
|---|---|---|
| Rich Black | **15.39:1** | — |
| Warm Red | 3.34:1 — large text only | **4.61:1** |
| Teal | 1.89:1 — **unusable as text** | **8.13:1** |
| Blush | 1.60:1 — **unusable as text** | **9.64:1** |

Consequences, which are not negotiable if the tool is to stay readable:

- **Teal and blush are fills, never text on cream.** They carry dark text on top
  (8.13:1 and 9.64:1 respectively) but cannot themselves be read against the
  background. The styleguide uses teal as display type at poster scale; that does
  not transfer to 13px UI labels.
- **Warm red is display-scale only on cream** (3.34:1 passes large-text, fails
  body). Error text on cream uses Rich Black with a red icon or rule, not red text.
- **Body copy is Rich Black on Spot Cream.** Everything else is decoration.

### 9.3 Status colors — a gap in the brand palette

The brand has no green and no amber, and blush versus warm red measure only
**2.09:1** apart — far too close to encode two adjacent health bands that users
must tell apart at a glance.

Resolution: health bands use **one functional amber outside the brand palette**,
reserved exclusively for status and never used as brand expression.

| Band | Score | Fill | Rationale |
|---|---|---|---|
| Healthy | 18–25 | Teal `#83C1C0` | On-brand, clearly separated from red |
| Watch | 11–17 | Functional amber `#E8A33D` | Fills the palette gap; 7.64:1 for dark text on it |
| At risk | 0–10 | Warm Red `#F9423A` | On-brand, and red already means trouble |

**Luminance separation between the three fills is inherently weak** — teal against
warm red is only 1.76:1, and every candidate amber lands within 1.9:1 of red. All
three bands sit at mid lightness, so no colour choice fixes this.

The distinction therefore rests on **hue plus a mandatory text label**, never on
brightness. This is why the label rule is structural rather than cosmetic: in
greyscale, or for a red-green colour-blind viewer, the word "Watch" is what carries
the meaning. Any future status indicator follows the same rule.

### 9.4 Typography

The guide's entire system is **Field Gothic**, used across widths and weights:

| Role | Face |
|---|---|
| Headline / primary read | Field Gothic No. 85 XBold XWide |
| Second-level header | Field Gothic No. 34 Demi XCondensed |
| Micro details / eyebrow | Field Gothic No. 70 XLight Wide |
| Lead paragraph, emphasis | Field Gothic No. 64 Demi |
| Body | Field Gothic No. 62 Regular; bold No. 66 XBold |
| Small caption | Field Gothic No. 25 Bold XXCondensed |
| Alternative display | Duc De Berry LT (blackletter) |

**Open licensing question.** Field Gothic is a commercial family and is not on
Google Fonts. Using it on the web needs a *webfont* licence and WOFF2 files —
a desktop licence covering the Illustrator file does not extend to web embedding.
Two paths:

1. Supply the licensed WOFF2 files → exact brand match.
2. Substitute **Archivo** (Google Fonts, variable, width axis 62–125 and weight
   100–900), which reproduces Field Gothic's wide/condensed range from one
   family and is free to embed.

**Decided: Archivo**, with every face defined as a CSS custom property in one file
so switching to Field Gothic later is a single edit.

The display faces (Duc De Berry, Sloop Script, Fatboy Slim, ZITZ) have no role in
this tool and are ignored.

### 9.5 Logo

Wordmark is "GROUNDED" with the kiwi icon replacing the O; variants include
stacked lockups, a TGC monogram, and circular badges. **Needs an SVG export from
Illustrator** — extracting clean vectors from the 226MB `.ai` is not worth the
effort when an export takes seconds. The app needs the horizontal lockup and the
standalone kiwi icon (for the favicon).

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

1. **Logo SVG export** — horizontal lockup plus the standalone kiwi icon for the
   favicon. Needed before final styling; nothing else blocks on it.
2. **Private repo hosting** — GitHub Pages needs a paid plan for private repos;
   alternative is a public repo or a third-party host. Decide at deploy.
3. **Starter client roster** — the real client list to seed. v1 had a hardcoded
   starter set; v2 will take it from you, or start empty and add via the UI.
