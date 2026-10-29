import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { financeFromRevenue, stintFor } from './financeFromRevenue'
import type { FinanceSuggestion, RevenueRow, Stint } from './financeFromRevenue'

// The Finances answers worked out from a client's revenue and package history
// (spec 2026-10-29). Null until ready, and null for good on a failed read or
// when the viewer may not read revenue -- the screen then simply suggests
// nothing, which is the same as a question the data cannot answer.
//
// GATED AT THE READ, NOT THE RENDER, as usePackages documents. client_month_revenue
// and client_packages are select-gated in RLS, so a flag that is false issues no
// query at all: hiding rows that were already fetched is not a permission check.
// Packages are optional -- without them the rate change still works, only the
// rack-rate answer is missing.
export function useFinanceSuggestion(
  clientId: number,
  period: string,
  canReadRevenue: boolean,
  canReadPackages: boolean,
): FinanceSuggestion | null {
  const [suggestion, setSuggestion] = useState<FinanceSuggestion | null>(null)

  useEffect(() => {
    let cancelled = false
    const isCancelled = () => cancelled
    setSuggestion(null)
    if (!canReadRevenue) return

    void (async () => {
      try {
        const revenue = await supabase
          .from('client_month_revenue')
          .select('period, retainer_cents, project_cents')
          .eq('client_id', clientId)
          .lte('period', period)
        if (isCancelled()) return
        if (revenue.error) return

        let stints: Stint[] = []
        if (canReadPackages) {
          const packages = await supabase
            .from('client_packages')
            .select('package_code, started_on')
            .eq('client_id', clientId)
          if (isCancelled()) return
          if (packages.error) return
          stints = (packages.data ?? []) as Stint[]
        }

        setSuggestion(
          financeFromRevenue(period, stintFor(stints, period), (revenue.data ?? []) as RevenueRow[]),
        )
      } catch {
        // A rejected promise is a failed read: stay null.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [clientId, period, canReadRevenue, canReadPackages])

  return suggestion
}
