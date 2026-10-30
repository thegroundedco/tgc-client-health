import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatRunTime, runState, type AiRun } from './runLine'

export type { AiRun }

export type StartBody = {
  period: string
  client_ids: number[] | null
  overwrite_client_ids: number[]
  source: 'board' | 'checkin'
}
export type StartResult = { ok: true } | { ok: false; message: string }

const POLL_MS = 30_000
const GENERIC = "Couldn't start AI scoring. Try again."

async function failureMessage(error: unknown): Promise<string> {
  const res = (error as { context?: unknown } | null)?.context
  if (!(res instanceof Response)) return GENERIC
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    body = {}
  }
  if (res.status === 409) {
    const who =
      body.source === 'schedule'
        ? 'the schedule'
        : typeof body.requested_by_name === 'string' && body.requested_by_name
          ? body.requested_by_name
          : 'someone'
    const at = typeof body.requested_at === 'string' ? ` at ${formatRunTime(body.requested_at)}` : ''
    return `AI scoring is already running for this month — started by ${who}${at}.`
  }
  return typeof body.error === 'string' && body.error ? body.error : GENERIC
}

export function useAiRun(period: string, onFinished: () => void) {
  const [loaded, setLoaded] = useState<{ period: string; run: AiRun | null } | null>(null)
  const [starting, setStarting] = useState(false)
  const onFinishedRef = useRef(onFinished)
  useEffect(() => {
    onFinishedRef.current = onFinished
  })
  const periodRef = useRef(period)
  useEffect(() => {
    periodRef.current = period
  })

  const load = useCallback(async (forPeriod: string) => {
    const { data, error } = await supabase
      .from('ai_runs')
      .select('*')
      .eq('period', forPeriod)
      .order('requested_at', { ascending: false })
      .limit(1)
    if (error || periodRef.current !== forPeriod) return
    setLoaded({ period: forPeriod, run: (data?.[0] as AiRun | undefined) ?? null })
  }, [])

  useEffect(() => {
    void load(period)
  }, [period, load])

  // A run loaded for another month is never shown for this one.
  const run = loaded && loaded.period === period ? loaded.run : null
  const state = runState(run, new Date())

  const prev = useRef(state)
  useEffect(() => {
    const before = { state: prev.current }
    prev.current = state
    if (before.state === 'running' && (state === 'done' || state === 'failed')) {
      onFinishedRef.current()
    }
  }, [state])

  useEffect(() => {
    if (state !== 'running') return
    const id = setInterval(() => void load(period), POLL_MS)
    return () => clearInterval(id)
  }, [state, period, load])

  const start = useCallback(
    async (body: StartBody): Promise<StartResult> => {
      setStarting(true)
      try {
        const { error } = await supabase.functions.invoke('run-ai-suggestions', { body })
        if (error) return { ok: false, message: await failureMessage(error) }
        await load(body.period)
        return { ok: true }
      } catch {
        return { ok: false, message: GENERIC }
      } finally {
        setStarting(false)
      }
    },
    [load],
  )

  return { run, state, start, starting }
}
