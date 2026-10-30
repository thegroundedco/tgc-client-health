import type { Database } from '../types/database'

export type AiRun = Database['public']['Tables']['ai_runs']['Row']

const STALE_AFTER_MS = 30 * 60 * 1000

export function runState(run: AiRun | null, now: Date): 'idle' | 'running' | 'failed' | 'done' {
  if (!run) return 'idle'
  if (run.status === 'done') return 'done'
  if (run.status === 'failed') return 'failed'
  const age = now.getTime() - new Date(run.requested_at).getTime()
  return age > STALE_AFTER_MS ? 'failed' : 'running'
}

export function formatRunTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function runLine(run: AiRun, now: Date): string | null {
  const state = runState(run, now)
  if (state === 'running') {
    const who = run.source === 'schedule' ? 'the schedule' : (run.requested_by_name ?? 'someone')
    return `AI scoring running — started by ${who} at ${formatRunTime(run.requested_at)}.`
  }
  if (state === 'failed') return "The last AI run didn't finish."
  if (state === 'done') return run.summary
  return null
}
