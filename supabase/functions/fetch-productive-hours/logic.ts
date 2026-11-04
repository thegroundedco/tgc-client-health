// Decisions for fetch-productive-hours, with no Deno and no network, so Vitest
// can import this file. Supabase bundles only this folder: nothing here may
// import from src/. Spec 2026-11-04-productive-budget-hours-design.md §1, §6.

// What record_month_budgets takes, one element per fixed monthly budget.
export type StoredBudget = {
  productive_deal_id: string
  productive_project_id: string
  name: string
  starts_on: string
  ends_on: string
  budgeted_minutes: number
  worked_minutes: number
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])-01$/

export function isPeriod(value: unknown): value is string {
  return typeof value === 'string' && PERIOD.test(value)
}

// Last day of the month of a YYYY-MM-01 period. Duplicated from src/lib/month
// because this folder cannot import from src/.
export function lastDayOf(period: string): string {
  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${period.slice(0, 8)}${String(day).padStart(2, '0')}`
}

export function dealsUrl(projectIds: readonly string[], period: string, page: number): string {
  return (
    'https://api.productive.io/api/v2/deals?filter[type]=2' +
    `&filter[project_id]=${projectIds.join(',')}` +
    `&filter[date][gt_eq]=${period}&filter[date][lt_eq]=${lastDayOf(period)}` +
    `&include=project&page[size]=200&page[number]=${page}`
  )
}

// A fixed monthly budget: minutes above zero, an end date, and both dates in
// the period's calendar month. A part-month is still monthly.
export function isFixedMonthly(
  attrs: { budgeted_time: number | null; date: string; end_date: string | null },
  period: string,
): boolean {
  const month = period.slice(0, 7)
  return (
    typeof attrs.budgeted_time === 'number' &&
    attrs.budgeted_time > 0 &&
    typeof attrs.end_date === 'string' &&
    attrs.date.slice(0, 7) === month &&
    attrs.end_date.slice(0, 7) === month
  )
}

// A failure on Productive's side (bad status, unexpected body, foreign deal).
// index.ts maps it to a 502.
export class ProductiveError extends Error {}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

// Fixed monthly deals from one JSON:API page. A null worked_time is 0 worked.
// Anything that is not a deals page throws, so a changed API is a failed fetch
// and never an empty month.
export function budgetsFromDeals(json: unknown, period: string): StoredBudget[] {
  if (!isObject(json) || !Array.isArray(json.data)) throw new Error('Productive returned an unexpected deals response.')
  const out: StoredBudget[] = []
  for (const deal of json.data as unknown[]) {
    if (!isObject(deal) || !isObject(deal.attributes)) throw new Error('Productive returned an unexpected deal.')
    const a = deal.attributes
    // A deal with no date, or with no budgeted_time key at all, means the API
    // changed under us: fail the fetch rather than call the month "no budget".
    // An explicit null budgeted_time is real -- an open-hour deal -- and kept.
    if (typeof a.date !== 'string') throw new ProductiveError('Productive returned a deal with no date.')
    // A missing key reads as undefined, so this one check covers it too.
    if (a.budgeted_time !== null && typeof a.budgeted_time !== 'number') {
      throw new ProductiveError('Productive returned a deal with no budgeted_time, or one that is not a number.')
    }
    const attrs = {
      budgeted_time: a.budgeted_time as number | null,
      date: a.date,
      end_date: typeof a.end_date === 'string' ? a.end_date : null,
    }
    if (!isFixedMonthly(attrs, period)) continue
    const rel = isObject(deal.relationships) ? deal.relationships : {}
    const project = isObject(rel.project) && isObject(rel.project.data) ? rel.project.data.id : undefined
    if (typeof deal.id !== 'string' || typeof project !== 'string') {
      throw new Error('Productive returned a budget with no project.')
    }
    out.push({
      productive_deal_id: deal.id,
      productive_project_id: project,
      name: typeof a.name === 'string' ? a.name : '',
      starts_on: attrs.date,
      ends_on: attrs.end_date as string,
      budgeted_minutes: attrs.budgeted_time as number,
      worked_minutes: typeof a.worked_time === 'number' ? a.worked_time : 0,
    })
  }
  return out
}

export function redact(message: string, secrets: readonly string[]): string {
  let out = message
  for (const secret of secrets) {
    if (secret !== '') out = out.split(secret).join('[redacted]')
  }
  return out
}

// Constant-time string comparison, so the cron secret cannot be probed by timing.
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

// The database function every write goes through. A constant, so a test can
// hold it to the name the migration creates (a misspelt rpc fails only at
// run time, on production).
export const RECORD_RPC = 'record_month_budgets'

export type AuthDecision =
  | { mode: 'schedule' }
  | { mode: 'user'; userId: string }
  | { status: 401 | 403 | 500; error: string }

// Who is asking. A request carrying x-hours-cron-secret is the schedule and
// must match the secret exactly, compared in constant time; there is no
// falling back to user mode. Anything else must be a signed-in user (a Bearer
// JWT the auth server accepts) who can see revenue. canViewRevenue resolves
// to an Error when the rpc fails, which is a 500, not a refusal.
export async function authorize(
  req: { authorization: string | null; cronHeader: string | null },
  deps: {
    cronSecret: string
    getUser: (jwt: string) => Promise<string | null>
    canViewRevenue: () => Promise<boolean | Error>
  },
): Promise<AuthDecision> {
  if (req.cronHeader !== null) {
    if (deps.cronSecret === '' || !safeEqual(req.cronHeader, deps.cronSecret)) {
      return { status: 401, error: 'Not allowed.' }
    }
    return { mode: 'schedule' }
  }
  const authorization = req.authorization ?? ''
  const jwt = authorization.replace(/^Bearer\s+/i, '')
  if (jwt === '' || jwt === authorization) return { status: 401, error: 'Sign in to fetch hours.' }
  const userId = await deps.getUser(jwt)
  if (userId === null) return { status: 401, error: 'Sign in to fetch hours.' }
  const allowed = await deps.canViewRevenue()
  if (allowed instanceof Error) return { status: 500, error: allowed.message }
  if (allowed !== true) return { status: 403, error: 'You cannot see hours.' }
  return { mode: 'user', userId }
}

export type PageResponse = { ok: boolean; status: number; json: () => Promise<unknown> }

// Every fixed monthly budget for the projects, paged to meta.total_pages (one
// page when there is no meta). Throws, and so records nothing, when a page is
// not OK, is not a deals page, or holds a deal from a project we did not ask
// for: record_month_budgets has no ownership check, so a filter Productive
// ignored must never become another client's hours.
export async function fetchAllBudgets(
  fetchPage: (url: string) => Promise<PageResponse>,
  projectIds: readonly string[],
  period: string,
): Promise<StoredBudget[]> {
  const all: StoredBudget[] = []
  let totalPages = 1
  for (let page = 1; page <= totalPages; page++) {
    const response = await fetchPage(dealsUrl(projectIds, period, page))
    if (!response.ok) throw new ProductiveError(`Productive answered ${response.status}.`)
    const body: unknown = await response.json().catch(() => null)
    let rows: StoredBudget[]
    try {
      rows = budgetsFromDeals(body, period)
    } catch (error) {
      throw new ProductiveError(error instanceof Error ? error.message : String(error))
    }
    for (const row of rows) {
      if (!projectIds.includes(row.productive_project_id)) {
        throw new ProductiveError('Productive returned a budget from a project that was not requested.')
      }
    }
    all.push(...rows)
    const pages = isObject(body) && isObject(body.meta) ? body.meta.total_pages : undefined
    if (typeof pages === 'number' && Number.isFinite(pages)) totalPages = pages
  }
  return all
}

// Schedule mode: fetch then record for each client, carrying on past a
// failure. A client whose fetch throws is never recorded.
export async function recordEach(
  entries: Iterable<readonly [number, string[]]>,
  fetchFor: (clientId: number, projectIds: string[]) => Promise<StoredBudget[]>,
  record: (clientId: number, budgets: StoredBudget[]) => Promise<void>,
  onFailure: (clientId: number, error: unknown) => void = () => {},
): Promise<{ fetched: number; failed: number[] }> {
  let fetched = 0
  const failed: number[] = []
  for (const [clientId, projectIds] of entries) {
    try {
      await record(clientId, await fetchFor(clientId, projectIds))
      fetched++
    } catch (error) {
      failed.push(clientId)
      onFailure(clientId, error)
    }
  }
  return { fetched, failed }
}
