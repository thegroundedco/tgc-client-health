# Phase 1, Slice 1 — Scoring for Real

**Date:** 2026-08-21
**Status:** Approved design
**Parent spec:** `docs/superpowers/specs/2026-08-20-tgc-client-health-design.md`
**Amends the parent:** §6.1 (`pillar_definitions` deferred), §8 (board sort toggles deferred),
§9.4 (Archivo self-hosted rather than CDN-linked)

## 1. Why this slice exists

Slice 0 proved the plumbing: Josh signs in, sees a client, saves a score, and it survives a
reload. It also produced the project's most valuable finding, and produced it in the worst
possible way — the owner clicked the only button on the board, saw nothing change, and correctly
reported the tool as broken. The write had landed seconds earlier.

**Slice 1's goal: a person can score a client and know that it worked.** Everything below serves
that sentence.

## 2. Phase 1 is four slices, not one

Phase 1 as written in the parent spec §11 is four largely independent subsystems. Decomposed:

| Slice | Contents | State |
|---|---|---|
| 1 | Staging database, styling tokens, check-in screen, board rewrite, real roster | **this spec** |
| 2 | Clients admin: add, edit, owner, status, end date, coded reason. Board sort and archive toggles | designed in parent §6.1, §8 |
| 3 | `permission_overrides`, `has_capability`, last-admin guard, users admin, negative tests | designed in parent §7 |

Styling was originally a fourth slice. It is folded into the front of this one, because the
check-in screen is the highest-value screen in the build and building it twice — once plain, once
styled — is waste. Folding it forward also settles the unproven question from Slice 0's styling
deferral (does a web font load from Pages under `/tgc-client-health/`?) on screens that already
exist, before anything depends on the answer.

Two standing debts are explicitly **not** in Phase 1's slices: the views/matviews privilege sweep,
which belongs with the Phase 3 reporting work it protects and has nothing to protect yet, and a
column-grant sweep beyond `profiles`.

## 3. Order of work

Five steps, each independently deployable, in this order:

1. **New Supabase account, two projects.** The free-plan quota is two projects **per account**,
   across every organisation where you are Owner or Administrator — a second organisation under
   the same account buys nothing. Josh's original account was already at its limit, one of the two
   projects being unrelated to this work and out of scope. He therefore created a second account;
   production and
   staging are both recreated under it, giving one CLI login and freeing the original account.
   Recreated rather than transferred: seven migrations in git, one test row of data, no storage
   and no edge functions make a fresh `db push` cheaper and less exotic than a cross-organisation
   transfer. A project created now is also born after Supabase's 2026-04-28 default-privileges
   change, so it will not carry the trap that cost Slice 0 the most time — the migration that
   fixes that history becomes a harmless no-op, and `verify-privileges.sql` asserts end states
   rather than history, so it still passes.
2. **Token foundation applied to existing screens** — sign-in, access-pending, the four error
   states, the current board. Nothing new is built. This step proves the font.
3. **Check-in screen.** Five pillars with anchors, notes, last month alongside, submit with
   confirmation, local draft.
4. **Board rewrite.** Real per-client state, save confirmation, `Score all 3s` deleted.
5. **Seed script.** The real roster, staging first, then production.

Deliberately out of scope, recorded so it cannot drift in: `pillar_definitions`, month
navigation, sparklines, the clients admin screen, `permission_overrides`, the users panel, the
copy-paste prompt bridge, board sort chips, the archived toggle.

## 4. Styling

### 4.1 Two layers of token

`src/styles/tokens.css` holds two distinct layers:

```css
/* brand layer — identity, from Grounded_Styleguide_Final.ai */
--brand-ink: #1F1F1F;    --brand-paper: #FBF7EB;
--brand-teal: #83C1C0;   --brand-blush: #FFB3AB;  --brand-red: #F9423A;

/* semantic layer — meaning. Components use ONLY these. */
--band-healthy: var(--brand-teal);
--band-watch:   #E8A33D;   /* functional amber, deliberately not brand */
--band-risk:    var(--brand-red);
```

Components reference the semantic layer exclusively. The reason is a question the owner asked
directly — how hard is a rebrand later? With one layer, `--band-healthy` *is* teal, and a rebrand
that drops teal silently breaks health encoding. With two, a rebrand rewrites the brand layer and
the status system survives untouched, including the functional amber, which was never brand and
must not move with one.

Expected costs of a later identity change, given this structure: a palette swap is one file; the
Archivo-to-Field-Gothic swap is one file plus the font files, with the caveat that Archivo is a
single variable file spanning widths 62–125 while Field Gothic is a separate cut per width, so it
is five to seven files and a larger payload, not a like-for-like substitution; a full identity
change is a design pass, most of it redoing the parent spec §9.2 contrast measurements and
re-proving the three health bands remain distinguishable.

One constraint any future palette inherits: **§9.3's rule that every band carries a text label is
load-bearing**, because teal against warm red is 1.76:1 and no colour choice fixes that.

### 4.2 Enforced, not intended

A Vitest test walks `src/` and fails on any hex colour outside `tokens.css`, and on any
`font-family` whose value is not a `var(--…)` reference. The distinction matters: components must
be able to *apply* a face (`font-family: var(--face-display)`), they must never *name* one. A rule
banning the property outright would make the display face unreachable and would be deleted within
a day. Intent decays; a failing test does not. This test is the whole reason the rebrand answer
stays cheap.

### 4.3 Self-hosted Archivo

One variable WOFF2 in `public/fonts/`, `@font-face` in `tokens.css`, `font-display: swap`.
Three reasons, in order of weight:

1. It settles the base-path question definitively rather than partially.
2. It removes a third-party request from a tool whose premise is boring reliability.
3. It is the exact mechanism a licensed Field Gothic will need, so that swap becomes replacing a
   file rather than rewiring the app.

**Known risk, to be discovered at step 2 rather than step 4:** if the build environment cannot
fetch the font binary, the fallback is Josh downloading it or linking the Google Fonts CDN. The
fallback is worse but not blocking.

### 4.4 Type roles

Archivo alone, across widths, mirroring the parent spec §9.4's mapping of Field Gothic:
display at width 125 / weight 800; section headers at width ~70 / weight 700 uppercase; eyebrows
at width ~118 / weight 300 with wide letter-spacing; body at normal width; captions at width ~62 /
weight 700. Every score renders with `font-variant-numeric: tabular-nums`.

### 4.5 Two decisions of omission

- **CSS modules per component**, plain CSS, no dependency. Scoping without a framework, and it
  keeps values out of TSX where the token test has less purchase.
- **Light theme only.** The brand is cream and black, and a dark mode doubles the §9.2 contrast
  work for a tool used at a desk in daylight. A decision, not an oversight.

## 5. The check-in screen

### 5.1 Navigation

A `selectedClient` state in the board container. The card is the click target; "Board" returns.
No router, therefore no URL change, therefore a refresh returns to the board. Deep-linkable
check-in URLs require the GitHub Pages `404.html` redirect trick, which is not worth buying until
someone wants to send a colleague a link to a single check-in.

### 5.2 Reads

One query, not three: the client row, this month's check-in and last month's, via
`.in('period', [previous, current])`. Fewer round trips and one failure mode rather than three.
Last month's total is shown beside this month's for comparison, because a score compared is a
judgment and a score alone is a guess.

### 5.3 The total belongs to the database

`score.ts` computes a total locally so the number moves as pillars are clicked, but after any save
the screen displays what the generated column produced. This closes a deferred Slice 0 finding: a
test drives identical pillar combinations through `totalScore()` and the SQL column and fails if
they disagree.

An incomplete check-in shows an em dash, never a number. Parent spec §6.2: incomplete must read as
incomplete, never as "at risk".

### 5.4 Draft versus submitted — the one state deliberately added

A partial check-in writes its pillars and leaves `submitted_at` null. Only a complete five sets
`submitted_at` and `submitted_by`.

**One control, whose label reflects the state it is in.** The button reads `Save draft` while
fewer than five pillars are scored and `Submit check-in` once all five are. Both press the same
upsert; only the complete one sets `submitted_at`. So the database is written on an explicit press
and never on a timer or a navigation, `localStorage` covers everything between presses, and there
is no third hidden write path to reason about. A control that changes its own label is also the
opposite of `Score all 3s`, which wrote a constant regardless of state.

Consequences, all of them wanted:

- "8 of 11 scored" on the board has an exact definition: `submitted_at is not null`.
- An unfinished check-in is durable and resumable, on any machine, not just in one browser.
- Incomplete cannot masquerade as scored, and scored cannot masquerade as incomplete.

### 5.5 Nothing typed can be lost

Every click and keystroke writes to `localStorage` under `checkin-draft:{clientId}:{period}`,
cleared only on a confirmed save. If a saved row and a local draft disagree on load, the draft
wins and says on screen that it has not been saved. Parent spec §8.1.

### 5.6 The save path is a state machine, and it is never silent

```
clean --edit--> dirty --submit--> saving --ok--> saved --edit--> dirty
                                         \--fail--> failed --retry--> saving
```

- `saved` names the time and the person. It is the confirmation, and it is durable.
- `failed` keeps every input on screen and says that retrying costs nothing.
- No transition leaves the screen unchanged after a click. That is the defect this slice exists
  to fix.
- Submit is blocked entirely while a read has failed, so a transient outage can never overwrite
  real pillars with an empty form. Parent spec §8.1's "never write after a failed read."

The machine is a **pure reducer**, so the confirmation logic is unit-testable without a browser.
That is what makes this class of defect visible to review in future.

## 6. The board rewrite

`Score all 3s` is deleted. It wrote a constant, which is a guaranteed no-op whenever the data
already matches — a false negative by construction, and the second half of the owner's finding.

The card becomes the click target and carries: client name, owner, the total from the database or
an em dash, the band with its mandatory text label, five per-pillar bars, and a footer that names
who submitted it and when — or "not started", or "draft, 4 of 5".

**That footer is the save confirmation.** It is better than a toast because it survives a reload,
which is precisely the check the owner ran and got no answer from.

The progress line counts `submitted_at is not null` over active clients.

Cut from this slice: the sort chips (§8 asks for them; with eleven clients on one screen they earn
little) and the archived toggle (depends on the `former` status arriving in Slice 2).

## 7. Staging, migrations and the seed

Two Supabase projects, the same seven migrations pushed to both. `.env.local` points at staging;
the deploy keeps reading production from GitHub Actions secrets. No code changes, and no path by
which the deployed site talks to staging.

### 7.1 There are no backups, and that is a bigger risk than the missing staging environment

**The free plan includes no automated backups and no point-in-time recovery.** Supabase's own
guidance for free projects is to export regularly with the CLI and keep the result off-site. So
before any real client data lands, the honest statement of risk is not "we have nowhere to
rehearse a migration" — it is "if this database is lost, there is nothing to restore from."

**`supabase db dump` cannot be used here. It requires Docker.** Measured 2026-08-21 on this
machine: `db dump --linked` and `db dump --linked --data-only` both fail with
`LegacyDockerRunError` and write a zero-byte file. Docker Desktop is absent, and so is Homebrew.

What does work, measured the same day, is `supabase db query --linked -f <file>`, which is how
`verify:privileges` already runs. So `npm run db:dump` is built on that: a SQL file whose rows are
generated `insert` statements, extracted from the CLI's JSON output into a re-runnable `.sql`
file. The data volume makes this comfortable — eleven clients scored monthly is on the order of
130 rows a year.

Two rules attached to it:

- **Output is gitignored, and never committed.** It contains real client data.
- **No automated dump in GitHub Actions.** Supabase documents an Actions cron for exactly this,
  and it is the wrong tool here: **this repository is public, and workflow artifacts on a public
  repository are downloadable by anyone.** An automated dump would publish the client data it
  exists to protect. The dump stays a local command, run deliberately, writing somewhere Josh
  controls.

A manual fallback needing no tooling at all: the dashboard SQL editor runs a select and downloads
the result as CSV.

### 7.2 The hazard the two projects introduce, and the mitigation

Which project a command targets lives in one gitignored file, `supabase/.temp/project-ref`, and
nothing prints it. `npm run verify:privileges` runs `--linked` and has a known side effect: it
advances `clients_id_seq`, because it probes the write path for real. A silent mislink therefore
means running write probes against production.

Mitigation: a new `npm run db:which` prints the linked ref **and** its project name, and is
called first inside `verify:privileges` and inside a new `npm run db:push` wrapper — neither
script exists yet; both are built in step 1 — so the check cannot be skipped. Production is linked
deliberately, one command at a time, never left linked.

### 7.3 The roster is a seed, not a migration

Migrations run in every environment; the real client list must not. `scripts/seed-clients.sql`,
idempotent, run by hand against staging and then production. Josh supplies the list; v1's starter
set was Babaloo, CRP, Colorfil, Gait Happens, Gibs Grooming, Juan Valdez, LoFli Balls, Polar
Divide, Remi App, Sno-Go, York.

## 8. Testing

| Layer | Covers |
|---|---|
| Vitest | The save state machine as a pure reducer; the draft cache; `score.ts` against the SQL generated column; the token test (no hex or `font-family` outside `tokens.css`) |
| `verify:privileges` | Unchanged, and from now on run against **staging** |
| Manual, per task | "Would a person know this worked?" answered out loud |
| Manual, per slice | The owner on the deployed site, before anything is written up |

The last two rows are the point. Slice 0 established that every reviewer verified writes by
querying the database, and that no automated signal in the project could see a screen that told
the user nothing. The fix is procedural, so it lives in the plan where it cannot be skipped.

## 9. Decisions recorded, with what they cost if wrong

| Decision | If wrong |
|---|---|
| `pillar_definitions` deferred | Rubric wording needs a deploy to change. Wording has changed zero times since v1 and the five pillars are settled |
| Styling folded to the front | A day spent on tokens before the owner's finding is fixed. Buys building the check-in screen once, and proves the font early |
| Self-hosted font | If the binary cannot be fetched here, fall back to the CDN. Costs one step, blocks nothing |
| Light theme only | A dark-mode request later means redoing §9.2's contrast work for a second ground |
| Partial check-ins persist | One more state on the board. Buys an honest progress count and cross-machine resume |
| State-based navigation | No linkable check-in URLs until a router and the Pages 404 trick arrive |
| Staging as a second cloud project, on a new account | Free projects pause after 7 days idle and need a dashboard click to wake. Two accounts to keep track of, and the new one owns the agency's data — registered on an alias of Josh's address, which is a governance question to revisit if this becomes a team tool |
| `db:dump` built on `db query` rather than `db dump` | If the generated-insert approach proves fragile, the fallbacks are the dashboard's CSV download or installing Postgres.app for a real `pg_dump`, which needs the database password from the dashboard |
| No automated backups anywhere | Every dump depends on somebody remembering. Automating it needs a private place to put the output, which a public repository is not |
| Sort chips and archive toggle cut | The board is unsorted beyond its default until Slice 2 |

## 10. Open items carried forward

1. **Josh's real client roster** — blocks step 5 only, not the build.
2. **Logo SVG export** — horizontal lockup and the standalone kiwi for the favicon. The header
   carries a placeholder until it lands.
3. **Field Gothic webfont licence** — one file swap whenever it is decided, per §4.1.
4. **Phase 2's scope is worth revisiting before it starts.** Productive already holds the SOWs and
   the billing. If the need is to *see* revenue beside health rather than to *maintain* it here,
   Phase 2 collapses from two tables and four capabilities into a pasted export and a read-only
   column — roughly one session instead of three. Not a decision for today; the single largest
   lever on the finish date.
