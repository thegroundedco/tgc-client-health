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

// `status` is read for ONE reason: concentration excludes a paused client with
// no row from the missing count (a paused client is owed no figure, the same way
// the board expects no check-in from one). It is not optional on
// EligibleClient, and the cast below means the compiler cannot enforce that it
// is selected -- `useRevenue.dom.test.ts` pins it instead.
const CLIENT_COLUMNS = 'id, name, status'
const REVENUE_COLUMNS = 'client_id, period, retainer_cents, project_cents'

// The month's project line items, as a total per client. A month with items
// takes its project amount from them (save_month_payment, and the deferred
// guard in 20261105140000_project_items_total_guard.sql), so Revenue entry
// must show that amount read-only and never write it.
const ITEM_COLUMNS = 'client_id, cents'

export type UseRevenue = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: EligibleClient[]
  rows: RevenueRow[]
  // client_id -> the sum of that client's line items this month. A client
  // with no items is absent.
  itemTotals: Record<number, number>
  reload: () => void
}

export function useRevenue(period: string): UseRevenue {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<EligibleClient[]>([])
  const [rows, setRows] = useState<RevenueRow[]>([])
  const [itemTotals, setItemTotals] = useState<Record<number, number>>({})

  const load = useCallback(
    async (isCancelled: () => boolean) => {
      // Back to 'loading' at the TOP, matching useBoard. Without this, `status`
      // stays 'ready' for the whole of a month change while `rows` still holds
      // the PREVIOUS month -- so RevenueAdmin renders last month's amounts in
      // the inputs, last month's missing-count in the caption, under the new
      // month's heading, and leaves Save enabled. A click inside that window
      // builds the upsert with the NEW period and the OLD values and writes one
      // month's revenue into another, silently. The screen looks right the whole
      // time, which is what makes it dangerous.
      setStatus('loading')

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

        const itemsQuery = supabase.from('client_month_project_items').select(ITEM_COLUMNS).eq('period', period)

        const [roster, revenue, items] = await Promise.all([rosterQuery, revenueQuery, itemsQuery])

        if (isCancelled()) return

        // Either failure is an error, and neither falls through to an empty
        // array. An empty roster reads as "no clients"; an empty rows array is
        // indistinguishable from a month nobody has entered, which would make
        // concentration report every client as unaccounted for and present that
        // as a fact about the data.
        // A failed items read is an error too: guessing "no items" would
        // hand back an editable project amount the guard then refuses.
        const failure = roster.error ?? revenue.error ?? items.error
        if (failure) {
          setLoadError(describeError(failure))
          setStatus('error')
          return
        }

        setClients((roster.data ?? []) as EligibleClient[])
        setRows((revenue.data ?? []) as RevenueRow[])
        const totals: Record<number, number> = {}
        for (const item of (items.data ?? []) as { client_id: number; cents: number }[]) {
          totals[item.client_id] = (totals[item.client_id] ?? 0) + item.cents
        }
        setItemTotals(totals)
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
    itemTotals,
    reload: () => void load(() => false),
  }
}
