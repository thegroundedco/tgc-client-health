// run-ai-suggestions: the only path from the app to the AI scoring routine.
// Spec docs/superpowers/specs/2026-10-30-ai-suggestion-runs-design.md §3.
//
// Deliberately thin. This file is in no tsconfig, so `tsc -b` never checks it;
// every decision lives in ./logic.ts, which Vitest imports and tests. What is
// here only reads and writes Supabase, calls the routine, and maps results to
// HTTP responses.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (provided by
// Supabase), ROUTINE_FIRE_URL, ROUTINE_FIRE_TOKEN, AI_RUN_TARGET (secrets).

import { createClient } from 'npm:@supabase/supabase-js@2.112.3'
import {
  FORBIDDEN_ERROR,
  STALE_SUMMARY,
  boardSets,
  conflictBody,
  fireFailure,
  firePayload,
  isPeriod,
  parseTarget,
  sessionUrlFrom,
  staleBefore,
  validateRequest,
} from './logic.ts'

// Auth is a bearer JWT, not a cookie, so a wildcard origin grants nothing.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const fireUrl = Deno.env.get('ROUTINE_FIRE_URL')
  const fireToken = Deno.env.get('ROUTINE_FIRE_TOKEN')
  const target = parseTarget(Deno.env.get('AI_RUN_TARGET'))
  if (!supabaseUrl || !anonKey || !serviceKey || !fireUrl || !fireToken || target === null) {
    return json(500, { error: 'The AI run function is not configured.' })
  }

  // 1. Who is asking, and may they edit scores.
  const authorization = req.headers.get('Authorization') ?? ''
  const jwt = authorization.replace(/^Bearer\s+/i, '')
  if (jwt === '' || jwt === authorization) return json(401, { error: 'Sign in to run AI suggested scores.' })

  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userError } = await asUser.auth.getUser(jwt)
  if (userError || !userData?.user) return json(401, { error: 'Sign in to run AI suggested scores.' })
  const userId = userData.user.id

  const { data: allowed, error: allowedError } = await asUser.rpc('can_run_ai_suggestions')
  if (allowedError) return json(500, { error: allowedError.message })
  if (allowed !== true) return json(403, { error: FORBIDDEN_ERROR })

  // 2. The request, checked against that month's board.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'The request body must be JSON.' })
  }
  const period = typeof body === 'object' && body !== null ? (body as { period?: unknown }).period : undefined
  if (!isPeriod(period)) {
    return json(400, { error: 'period must be the first of a month, as YYYY-MM-01.' })
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const [clientsResult, checkinsResult] = await Promise.all([
    admin.from('clients').select('id, name, status, started_on, ended_on'),
    admin.from('checkins').select('client_id, suggested_at').eq('period', period),
  ])
  if (clientsResult.error) return json(500, { error: clientsResult.error.message })
  if (checkinsResult.error) return json(500, { error: checkinsResult.error.message })

  const validated = validateRequest(body, boardSets(clientsResult.data, period, checkinsResult.data))
  if (!validated.ok) return json(400, { error: validated.error })
  const request = validated.value

  // 3. A 'requested' row older than the stale window will never finish; fail
  // it so it no longer holds the month's one-at-a-time slot.
  const stale = await admin
    .from('ai_runs')
    .update({ status: 'failed', summary: STALE_SUMMARY })
    .eq('period', period)
    .eq('status', 'requested')
    .lt('requested_at', staleBefore(new Date()))
  if (stale.error) return json(500, { error: stale.error.message })

  // 4. The run row. The unique partial index is the one-at-a-time rule.
  const { data: profile } = await admin.from('profiles').select('full_name, email').eq('id', userId).maybeSingle()
  const requestedByName = profile?.full_name ?? profile?.email ?? null

  const inserted = await admin
    .from('ai_runs')
    .insert({
      period,
      client_ids: request.client_ids,
      overwrite_client_ids: request.overwrite_client_ids,
      source: request.source,
      requested_by: userId,
      requested_by_name: requestedByName,
    })
    .select('id')
    .single()
  if (inserted.error) {
    if (inserted.error.code === '23505') {
      const { data: existing } = await admin
        .from('ai_runs')
        .select('requested_by_name, requested_at, source')
        .eq('period', period)
        .eq('status', 'requested')
        .maybeSingle()
      return json(409, conflictBody(existing ?? null))
    }
    return json(500, { error: inserted.error.message })
  }
  const runId: number = inserted.data.id

  // 5. Fire the routine. Its text is built only from validated ids and dates.
  let failure: string | null = null
  let sessionUrl: string | null = null
  try {
    const response = await fetch(fireUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fireToken}`,
        'anthropic-version': '2026-10-21',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: firePayload(runId, request, target) }),
    })
    if (!response.ok) {
      failure = fireFailure(response.status, await response.text().catch(() => ''))
    } else {
      sessionUrl = sessionUrlFrom(await response.json().catch(() => null))
    }
  } catch (error) {
    failure = fireFailure(null, error instanceof Error ? error.message : String(error))
  }

  // 6. A failed fire is a failed run, never a silent no-op.
  if (failure !== null) {
    await admin.from('ai_runs').update({ status: 'failed', summary: failure }).eq('id', runId)
    return json(502, { error: failure })
  }

  if (sessionUrl !== null) {
    await admin.from('ai_runs').update({ session_url: sessionUrl }).eq('id', runId)
  }
  return json(200, { run_id: runId })
})
