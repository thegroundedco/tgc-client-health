// fetch-productive-hours: reads fixed monthly budgets from Productive and
// writes them through record_month_budgets. Spec 2026-11-04-productive-budget-hours §6.
//
// Thin on purpose, like run-ai-suggestions: in no tsconfig, every decision is
// in ./logic.ts. Two callers:
//   user mode      bearer JWT of someone with view_revenue; body { clientId, period }
//   schedule mode  header x-hours-cron-secret; body { period }; every linked client
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (provided),
// PRODUCTIVE_API_TOKEN, PRODUCTIVE_ORG_ID, HOURS_CRON_SECRET (secrets).

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import { budgetsFromDeals, dealsUrl, isPeriod, redact, safeEqual } from './logic.ts'
import type { StoredBudget } from './logic.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hours-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function secretList(): string[] {
  return [
    Deno.env.get('PRODUCTIVE_API_TOKEN') ?? '',
    Deno.env.get('PRODUCTIVE_ORG_ID') ?? '',
    Deno.env.get('HOURS_CRON_SECRET') ?? '',
  ]
}

class ProductiveError extends Error {}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    return await handle(req)
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error), secretList())
    console.error('fetch-productive-hours: unhandled', message)
    return json(error instanceof ProductiveError ? 502 : 500, { error: message })
  }
})

async function fetchBudgets(projectIds: string[], period: string): Promise<StoredBudget[]> {
  const token = Deno.env.get('PRODUCTIVE_API_TOKEN') ?? ''
  const org = Deno.env.get('PRODUCTIVE_ORG_ID') ?? ''
  const all: StoredBudget[] = []
  let totalPages = 1
  for (let page = 1; page <= totalPages; page++) {
    const response = await fetch(dealsUrl(projectIds, period, page), {
      headers: {
        'X-Auth-Token': token,
        'X-Organization-Id': org,
        'Content-Type': 'application/vnd.api+json',
      },
    })
    if (!response.ok) throw new ProductiveError(`Productive answered ${response.status}.`)
    const body: unknown = await response.json().catch(() => null)
    try {
      all.push(...budgetsFromDeals(body, period))
    } catch (error) {
      throw new ProductiveError(error instanceof Error ? error.message : String(error))
    }
    const pages = (body as { meta?: { total_pages?: unknown } } | null)?.meta?.total_pages
    if (typeof pages === 'number' && Number.isFinite(pages)) totalPages = pages
  }
  return all
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const cronSecret = Deno.env.get('HOURS_CRON_SECRET')
  if (
    !supabaseUrl || !anonKey || !serviceKey || !cronSecret ||
    !Deno.env.get('PRODUCTIVE_API_TOKEN') || !Deno.env.get('PRODUCTIVE_ORG_ID')
  ) {
    return json(500, { error: 'The hours function is not configured.' })
  }

  // 1. Who is asking.
  const cronHeader = req.headers.get('x-hours-cron-secret')
  const scheduleMode = cronHeader !== null
  if (scheduleMode) {
    if (!safeEqual(cronHeader, cronSecret)) return json(401, { error: 'Not allowed.' })
  } else {
    const authorization = req.headers.get('Authorization') ?? ''
    const jwt = authorization.replace(/^Bearer\s+/i, '')
    if (jwt === '' || jwt === authorization) return json(401, { error: 'Sign in to fetch hours.' })
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await asUser.auth.getUser(jwt)
    if (userError || !userData?.user) return json(401, { error: 'Sign in to fetch hours.' })
    const { data: allowed, error: allowedError } = await asUser.rpc('can_view_revenue')
    if (allowedError) return json(500, { error: redact(allowedError.message, secretList()) })
    if (allowed !== true) return json(403, { error: 'You cannot see hours.' })
  }

  // 2. The request.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'The request body must be JSON.' })
  }
  const input = typeof body === 'object' && body !== null ? (body as { clientId?: unknown; period?: unknown }) : {}
  if (!isPeriod(input.period)) {
    return json(400, { error: 'period must be the first of a month, as YYYY-MM-01.' })
  }
  const period = input.period
  if (!scheduleMode && !(typeof input.clientId === 'number' && Number.isInteger(input.clientId) && input.clientId > 0)) {
    return json(400, { error: 'clientId must be a client id.' })
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  let links = admin.from('client_productive_projects').select('client_id, productive_project_id')
  if (!scheduleMode) links = links.eq('client_id', input.clientId as number)
  const linked = await links
  if (linked.error) return json(500, { error: redact(linked.error.message, secretList()) })

  const byClient = new Map<number, string[]>()
  for (const row of linked.data ?? []) {
    byClient.set(row.client_id, [...(byClient.get(row.client_id) ?? []), row.productive_project_id])
  }

  // 3. Fetch and record. Writes only through record_month_budgets.
  async function fetchOne(clientId: number, projectIds: string[]): Promise<void> {
    const budgets = await fetchBudgets(projectIds, period)
    const { error } = await admin.rpc('record_month_budgets', {
      p_client_id: clientId,
      p_period: period,
      p_budgets: budgets,
    })
    if (error) throw new Error(error.message)
  }

  if (!scheduleMode) {
    const projectIds = byClient.get(input.clientId as number)
    if (!projectIds) return json(200, { fetched: false })
    await fetchOne(input.clientId as number, projectIds)
    return json(200, { fetched: true })
  }

  let fetched = 0
  const failed: number[] = []
  for (const [clientId, projectIds] of byClient) {
    try {
      await fetchOne(clientId, projectIds)
      fetched++
    } catch (error) {
      failed.push(clientId)
      console.error('fetch-productive-hours: client failed', clientId, redact(String(error), secretList()))
    }
  }
  return json(200, { fetched, failed })
}
