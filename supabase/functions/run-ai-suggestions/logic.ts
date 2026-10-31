// Every decision the run-ai-suggestions Edge Function makes, as plain
// TypeScript. No Deno, no npm: and no network imports: Vitest imports this file
// from tests/, and index.ts (which is in no tsconfig and is not type-checked)
// only moves data between Supabase, the routine and these functions.

export type RunSource = 'board' | 'checkin'
export type RunTarget = 'production' | 'staging'

export type RunRequest = {
  period: string
  client_ids: number[] | null
  overwrite_client_ids: number[]
  source: RunSource
}

export type BoardClient = {
  id: number
  name: string
  status: string
  started_on: string | null
  ended_on: string | null
}

export type Board = { members: ReadonlySet<number>; manual: ReadonlySet<number> }

export type Validated = { ok: true; value: RunRequest } | { ok: false; error: string }

// A run left 'requested' this long has no finish coming (normal runs take 5-10
// minutes). Spec §2.2.
export const STALE_MINUTES = 30
export const STALE_SUMMARY = 'stale: no finish recorded'
export const CONFLICT_ERROR = 'An AI run is already in progress for this month.'
export const FORBIDDEN_ERROR = 'You need permission to edit scores.'

// ---- Copies of the board's rule ------------------------------------------
// The function deploys only its own folder, so it cannot import src/. These
// are copies of src/clients/clientForm.ts CLIENT_STATUSES, src/lib/month.ts
// lastDayOf and src/board/boardScope.ts isOnBoardFor;
// src/board/runAiBoardParity.test.ts runs both over the same table.

export const KNOWN_STATUSES: readonly string[] = ['active', 'paused', 'cancelled', 'former']

export function lastDayOf(period: string): string {
  const [year, month] = period.split('-').map(Number)
  const day = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function isOnBoardFor(client: BoardClient, period: string, hasCheckin: boolean): boolean {
  if (hasCheckin) return true
  if (!KNOWN_STATUSES.includes(client.status)) return false
  if (client.status === 'paused') return false
  if (client.started_on !== null && client.started_on > lastDayOf(period)) return false
  if (client.ended_on !== null && client.ended_on < period) return false
  return true
}

// members: on the board for the period. manual: members whose check-in for the
// period has no suggested_at, i.e. a person scored it. A member with no
// check-in is not manual -- there is nothing of anyone's to overwrite.
export function boardSets(
  clients: readonly BoardClient[],
  period: string,
  checkins: readonly { client_id: number; suggested_at: string | null }[],
): { members: Set<number>; manual: Set<number> } {
  const byClient = new Map(checkins.map((checkin) => [checkin.client_id, checkin]))
  const members = new Set<number>()
  const manual = new Set<number>()
  for (const client of clients) {
    const checkin = byClient.get(client.id)
    if (!isOnBoardFor(client, period, checkin !== undefined)) continue
    members.add(client.id)
    if (checkin !== undefined && checkin.suggested_at === null) manual.add(client.id)
  }
  return { members, manual }
}

// ---- Request validation ----------------------------------------------------

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])-01$/

// Exported so index.ts can refuse a bad period before it queries the month.
export function isPeriod(value: unknown): value is string {
  return typeof value === 'string' && PERIOD.test(value)
}

function idList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  // Numbers only; whether each is a real id is the board-membership check.
  if (!value.every((id) => typeof id === 'number')) return null
  if (new Set(value).size !== value.length) return null
  return [...value] as number[]
}

export function validateRequest(body: unknown, board: Board): Validated {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'The request body must be a JSON object.' }
  }
  const input = body as Record<string, unknown>

  const period = input.period
  if (!isPeriod(period)) {
    return { ok: false, error: 'period must be the first of a month, as YYYY-MM-01.' }
  }

  const source = input.source
  if (source !== 'board' && source !== 'checkin') {
    return { ok: false, error: "source must be 'board' or 'checkin'." }
  }

  // Only an explicit null means every client: a missing key is undefined, which
  // fails the list check below rather than widening the run to the month.
  let clientIds: number[] | null = null
  if (input.client_ids !== null) {
    clientIds = idList(input.client_ids)
    if (clientIds === null) {
      return { ok: false, error: 'client_ids must be null or a list of distinct ids.' }
    }
    if (clientIds.length === 0) {
      return { ok: false, error: 'client_ids must not be empty; send null for every client.' }
    }
    if (!clientIds.every((id) => board.members.has(id))) {
      return { ok: false, error: 'Every client in client_ids must be on the board for that month.' }
    }
  }
  if (source === 'checkin' && (clientIds === null || clientIds.length !== 1)) {
    return { ok: false, error: 'A check-in run must name exactly one client.' }
  }

  const overwrite = idList(input.overwrite_client_ids)
  if (overwrite === null) {
    return { ok: false, error: 'overwrite_client_ids must be a list of distinct ids.' }
  }
  const inScope = (id: number) => (clientIds === null ? board.members.has(id) : clientIds.includes(id))
  if (!overwrite.every((id) => board.manual.has(id) && inScope(id))) {
    return { ok: false, error: 'overwrite_client_ids may only name manually scored clients in this run.' }
  }

  return { ok: true, value: { period, client_ids: clientIds, overwrite_client_ids: overwrite, source } }
}

// ---- The routine ---------------------------------------------------------

// Built field by field from validated values only: nothing the request said
// in free text reaches the routine. Spec §3 step 4.
export function firePayload(runId: number, request: RunRequest, target: RunTarget): string {
  return JSON.stringify({
    run_id: runId,
    target,
    period: request.period,
    client_ids: request.client_ids,
    overwrite_client_ids: request.overwrite_client_ids,
  })
}

export function parseTarget(value: string | undefined): RunTarget | null {
  return value === 'production' || value === 'staging' ? value : null
}

export function sessionUrlFrom(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null
  const url = (response as Record<string, unknown>).claude_code_session_url
  return typeof url === 'string' ? url : null
}

// ---- Runs ------------------------------------------------------------------

export function staleBefore(now: Date): string {
  return new Date(now.getTime() - STALE_MINUTES * 60_000).toISOString()
}

// The row update that marks a run failed. finished_at is set so a failed run
// is never left looking unfinished.
export function failedUpdate(summary: string, now: Date) {
  return { status: 'failed' as const, summary, finished_at: now.toISOString() }
}

export type ConflictBody = {
  error: string
  requested_by_name: string | null
  requested_at: string | null
  source: string | null
}

// The 409. `existing` is null when the insert collided with a run that then
// finished before it could be read back; the shape stays the same either way.
export function conflictBody(
  existing: { requested_by_name: string | null; requested_at: string; source: string } | null,
): ConflictBody {
  return {
    error: CONFLICT_ERROR,
    requested_by_name: existing?.requested_by_name ?? null,
    requested_at: existing?.requested_at ?? null,
    source: existing?.source ?? null,
  }
}

const FIRE_DETAIL_LIMIT = 500

// Every non-empty secret, as literal text, replaced with [redacted]. A fetch
// transport error's message contains the URL it was sending to, and ai_runs.summary
// is readable by every view_scores user, so the routine URL and token must never
// reach it. split/join, not a RegExp: a URL is full of pattern characters.
export function redact(detail: string, secrets: readonly string[]): string {
  let out = detail
  for (const secret of secrets) {
    if (secret !== '') out = out.split(secret).join('[redacted]')
  }
  return out
}

// The summary stored on a run whose fire call failed, and the 502's error.
// status is null for a network failure, which never got a response. Redacted
// BEFORE truncating, so a secret straddling the cut cannot leave a prefix.
export function fireFailure(status: number | null, detail: string, secrets: readonly string[]): string {
  const head = status === null ? 'Routine fire failed' : `Routine fire failed: HTTP ${status}`
  return `${head}: ${redact(detail, secrets).slice(0, FIRE_DETAIL_LIMIT)}`
}

// The 502's error. When the run could not be marked failed it is still
// 'requested' and will hold the month until it goes stale; the app says so.
export function failedFireError(failure: string, markedFailed: boolean): string {
  return markedFailed ? failure : `${failure}, and the run could not be marked failed.`
}
