import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { CHECKIN_COLUMNS } from './cardSummary'
import type { CardCheckin } from './cardSummary'

export type BoardClient = { id: number; name: string }

export type UseBoard = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: BoardClient[]
  checkins: Map<number, CardCheckin>
  submitted: number
  reload: () => void
}

export function useBoard(period: string): UseBoard {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<BoardClient[]>([])
  const [checkins, setCheckins] = useState<Map<number, CardCheckin>>(new Map())

  // `isCancelled` is a parameter, and the flag it closes over belongs to the
  // effect below -- the same shape as useCheckin and useProfile. It cannot be a
  // `let` inside this function: an async function returns a promise, so a
  // cleanup returned from here would never be called and the flag could never
  // become true. That mistake produces a guard that reads as protection and
  // provides none, which is exactly what `scripts/db-which.mjs` did before
  // d8552ea.
  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setStatus('loading')

      // postgrest-js resolves most failures into `error` rather than rejecting,
      // so the catch is defensive. It is here because the failure it guards is
      // invisible: an unobserved rejection leaves status on 'loading' for good,
      // and the person sees a spinner with no message and no retry.
      try {
        const clientResult = await supabase
          .from('clients')
          .select('id, name')
          .eq('status', 'active')
          .order('name')

        if (isCancelled()) return

        if (clientResult.error) {
          // describeError, not .error.message: an empty message is falsy, and
          // the `loadError &&` guard on the screen would miss it and render an
          // empty board over a failed read. See src/lib/errorText.ts.
          setLoadError(describeError(clientResult.error))
          setStatus('error')
          return
        }

        const checkinResult = await supabase
          .from('checkins')
          .select(CHECKIN_COLUMNS)
          .eq('period', period)

        if (isCancelled()) return

        if (checkinResult.error) {
          setLoadError(describeError(checkinResult.error))
          setStatus('error')
          return
        }

        const byClient = new Map<number, CardCheckin>()
        for (const row of checkinResult.data) {
          byClient.set(row.client_id, row)
        }

        // Never write after a failed read: everything below runs only because
        // both queries succeeded.
        setLoadError(null)
        setClients(clientResult.data)
        setCheckins(byClient)
        setStatus('ready')
      } catch (thrown) {
        if (isCancelled()) return
        setLoadError(describeError(thrown))
        setStatus('error')
      }
    },
    [period],
  )

  useEffect(() => {
    // A fresh flag per run: if `load`'s identity changes because `period`
    // changed while this effect is still mounted, the cleanup marks the old
    // run's flag cancelled before the new run's body executes, and the same
    // flag is marked cancelled on unmount. Without it a slow response for the
    // previous period, resolving after a newer request had started, would
    // silently replace the board with another month's totals and nothing on
    // screen would say so.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  // Counted here rather than in the component so the progress line and the
  // card footers cannot disagree: both read submitted_at, from the same rows.
  // Only active clients are counted, because only active clients were read.
  let submitted = 0
  for (const client of clients) {
    if (checkins.get(client.id)?.submitted_at != null) submitted += 1
  }

  // A manual reload has nothing to be cancelled by, so it uses the default.
  return { status, loadError, clients, checkins, submitted, reload: () => void load() }
}
