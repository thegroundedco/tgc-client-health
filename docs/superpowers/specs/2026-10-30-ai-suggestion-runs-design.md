# AI suggestion runs — run, re-run and revert AI scores from the tool

Since 2026-10-28 the owner gets monthly "AI suggested scores": a Claude cloud routine reads his Gmail,
Slack and Fathom calls and writes a check-in per client to production, flagged with `suggested_at`
(see `2026-10-29-suggested-checkins-design.md`). On 2026-10-30 that routine was proven end to end and
rewrote October's 13 unreviewed suggestions.

Two gaps remain, both raised by the owner on 2026-10-30:

1. **The AI's version is lost on save.** Someone edits an AI-suggested check-in, saves it, and later
   wishes they had kept what the AI said. Today the save overwrote the answers and there is nothing
   to go back to.
2. **Only the owner can start a run, and only by asking Claude.** He wants anyone scoring in the
   tool to be able to produce fresh AI scores for a month, or for one client, from a button.

## Decided with the owner (2026-10-30)

- **Revert to AI suggested scores** exists on a check-in, for a check-in someone has already saved.
- After a revert the check-in **shows "Suggested — review" again**: it needs signing off like any
  other suggestion.
- **"Run AI suggested scores" on the board** runs for that month. A confirmation first asks whether
  to run it for the entire month for all clients; if not, the person ticks which clients to run.
- **"Run AI score for this client" inside a client's check-in** runs for that one client and month.
- If clients in a run have **already been manually scored**, a notice says *"These clients have
  already been manually scored – overwrite their data?"*, lists them, and lets the person choose to
  overwrite them with the AI scores or not.
- **Anyone who can edit scores** (`edit_scores`) can run, re-run and revert. Viewers cannot.
- The scheduled runs stay: **every Monday** for the current month, and **on the 1st** a final pass on
  the month just ended, with a Slack DM to the owner.

## Goals

- An AI version of every AI-touched check-in survives any number of human saves.
- Fresh AI scores are one click away for a month or a client, for anyone with `edit_scores`.
- A manual score is never replaced unless a person explicitly chose to replace it.

## Non-goals

- No history of past AI versions. Revert brings back the **latest** AI version only (Claude's call:
  the run buttons are how you get a newer one, so "latest" is the version worth keeping).
- No per-question revert; revert is the whole check-in (answers and note).
- No live per-client progress during a run. "Running" and "done" are enough.
- No editing of the routine's prompt or scoring rules from the tool.

## Anti-goals (a failure even if it works)

- A manual score overwritten without someone ticking it.
- The routine's trigger token reachable from the browser, the repo, or a viewer's session.
- Two runs for the same month racing each other because someone clicked twice.
- A run that dies silently, leaving the board saying "Running…" forever.

---

## 1. How the pieces fit

```
Board / check-in button ──► Edge Function `run-ai-suggestions` ──► routine fire API
  (edit_scores only)          checks edit_scores, writes an           (per-routine token,
                              ai_runs row, fires the routine          server-side secret)
                                                                              │
Board polls ai_runs ◄── routine marks run done/failed ◄── routine writes check-ins (SQL, via
                                                          the Supabase connector)
```

There is **one routine** for every kind of run. It is fired three ways: the Monday cron, the
1st-of-month cron, and the Edge Function. When fired by the Edge Function it receives a `text`
payload saying what to do; when fired by cron it receives none and works out the month itself.

The routine fire API (experimental) is documented at
<https://platform.claude.com/docs/en/api/claude-code/routines-fire>: `POST
https://api.anthropic.com/v1/claude_code/routines/{routine_id}/fire` with `Authorization: Bearer
<per-routine token>`, `anthropic-version`, and an optional `{"text": "..."}` body (freeform, max
65,536 chars, delivered to the run alongside the saved prompt). It returns the new session's id and
URL. It cannot report whether a run finished — hence `ai_runs` below. Limits: 30 fires per routine
per hour, 100 per account per hour. Every run draws on the owner's Claude subscription, whoever
clicks.

## 2. Data

### 2.1 The AI's copy: `checkins.ai_suggestion`

```sql
alter table public.checkins add column ai_suggestion jsonb;
```

Shape (written only by the routine):

```json
{
  "suggested_at": "2026-10-30T20:45:00Z",
  "run_id": 12,
  "notes": "AI-suggested: ...",
  "answers": { "comm_constructive": 4, "...": 3, "adv_reference_check": null }
}
```

- `answers` holds the 19 columns the routine scores: every answer column **except**
  `fin_rack_rate` and `fin_rate_increased`, which the tool fills from revenue data
  (`2026-10-29-finances-from-revenue-design.md`) and the AI never touches.
- **No save ever writes or clears it.** `useCheckin`'s upsert must not send it, and Confirm must not
  touch it. It changes only when the routine writes a new AI version.
- The routine writes it **on every client it scores, including manually scored clients it was not
  allowed to overwrite** (Claude's call, following "latest"): the person's answers stay, but revert
  would now bring back the newer AI version.
- **Only the routine may change it** (Claude's call, enforced, not just convention): a trigger on
  `checkins` rejects any change to `ai_suggestion` made by the `authenticated` or `anon` roles, since
  the table-wide update grant would otherwise let any scorer overwrite it through the REST API. The
  routine writes through the Supabase connector, which is not those roles. Tested both ways.
- Backfill: none is possible for rows people have already saved (the AI values are gone). For rows
  still suggested, the migration copies the current answers and note into `ai_suggestion`, so revert
  works for them from day one.

### 2.2 Runs: `public.ai_runs`

| column | type | meaning |
|---|---|---|
| `id` | bigint identity | |
| `period` | date | first of the month being scored |
| `client_ids` | bigint[] null | null = every client on the board for `period`; else exactly these |
| `overwrite_client_ids` | bigint[] not null default '{}' | manually scored clients the requester ticked |
| `source` | text | `board`, `checkin`, `schedule` |
| `requested_by` | uuid null | profile id; null for `schedule` |
| `requested_at` | timestamptz default now() | |
| `session_url` | text null | from the fire response; shown to admins for debugging |
| `finished_at` | timestamptz null | set by the routine |
| `status` | text | `requested` → `done` or `failed` (CHECK) |
| `summary` | text null | the routine's one-paragraph result, e.g. "13 written, 1 kept (manually scored)" |

- RLS: `select` for anyone with `view_scores`. **No insert/update policy for app users**; the Edge
  Function writes with the service role, and the routine writes through the Supabase connector.
- A run is **in progress** when `status = 'requested'` and `requested_at > now() - interval '30
  minutes'`. Older `requested` rows are **stale**: treat as failed for display and for the
  one-at-a-time rule (normal runs take 5–10 minutes).

## 3. Edge Function `run-ai-suggestions`

Input (JSON, from the signed-in app): `{ period, client_id? , overwrite_client_ids: number[] }`.

1. Verify the caller's JWT; require `private.has_capability(..., 'edit_scores')` and an active user.
   Otherwise 403.
2. Validate: `period` is a first-of-month date; `client_id`, if present, is a real client;
   `overwrite_client_ids` are all on that month's board (and, for a single-client run, ⊆
   `{client_id}`).
3. One-at-a-time: if **any** run is in progress for the same `period` (whole-month or single-client,
   from any source), return 409 with who started it and when (Claude's call: simplest rule, and it
   caps how fast clicks can spend the owner's Claude usage; a single-client run takes a minute or
   two). Before inserting, mark any **stale** `requested` row for the period `failed`.
4. Insert the `ai_runs` row, then fire the routine with a `text` payload built **only from
   validated ids and dates** (never free text from the request):
   `{"run_id": 12, "period": "2026-10-01", "client_ids": [58] | null, "overwrite_client_ids": [...]}`.
5. Store `session_url` on the row; return the run id.
6. If the fire call fails, mark the row `failed` with the error and return it to the app.

Secrets (`supabase secrets set`): `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN`. The owner generates the
token once in the routine's API-trigger settings at claude.ai/code/routines (shown once; generating
a new one revokes the old). The token never appears in the repo, the bundle, or a migration.

## 4. The routine

Its saved prompt (kept in the routine, **not in this public repo**: it contains the production
project ref and the owner's calibration notes) gains:

- **Inputs.** If the run received a payload, use its `run_id`, `period`, `client_ids` and
  `overwrite_client_ids`. If not (cron), insert its own `ai_runs` row with `source = 'schedule'`;
  on the 1st of a month score the **previous** month and DM the owner on Slack when done; on any
  other day score the **current** month, no DM.
- **One at a time, scheduled runs too** (Claude's call): before writing anything, a cron run checks
  for another run in progress for its month; if there is one it records itself `failed` with summary
  "skipped: another run was in progress" and stops. Every run also re-reads its own `ai_runs` row
  immediately before writing and stops if it is no longer `requested` (it went stale and was marked
  failed), so a run that outlives the 30-minute cutoff cannot race the next one.
- **Writing, per scored client:**
  - Always set `ai_suggestion` to this run's answers and note.
  - No row yet → insert answers, note and `suggested_at = now()`.
  - Row with `suggested_at is not null` → overwrite answers and note, `suggested_at = now()`.
  - Row with `suggested_at is null` (manually scored) → overwrite answers and note and set
    `suggested_at = now()` **only if** the client is in `overwrite_client_ids`; otherwise leave the
    row's answers, note and `suggested_at` alone.
  - Never touch `fin_rack_rate` / `fin_rate_increased`.
  - **Submitted state** (Claude's call: behave like a save): whenever the routine writes a row's
    answers it sets `submitted_at` to now() if the check-in is complete by the same rule `useCheckin`
    uses (every required question answered, Advocacy only when its gate is open) and null otherwise,
    and `submitted_by` to the owner's profile id, as the October run did.
- **Finishing:** set the run's `status`, `finished_at` and `summary`, including on partial failure
  (`failed` with what went wrong). This is what turns "Running…" off.
- Scoring rules and calibration are unchanged from the 2026-10-30 October run.

## 5. Screens

### 5.1 Board: "Run AI suggested scores"

- Shown to `edit_scores` users, for the month the board is showing.
- Click → **step 1, confirm the scope** (owner, 2026-10-30): a confirmation asks whether to run AI
  suggested scores for the entire month for all clients, naming the month and the number of
  clients (e.g. "Run AI suggested scores for all 14 clients in October 2026?"). Two answers:
  - **Yes, all clients** → go to step 2 with every client on the board.
  - **No, let me choose** → a checklist of every client on the board for the month; the person
    ticks the ones to run. Every box starts **ticked** (Claude's call: "all" was the button's
    promise, so choosing means taking clients out). Continuing with none ticked is not allowed.
  - Cancelling at either point runs nothing.
- **Step 2, manual scores:** of the clients chosen, the tool finds the **manually scored** ones: on
  the board for the month, with a check-in whose `suggested_at` is null.
  - None → run straight away.
  - Some → the notice: **"These clients have already been manually scored – overwrite their
    data?"**, one checkbox per client, **all unticked by default** (Claude's call: overwriting is
    the destructive choice), and two buttons: run (overwriting the ticked ones) and cancel.
  - A manually scored client left unticked is still part of the run: its AI copy is refreshed (so
    revert has the latest), but its answers are not touched.
- The run's `client_ids` is null when step 1 was "Yes, all clients", and the chosen ids otherwise.
- While a run for the month is in progress, the button is replaced by a line such as "AI scoring
  running — started by Josh at 2:41pm." The board polls `ai_runs` (about every 30 seconds) and
  reloads the month when the run finishes, then shows the run's `summary` once.
- A stale or failed last run shows "The last AI run didn't finish" and the button comes back.

### 5.2 Check-in: "Run AI score for this client"

- Shown to `edit_scores` users on a client's check-in for a month.
- If this check-in is manually scored → **"This client has already been manually scored – overwrite
  their data?"** with overwrite / cancel. Cancel runs nothing (Claude's call: a run that may not
  write is pointless here).
- If there are unsaved changes, the button is disabled with the same wording pattern Confirm uses
  ("You have unsaved changes…").
- In progress → "AI scoring running…"; on finish the check-in reloads.
- Blocked (409) if any run for that month is in progress, with who started it and when.

### 5.3 Check-in: "Revert to AI suggested scores"

- Shown to `edit_scores` users when the check-in has an `ai_suggestion` **and** is not currently
  suggested (`suggested_at` is null). A suggested check-in already shows the AI's version.
- Click → a confirmation naming the date of the AI version ("Replace the saved scores and note with
  the AI's from Oct 30?"). Then one update: answers and note from `ai_suggestion`,
  `suggested_at = now()`; `fin_rack_rate` / `fin_rate_increased` left as they are.
- **Submitted state** (Claude's call): the revert recomputes `submitted_at` with the same
  completeness rule a save uses (shared code, not a copy) and sets `submitted_by` to the person who
  reverted, exactly as if they had saved those answers.
- Disabled while there are unsaved changes, as Confirm is.
- Afterwards the screen shows the suggestion banner again (Confirm / edit and save).
- Done in the app under the existing `checkins_update_edit_scores` policy, like Confirm — no new
  function needed.

## 6. Constraints

- **The repo is public.** No token, no production or staging project ref, no routine prompt in
  committed files.
- **Rollout order** (as in the suggested-checkins slice): migrate production and verify before the
  bundle that reads the new columns ships; the board must not query `ai_runs` before it exists.
- **Staging first.** A second routine (same prompt, pointed at the staging project) and staging Edge
  Function secrets let the whole flow be rehearsed without touching production scores.
- Every requirement above that can be tested is tested; source-reading and stubbed tests that cannot
  fail are not acceptable evidence (see the repo's prior review history).
- The fire API is experimental; failures surface as a failed run, never as a silent no-op.

## 7. Left to the builder

- Exact component structure, polling mechanism and copy beyond the quoted strings above.
- Whether the manually-scored list is computed in the app or by a view.
- Edge Function framework details and its tests.
- How the routine's prompt is rewritten for the payload (the owner reviews the prompt diff).
- Migration naming, verification queries, and the staging rehearsal steps.
