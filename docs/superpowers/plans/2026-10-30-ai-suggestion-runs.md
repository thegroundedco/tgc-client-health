# AI Suggestion Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anyone with `edit_scores` can start AI scoring for a month (all or chosen clients) or one client from the tool, choose whether manual scores are overwritten, and revert a saved check-in to the AI's latest version.

**Architecture:** `checkins.ai_suggestion` (jsonb, routine-only) keeps the AI's latest version; `public.ai_runs` records each run. A Supabase Edge Function checks the caller can edit scores, records the run and fires the one Claude routine over its HTTP trigger; the routine scores, writes, and marks the run finished. The board and check-in poll `ai_runs` and reload when a run finishes. Revert is a plain app-side update like Confirm.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest + Testing Library (`*.dom.test.ts(x)` start with `// @vitest-environment jsdom`), Supabase (Postgres migration, Edge Function on Deno), Claude routine fire API.

**Spec:** `docs/superpowers/specs/2026-10-30-ai-suggestion-runs-design.md` — read it first. Prior art: `docs/superpowers/specs/2026-10-29-suggested-checkins-design.md` and its plan.

## Global Constraints

- Branch `ai-suggestion-runs`. Run `git branch --show-current` before every commit; stage explicit paths, never `git commit -a`. Trailer: `Co-Authored-By: Claude <model actually running> <noreply@anthropic.com>`.
- **Repo is public:** no token, no project ref (production or staging), no routine prompt in any committed file.
- The AI never writes, and revert never changes, `fin_rack_rate` or `fin_rate_increased`.
- `AI_ANSWER_KEYS` = every key in `ALL_QUESTIONS` except `fin_rack_rate` and `fin_rate_increased` (19 keys).
- Permission everywhere: `edit_scores` (app: `can(profile.role, 'edit_scores')`; database: `private.has_capability('edit_scores')`).
- "In progress" = `status = 'requested' and requested_at > now() - interval '30 minutes'`. Older `requested` rows are stale = failed.
- One run in progress per `period`, whatever its kind or source.
- Exact copy (en dash and em dash as written):
  - Board button `Run AI suggested scores`; scope question `Run AI suggested scores for all {N} clients in {formatPeriod(period)}?` with buttons `Yes, all clients`, `No, let me choose`, `Cancel`; chooser button `Continue` (disabled with none ticked).
  - Overwrite notice `These clients have already been manually scored – overwrite their data?`, buttons `Run`, `Cancel`.
  - Check-in button `Run AI score for this client`; its notice `This client has already been manually scored – overwrite their data?`, buttons `Overwrite`, `Cancel`.
  - Revert button `Revert to AI suggested scores`; confirm `Replace the saved scores and note with the AI's from {Mon D}?`, buttons `Revert`, `Cancel`. `{Mon D}` = `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })` of `ai_suggestion.suggested_at`.
  - Running line `AI scoring running — started by {who} at {time}.` where `{who}` is `requested_by_name`, or `the schedule` for `source = 'schedule'`, and `{time}` = `toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })`.
  - Failed line `The last AI run didn't finish.`
  - Unsaved-changes line for run and revert on the check-in: `You have unsaved changes. Save them first.`
- Popups are an overlay `div` with `role="dialog"`, `aria-modal="true"` and an `aria-labelledby` heading; focus moves to its first button; Escape = Cancel. No `<dialog>` API (jsdom).
- Tests importing anything that reaches `src/lib/supabase` must mock it (`tests/supabaseModuleScope.test.ts`). Live-database tests go in `src/lib/rls.test.ts` style files named `*.live.test.ts`, run against **staging only**, and are excluded from CI the way `rls.test.ts` is.
- A task is done when its tests pass and the full `npx vitest run`, `npx tsc -b` and `npm run lint` are clean; also run CI's command `npx vitest run --exclude '**/rls.test.ts' --exclude '**/*.live.test.ts'` with `.env.local` moved aside.

## Review Focus

1. **Two people click Run for the same month at once.** Exactly one run starts; the other sees who started it. The partial unique index decides, not a read-then-write. Task 1 (index test), Task 3 (409 mapping).
2. **A run dies and never marks itself finished.** After 30 minutes the board stops saying "Running…", shows the failed line, and a new run is allowed (the stale row is marked failed first). Tasks 3 and 4.
3. **A scorer writes `ai_suggestion` through the REST API.** Rejected by the database. Task 1 (live test).
4. **Revert on a check-in with gated Advocacy or partial AI answers.** `submitted_at` follows the same completeness rule as save, so an incomplete AI version is not counted as submitted. Tasks 2 and 6.
5. **The month is changed on the board while a run is going for another month.** The running line belongs to its own month only; the other month's button is usable. Task 4 (hook is keyed by period).

---

### Task 1: Database — `ai_suggestion`, its guard, `ai_runs`, the permission check

**Files:**
- Create: `supabase/migrations/20261031090000_ai_suggestion_runs.sql`
- Modify: `src/types/database.ts` (checkins Row/Insert/Update; new `ai_runs` table; new function)
- Create: `tests/aiRunsMigration.test.ts`, `src/lib/aiRuns.live.test.ts`
- Modify: `vite.config.ts`/CI workflow only if needed so `*.live.test.ts` is excluded in CI exactly like `rls.test.ts`

**Interfaces — Produces:**
- `checkins.ai_suggestion: Json | null`, shape `{ suggested_at: string, run_id: number | null, notes: string, answers: Record<AiAnswerKey, number | null> }`.
- Table `public.ai_runs`: `id bigint identity pk`, `period date not null`, `client_ids bigint[] null`, `overwrite_client_ids bigint[] not null default '{}'`, `source text not null check (source in ('board','checkin','schedule'))`, `requested_by uuid null references public.profiles(id)`, `requested_by_name text null`, `requested_at timestamptz not null default now()`, `session_url text null`, `finished_at timestamptz null`, `status text not null default 'requested' check (status in ('requested','done','failed'))`, `summary text null`.
- Unique partial index `ai_runs_one_requested_per_period on public.ai_runs (period) where status = 'requested'`.
- RLS on `ai_runs`: enabled; one policy `ai_runs_select_view_scores` for `select` to `authenticated` using `private.has_capability('view_scores')`; `grant select on public.ai_runs to authenticated`; no insert/update/delete grant or policy for `anon`/`authenticated`.
- Trigger `checkins_guard_ai_suggestion` (before insert or update on `public.checkins`, function `private.guard_ai_suggestion()`, `security invoker`, `set search_path = ''`): raises `42501` with message `ai_suggestion is written only by the AI routine` when `current_user in ('authenticated','anon')` and (insert with non-null `ai_suggestion`, or update where `new.ai_suggestion is distinct from old.ai_suggestion`).
- `public.can_run_ai_suggestions() returns boolean` = `private.has_capability('edit_scores')`; `security invoker`, `stable`, `set search_path = ''`; execute revoked from public/anon, granted to authenticated.
- Backfill, one statement: for rows with `suggested_at is not null`, set `ai_suggestion` to `jsonb_build_object('suggested_at', suggested_at, 'run_id', null, 'notes', notes, 'answers', jsonb_build_object(<the 19 AI_ANSWER_KEYS, each key => its column>))`. It matches every row with `suggested_at is not null` at apply time (24 on production on 2026-10-30: 11 September + 13 October, fewer if Josh reviews some first); the verification query compares the two counts and they must be equal before the migration is called applied.

- [ ] **Step 1: Write the failing shape test** `tests/aiRunsMigration.test.ts`, using the `migration()`, `withoutComments()` and `statement()` helpers from `tests/suggestedMigration.test.ts` (copy them). Assertions:
  - `statement(sql, /alter table public\.checkins/)` equals `alter table public.checkins add column ai_suggestion jsonb;`
  - the backfill `update public.checkins` statement contains `where suggested_at is not null`, contains each of the 19 keys as `'<key>', <key>`, and contains neither `'fin_rack_rate'` nor `'fin_rate_increased'`
  - exactly one `update public.checkins`
  - the create-index statement equals `create unique index ai_runs_one_requested_per_period on public.ai_runs (period) where status = 'requested';`
  - the guard function body contains `current_user in ('authenticated', 'anon')` and `is distinct from old.ai_suggestion`
  - `withoutComments(sql)` has no `grant insert`, `grant update`, `grant delete` or `grant all` on `ai_runs`
- [ ] **Step 2: Run** `npx vitest run tests/aiRunsMigration.test.ts` — expect FAIL (no migration file).
- [ ] **Step 3: Write the migration** with the objects above, and update `src/types/database.ts` by hand to match (style of the existing blocks).
- [ ] **Step 4: Run the shape test** — expect PASS.
- [ ] **Step 5: Write `src/lib/aiRuns.live.test.ts`** (staging, `rls.test.ts` style, signs in as the staging edit_scores test user from `.env.local`), asserting:
  - updating a checkin's `ai_suggestion` as that user fails with code `42501`; updating its `notes` alone succeeds and leaves `ai_suggestion` unchanged
  - `insert into ai_runs` as that user fails; `select` succeeds
  - `rpc('can_run_ai_suggestions')` returns `true` for the edit_scores user and `false` for the staging viewer user
- [ ] **Step 6: Apply to staging only** (`npm run db:which` must say staging, then `npm run db:push`), run `npx vitest run src/lib/aiRuns.live.test.ts` — expect PASS. Do **not** apply to production (Task 7 does).
- [ ] **Step 7: Commit** migration, types, both tests (and the CI exclude, if changed).

### Task 2: One completeness rule; saves never send `ai_suggestion`

**Files:**
- Modify: `src/lib/scoreV2.ts` (add), `src/checkin/useCheckin.ts:298` (use it)
- Create: `src/checkin/aiSuggestion.ts`
- Test: `src/lib/scoreV2.test.ts`, `src/checkin/aiSuggestion.test.ts`, `src/checkin/useCheckin.dom.test.ts`

**Interfaces — Produces:**
- `isComplete(answers: Answers, advocacyApplies: boolean): boolean` in `scoreV2.ts` — `answeredCount(answers, advocacyApplies) === requiredQuestions(advocacyApplies).length`.
- In `aiSuggestion.ts`: `AI_ANSWER_KEYS: readonly string[]`; `type AiSuggestion = { suggested_at: string; run_id: number | null; notes: string; answers: Answers }`; `parseAiSuggestion(value: unknown): AiSuggestion | null` (null for anything not matching the shape, never throws); `revertedAnswers(current: Answers, ai: AiSuggestion): Answers` (every `AI_ANSWER_KEYS` value from `ai.answers`, absent → null; `fin_rack_rate`/`fin_rate_increased` from `current`).

- [ ] **Step 1: Failing tests:** `isComplete` true at 17 answered with the gate shut and false at 16; true at 21 with it open and false at 20. `AI_ANSWER_KEYS` has length 19 and excludes both finance keys. `parseAiSuggestion` returns null for `null`, `{}`, a missing `answers`, a non-string `notes`. `revertedAnswers` keeps the current finance pair and takes everything else from the AI copy, mapping an absent key to null. In `useCheckin.dom.test.ts`: the upsert payload has no `ai_suggestion` key (assert on the mocked `.upsert` argument).
- [ ] **Step 2: Run them** — expect FAIL.
- [ ] **Step 3: Implement**; make `useCheckin`'s submit call `isComplete` instead of its inline comparison (behaviour unchanged).
- [ ] **Step 4: Run** the three test files and the full suite — expect PASS.
- [ ] **Step 5: Commit.**

### Task 3: Edge Function `run-ai-suggestions`

**Files:**
- Create: `supabase/functions/run-ai-suggestions/logic.ts` (pure: no Deno or network imports), `supabase/functions/run-ai-suggestions/index.ts` (Deno handler)
- Test: `tests/runAiSuggestionsLogic.test.ts`, `tests/runAiBoardParity.test.ts`

**Interfaces — Produces:**
- Request body: `{ period: string, client_ids: number[] | null, overwrite_client_ids: number[], source: 'board' | 'checkin' }`.
- Responses: `200 { run_id }`; `400 { error }` bad input; `401` no/invalid JWT; `403 { error: 'You need permission to edit scores.' }`; `409 { error, requested_by_name, requested_at, source }`; `502 { error }` when the fire call fails (run marked `failed`, its error in `summary`).
- `logic.ts` exports:
  - `validateRequest(body: unknown, board: { members: Set<number>, manual: Set<number> }): { ok: true, value: RunRequest } | { ok: false, error: string }` — period is `YYYY-MM-01`; `client_ids` null or a non-empty subset of `members`; `source: 'checkin'` requires exactly one client id; `overwrite_client_ids ⊆ manual ∩ (client_ids ?? members)`.
  - `isOnBoardFor(...)` — a copy of `src/board/boardScope.ts`'s, same signature.
  - `firePayload(runId: number, request: RunRequest, target: 'production' | 'staging'): string` — `JSON.stringify({ run_id, target, period, client_ids, overwrite_client_ids })`, nothing else.
- `index.ts` flow: read the `Authorization` header → user-scoped client → `rpc('can_run_ai_suggestions')` (false → 403) → service-role client loads clients + the month's checkins, builds `members` (via `isOnBoardFor`) and `manual` (members with a check-in whose `suggested_at` is null) → `validateRequest` → mark this period's stale `requested` rows `failed` (summary `stale: no finish recorded`) → insert the run (`requested_by`, `requested_by_name` from `profiles`) and map unique violation `23505` to 409 with the existing run's details → POST `ROUTINE_FIRE_URL` with `Authorization: Bearer ROUTINE_FIRE_TOKEN`, `anthropic-version: 2026-10-21`, body `{ text: firePayload(...) }` → store `claude_code_session_url` → 200. Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (provided by Supabase), `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN`, `AI_RUN_TARGET` (`production` or `staging`). CORS: allow the app's origin(s) for `POST` and `OPTIONS`.

- [ ] **Step 1: Failing tests** for `validateRequest` (each rule above, accept and reject, including an overwrite id that is not manual and a checkin run with two ids) and `firePayload` (exact key set, ids preserved, no extra fields). `tests/runAiBoardParity.test.ts` runs the logic copy of `isOnBoardFor` and `src/board/boardScope.ts`'s over the same table of cases (paused, future start, ended before month, ended mid-month, has check-in, unknown status) and asserts identical results.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement `logic.ts`**, then `index.ts` per the flow (thin; all decisions in `logic.ts`).
- [ ] **Step 4: Run** the tests and the full suite — expect PASS. `npx tsc -b` must still be clean (exclude `supabase/functions` from the app tsconfig if Deno imports break it; the logic tests still type-check via Vitest).
- [ ] **Step 5: Commit.** (Deploying is Task 7.)

### Task 4: `useAiRun` — the latest run for a month, polling, starting

**Files:**
- Create: `src/ai/useAiRun.ts`, `src/ai/runLine.ts`
- Test: `src/ai/useAiRun.dom.test.ts`, `src/ai/runLine.test.ts`

**Interfaces — Produces:**
- `type AiRun = Database['public']['Tables']['ai_runs']['Row']`
- `runState(run: AiRun | null, now: Date): 'idle' | 'running' | 'failed' | 'done'` (in `runLine.ts`; `requested` older than 30 minutes → `failed`).
- `runLine(run: AiRun, now: Date): string | null` — the running line, the failed line, or `run.summary` for `done`.
- `useAiRun(period: string, onFinished: () => void): { run: AiRun | null, state: ReturnType<typeof runState>, start(body: StartBody): Promise<StartResult>, starting: boolean }` where `StartBody` = the Edge Function request body and `StartResult` = `{ ok: true } | { ok: false, message: string }` (409 message: `AI scoring is already running for this month — started by {who} at {time}.`).
- Loads the period's latest run (`order('requested_at', { ascending: false }).limit(1)`), polls every 30 s while `running`, calls `onFinished` once on a running → done/failed transition, starts via `supabase.functions.invoke('run-ai-suggestions', { body })`, and reloads the run after a successful start.

- [ ] **Step 1: Failing tests:** `runState` for each status and the 30-minute boundary (29:59 running, 30:01 failed); `runLine` exact strings for a board run by `Josh` at 2:41 PM, a schedule run, a stale run, and a done run with summary. Hook (fake timers, mocked supabase): polls only while running; `onFinished` fires exactly once on transition; changing `period` drops the old month's run; a 409 from `functions.invoke` resolves `{ ok: false, message }` with the exact message.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS, full suite clean.
- [ ] **Step 5: Commit.**

### Task 5: Board — "Run AI suggested scores"

**Files:**
- Create: `src/ai/RunMonthButton.tsx`, `src/ai/RunMonthDialog.tsx`, `src/ai/manualScored.ts`
- Modify: `src/board/Board.tsx` (period bar, beside the existing button; show `runLine` under it)
- Test: `src/ai/manualScored.test.ts`, `src/ai/RunMonthDialog.dom.test.tsx`, `src/board/Board.test.tsx` (button visibility)

**Interfaces:**
- Consumes: `useBoard(period)` (`clients`, `checkins`, `members`, `reload`), `useAiRun` (Task 4).
- Produces: `manualScored(members: Set<number>, checkins: Map<number, CardCheckin>): Set<number>` — members with a check-in whose `suggested_at` is null. `RunMonthDialog` props `{ period: string, clients: BoardClient[] /* members only */, manual: Set<number>, onRun(body: StartBody): void, onCancel(): void }`.
- Flow per spec §5.1: scope step (`Yes, all clients` → `client_ids: null`; `No, let me choose` → checklist, all ticked, `Continue` disabled at zero) → overwrite step only if any chosen client is manual (all unticked) → `onRun({ period, client_ids, overwrite_client_ids, source: 'board' })`. `CardCheckin` must include `suggested_at` (it already does since the suggested-checkins slice; verify).
- Button shown only with `can(profile.role, 'edit_scores')`; hidden while `state === 'running'` (the running line shows instead); a failed start shows its message as an `alert`. `onFinished` = `board.reload`.

- [ ] **Step 1: Failing tests:** `manualScored` (suggested row excluded, absent check-in excluded, non-member excluded). Dialog: exact scope question with `N` = members and the formatted month; Yes with no manual clients calls `onRun` with `client_ids: null, overwrite_client_ids: []`; Yes with manual clients shows the exact overwrite notice listing only them, all unticked, and Run passes only the ticked ids; "No, let me choose" lists every member ticked, unticking all disables Continue, unticking one sends the rest as `client_ids`; Cancel at each step calls `onCancel` and never `onRun`; Escape = Cancel. Board: viewer sees no button; edit_scores user does; running line replaces it.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS, full suite clean.
- [ ] **Step 5: Commit.**

### Task 6: Check-in — run for this client, and revert

**Files:**
- Create: `src/ai/RunClientButton.tsx`, `src/checkin/useRevertSuggestion.ts`, `src/checkin/RevertButton.tsx`
- Modify: `src/checkin/CheckIn.tsx` (near `SuggestionBanner`; reload the check-in when a run finishes or a revert succeeds)
- Test: `src/ai/RunClientButton.dom.test.tsx`, `src/checkin/useRevertSuggestion.dom.test.ts`, `src/checkin/RevertButton.dom.test.tsx`

**Interfaces:**
- Consumes: `useAiRun` (Task 4), `parseAiSuggestion`, `revertedAnswers`, `isComplete` (Task 2), `advocacyApplies` (`src/lib/gate.ts`).
- Produces: `useRevertSuggestion(clientId: number, period: string): { state: { kind: 'idle' } | { kind: 'saving' } | { kind: 'reverted' } | { kind: 'failed', message: string }, revert(args: { current: Answers, ai: AiSuggestion, advocacyApplies: boolean }): Promise<void> }` — one update filtered on `client_id` and `period`, setting every `AI_ANSWER_KEYS` column from `revertedAnswers`, `notes = ai.notes`, `suggested_at = now`, `submitted_at = isComplete(merged, advocacyApplies) ? now : null`, `submitted_by` likewise `profile.id` or null; ends `.select('updated_at').maybeSingle()`, null → failed with `UPDATE_MATCHED_NOTHING_TEXT`.
- `RunClientButton` props `{ clientId, period, manual: boolean, hasUnsavedChanges: boolean, onFinished(): void }`: manual → overwrite notice → `Overwrite` starts `{ period, client_ids: [clientId], overwrite_client_ids: [clientId], source: 'checkin' }`, `Cancel` starts nothing; not manual → starts with `overwrite_client_ids: []`; disabled with the unsaved line when `hasUnsavedChanges`; shows the running line while a run for the month is in progress, and the 409 message if refused.
- `RevertButton` shown only when `can(..., 'edit_scores')`, the stored row's `suggested_at` is null, and `parseAiSuggestion(stored.ai_suggestion)` is not null; confirm copy per Global Constraints; disabled with the unsaved line when there are unsaved changes.

- [ ] **Step 1: Failing tests:** revert payload: exact column set (19 AI keys + `notes`, `suggested_at`, `submitted_at`, `submitted_by`; no finance keys, no `ai_suggestion`), both filters, `submitted_at` null when the AI copy is incomplete with the gate open and set when complete with the gate shut; null result → failed. RevertButton: hidden for a suggested row, a row without an AI copy, and a viewer; shows the confirm with the `{Mon D}` of `ai_suggestion.suggested_at`; Cancel does nothing. RunClientButton: manual → notice, Cancel never starts, Overwrite sends the exact body; not manual → sends `overwrite_client_ids: []`; disabled with unsaved changes.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS, full suite clean, `npx tsc -b`, lint, and CI's command with `.env.local` moved aside.
- [ ] **Step 5: Commit.** Then the whole-branch review (strongest model) before Task 7.

### Task 7: Routine, secrets, rehearsal, rollout (controller + Josh, not a subagent)

Done by the session controlling the build, with Josh for the token. Nothing here is committed except the "applied" note in the migration test, if the existing convention adds one.

- [ ] **Routine prompt.** Rewrite the October write-mode prompt (kept outside the repo) for: payload inputs (`run_id`, `target`, `period`, `client_ids`, `overwrite_client_ids`) with `target` choosing the project ref; cron mode when there is no payload (1st → previous month + Slack DM to Josh; other days → current month; insert own `ai_runs` row with `source = 'schedule'`; skip as failed if a run is in progress); re-read its own run row before writing and stop unless `requested`; the spec §4 write rules including `ai_suggestion` on every scored client and `submitted_at`/`submitted_by` by the completeness rule; finish by setting `status`, `finished_at`, `summary`. Show Josh the prompt diff before saving it.
- [ ] **One routine** (`RemoteTrigger` update of a new routine): connectors Supabase, Fathom, Gmail, Slack; model `claude-opus-5-5`; cron `0 14 1 * 1` (14:00 UTC = 8am Denver in MDT, 7am in MST; standard cron ORs day-of-month and day-of-week — confirm `next_run_at` lands on the next Monday **and** the 1st, or split into a second schedule).
- [ ] **Token (Josh):** at claude.ai/code/routines → the routine → Add another trigger → API → Generate token. In the Supabase dashboard for **staging**, Edge Functions → Secrets: `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN`, `AI_RUN_TARGET=staging`. The token is never pasted into chat.
- [ ] **Staging rehearsal:** deploy `run-ai-suggestions` to staging (Supabase MCP `deploy_edge_function`, both files), run the app locally against staging, and check: whole month, chosen clients, an overwrite ticked and unticked, single client, a double click (one 409), a revert, and a viewer seeing no buttons. Verify rows in SQL after each.
- [ ] **Production:** apply the migration and verify the backfill count equals the suggested-row count **before** pushing the bundle; set the same three secrets on production with `AI_RUN_TARGET=production`; deploy the function; push `main`; check the live bundle hash. Then drop `private.checkins_backup_2026_10_30` once Josh confirms October.
