import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import type { RetentionClient, RetentionRow } from './retentionMath'

// The roster and the revenue history, read together. A seam in the same shape
// as useTenure and useRevenue: the screen's fetch has to be mockable.
//
// THE WHOLE TABLE, not two months, and the reason is spec section 3.3: the
// current month is the latest month holding entries, which cannot be known
// without looking at what months exist. At thirteen months and eleven clients
// that is about 143 rows and it stays small for years -- and it hands slice
// 6f-3 its series for free. If it ever outgrows one read the fix is a
// max(period) query first, not a fixed two-month filter.
//
// Its own column lists rather than another module's constants: a report should
// not silently start fetching a column because an editing screen added one.
// The same argument useTenure makes for itself.
const ROSTER_COLUMNS = 'id, name, started_on, ended_on'

// retainer_cents ONLY. Spec section 2: project work is real revenue nobody
// expects to repeat, so it is excluded from retention at the query, where it
// cannot later be picked up by accident.
const REVENUE_COLUMNS = 'client_id, period, retainer_cents'

export type UseRetention = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: RetentionClient[]
  rows: RetentionRow[]
  reload: () => void
}

export function useRetention(): UseRetention {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<RetentionClient[]>([])
  const [rows, setRows] = useState<RetentionRow[]>([])

  const load = useCallback(async (isCancelled: () => boolean) => {
    setStatus('loading')

    try {
      const rosterQuery = supabase.from('clients').select(ROSTER_COLUMNS).order('name')
      const revenueQuery = supabase
        .from('client_month_revenue')
        .select(REVENUE_COLUMNS)
        .order('period')

      const [roster, revenue] = await Promise.all([rosterQuery, revenueQuery])

      if (isCancelled()) return

      // Either failure is an error, and neither falls through to an empty
      // array. An empty roster reads as "no clients"; an empty revenue array
      // reads as a year in which nobody billed anything, which on a retention
      // report is the most alarming possible lie.
      const failure = roster.error ?? revenue.error
      if (failure) {
        setLoadError(describeError(failure))
        setStatus('error')
        return
      }

      setClients((roster.data ?? []) as RetentionClient[])
      setRows((revenue.data ?? []) as RetentionRow[])
      setLoadError(null)
      setStatus('ready')
    } catch (thrown: unknown) {
      if (isCancelled()) return
      setLoadError(describeError(thrown))
      setStatus('error')
    }
  }, [])

  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load, nonce])

  return { status, loadError, clients, rows, reload }
}
