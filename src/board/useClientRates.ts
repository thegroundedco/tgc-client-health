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
          // THE ORDER IS LOAD-BEARING, NOT COSMETIC. Nothing here sorts rows --
          // currentRates compares period strings and does not care what order it
          // is handed them. This exists for the CAP: PostgREST returns at most
          // db-max-rows (1000 on Supabase's default), and past that limit it
          // simply stops, dropping whatever the server had not reached. Without
          // an ORDER BY, "whatever it had not reached" is unspecified, so a
          // client's September row can be the one dropped while their July row
          // survives -- and July then wins "latest" and is shown as the current
          // rate. That is exactly the stale-rate-as-current misstatement
          // rateMath.ts and the fix commit above it exist to refuse, and it
          // would happen in production only, where the table is large enough.
          //
          // Newest first, so truncation drops the OLDEST months. An old month
          // that never arrives makes a client's rate ABSENT at worst, never
          // WRONG -- and absent is a thing this card is allowed to say.
          //
          // 58 clients and a pending 13-month backfill is ~750 rows and grows
          // every month, so this is a cap the roster will reach, not a
          // theoretical one.
          .order('period', { ascending: false })
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
