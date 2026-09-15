import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { currentRates } from './rateMath'
import type { ClientRate, RateRow } from './rateMath'

// The board's own narrow revenue read.
//
// NOT useRetention, which reads the same table for a different purpose. Its
// whole-table read is justified by what retention needs, not by what a card
// needs, and a hook named for retention living inside the board is a boundary
// worth more than the file it would save.
//
// GATED AT THE READ, NOT THE RENDER. `enabled` is false for a viewer without
// manage_clients and no query is issued at all -- hiding a figure that was
// already fetched is not a permission check.

export function useClientRates(enabled: boolean): {
  status: 'loading' | 'ready' | 'error'
  rates: Map<number, ClientRate>
} {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    enabled ? 'loading' : 'ready',
  )
  const [rates, setRates] = useState<Map<number, ClientRate>>(new Map())

  const load = useCallback(
    async (isCancelled: () => boolean) => {
      if (!enabled) return
      setStatus('loading')

      // Matching useRevenue's shape: a REJECTED promise (a network failure, not
      // a resolved `{ data, error }`) must not escape this effect as an
      // unhandled rejection. Board.test.tsx and Shell.dom.test.tsx both mock the
      // client, which hid this until a real network fault would have hit it in
      // production -- the same failure mode `try/catch` exists to catch in
      // useRevenue.ts.
      try {
        const { data, error } = await supabase
          .from('client_month_revenue')
          .select('client_id, period, retainer_cents, project_cents')
        if (isCancelled()) return
        if (error) {
          setStatus('error')
          return
        }
        setRates(currentRates((data ?? []) as RateRow[]))
        setStatus('ready')
      } catch {
        if (isCancelled()) return
        setStatus('error')
      }
    },
    [enabled],
  )

  useEffect(() => {
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  return { status, rates }
}
