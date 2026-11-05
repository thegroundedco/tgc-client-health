import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import type { RetentionClient } from './retentionMath'
import type { RevenueRow } from './chartMath'

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
// end_reason_code joined in slice 6f-2 for the exclusions control. The cast
// below means the compiler cannot enforce that a column named in the TYPE is
// actually selected -- a missing one arrives as undefined at runtime -- so
// useRetention.dom.test.ts pins this string, the useRevenue pattern.
const ROSTER_COLUMNS = 'id, name, status, started_on, ended_on, end_reason_code'

// BOTH money columns, changed in slice 6d, and the guarantee moved rather than
// weakened.
//
// 6f-1 excluded project_cents HERE, at the query, so retention could not pick it
// up by accident. But the billing chart needs it and reads the same whole table,
// and two hooks would fetch it twice AND could anchor to different latest months
// while both looked authoritative -- the failure Revenue.tsx now avoids by
// owning one read.
//
// So retention's "retainer only" rule moved to the TYPE: `RetentionRow` has no
// project_cents field at all, so `retention()` cannot read one however the rows
// arrive. retentionMath.test.ts proves it behaviourally -- feeding it rows WITH
// project work leaves every rate unchanged -- which is a stronger statement than
// a column missing from a string.
const REVENUE_COLUMNS = 'client_id, period, retainer_cents, project_cents, project_notes'

// The whole line-items table too, for the month panel (brief 2026-11-05 B3).
// Same read gate (view_revenue), same size argument: a few rows a month.
const ITEM_COLUMNS = 'client_id, period, label, cents'

type ItemRow = { client_id: number; period: string; label: string; cents: number }

// Each month's items onto its row, in the order read (position). A row with
// none gets no property at all, so it is exactly the row that was read; an
// item with no revenue row has nowhere to show and is dropped.
function withItems(rows: RevenueRow[], items: ItemRow[]): RevenueRow[] {
  const byMonth = new Map<string, { label: string; cents: number }[]>()
  for (const item of items) {
    const key = `${item.client_id}|${item.period}`
    const list = byMonth.get(key) ?? []
    list.push({ label: item.label, cents: item.cents })
    byMonth.set(key, list)
  }
  return rows.map((row) => {
    const list = byMonth.get(`${row.client_id}|${row.period}`)
    return list ? { ...row, project_items: list } : row
  })
}

export type UseRetention = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: RetentionClient[]
  rows: RevenueRow[]
  reload: () => void
}

export function useRetention(): UseRetention {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<RetentionClient[]>([])
  const [rows, setRows] = useState<RevenueRow[]>([])

  const load = useCallback(async (isCancelled: () => boolean) => {
    setStatus('loading')

    try {
      const rosterQuery = supabase.from('clients').select(ROSTER_COLUMNS).order('name')
      const revenueQuery = supabase
        .from('client_month_revenue')
        .select(REVENUE_COLUMNS)
        .order('period')

      const itemsQuery = supabase
        .from('client_month_project_items')
        .select(ITEM_COLUMNS)
        .order('position')

      const [roster, revenue, items] = await Promise.all([rosterQuery, revenueQuery, itemsQuery])

      if (isCancelled()) return

      // Either failure is an error, and neither falls through to an empty
      // array. An empty roster reads as "no clients"; an empty revenue array
      // reads as a year in which nobody billed anything, which on a retention
      // report is the most alarming possible lie.
      // The items too: a failed read must not show months as having none.
      const failure = roster.error ?? revenue.error ?? items.error
      if (failure) {
        setLoadError(describeError(failure))
        setStatus('error')
        return
      }

      setClients((roster.data ?? []) as RetentionClient[])
      setRows(withItems((revenue.data ?? []) as RevenueRow[], (items.data ?? []) as ItemRow[]))
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
