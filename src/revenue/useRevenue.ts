import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import type { EligibleClient, RevenueRow } from './revenueMath'

// One month of revenue, plus the roster that month is measured against. A seam,
// in the same shape as useBoard and useTenure: the screen's fetch has to be
// mockable.
//
// TWO reads rather than one joined query, and this is the whole reason the hook
// exists in this shape. A join returns only clients that HAVE a revenue row --
// which discards precisely the information slice 6c is built on, that an
// eligible client with no row is unentered rather than unbilled. The roster has
// to arrive independently for the absence to be visible at all.

const CLIENT_COLUMNS = 'id, name'
const REVENUE_COLUMNS = 'client_id, period, retainer_cents, project_cents'

export type UseRevenue = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: EligibleClient[]
  rows: RevenueRow[]
  reload: () => void
}

export function useRevenue(period: string): UseRevenue {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<EligibleClient[]>([])
  const [rows, setRows] = useState<RevenueRow[]>([])

  const load = useCallback(
    async (isCancelled: () => boolean) => {
      try {
        // Eligible for THIS month: everyone whose ended_on is null or falls on
        // or after the first of it. The boundary is inclusive on purpose -- the
        // one departed client on production ended 2026-08-25 and billed part of
        // August, so August must offer them a row and September must not. Spec
        // section 6.1.
        const rosterQuery = supabase
          .from('clients')
          .select(CLIENT_COLUMNS)
          .or(`ended_on.is.null,ended_on.gte.${period}`)
          .order('name')

        const revenueQuery = supabase
          .from('client_month_revenue')
          .select(REVENUE_COLUMNS)
          .eq('period', period)
          .order('client_id')

        const [roster, revenue] = await Promise.all([rosterQuery, revenueQuery])

        if (isCancelled()) return

        // Either failure is an error, and neither falls through to an empty
        // array. An empty roster reads as "no clients"; an empty rows array is
        // indistinguishable from a month nobody has entered, which would make
        // concentration report every client as unaccounted for and present that
        // as a fact about the data.
        const failure = roster.error ?? revenue.error
        if (failure) {
          setLoadError(describeError(failure))
          setStatus('error')
          return
        }

        setClients((roster.data ?? []) as EligibleClient[])
        setRows((revenue.data ?? []) as RevenueRow[])
        setLoadError(null)
        setStatus('ready')
      } catch (thrown: unknown) {
        if (isCancelled()) return
        setLoadError(describeError(thrown))
        setStatus('error')
      }
    },
    [period],
  )

  useEffect(() => {
    // A fresh flag per run, marked cancelled on unmount, so a slow response
    // cannot resolve into a torn-down tree. `load` depends on `period`, so
    // changing the month re-runs this -- without which the screen would show
    // one month's figures under another month's heading.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  return {
    status,
    loadError,
    clients,
    rows,
    reload: () => void load(() => false),
  }
}
