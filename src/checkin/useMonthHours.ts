import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { hoursFromBudgets } from './hoursFromBudgets'
import type { BudgetRow, HoursResult } from './hoursFromBudgets'

// The viewer's local calendar date, YYYY-MM-DD. Built from the date's parts,
// the way src/lib/month.ts builds periods, never through toISOString: that is
// UTC, and west of UTC it would call the evening of the 31st the 1st of the
// next month, filling an answer for a month that has not ended here.
export function localDay(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// A month's Productive budget hours for one client (spec 2026-11-04 §7). Null
// until ready, and null for good on a failed read or when the viewer may not
// read revenue -- the screen then falls back to the stored fin_hours_applies.
//
// GATED AT THE READ, like useFinanceSuggestion: the three tables are
// select-gated in RLS, and without canRead no request and no query is issued.
//
// The edge function is asked to refetch first, then the tables are read. A
// failed fetch is remembered rather than thrown: the tables may still hold an
// earlier fetch, and that is what is shown. Whether the month was fetched at
// all is the fetch row's to say, not the request's -- the function writes it in
// the same transaction as the budgets, and private.hours_applies decides from
// the same row, so the screen and the score agree. The same row's fetched_at
// is the date month-end is judged against (see asOf below).
//
// `version` is bumped by Try again. The result is tagged with the version it
// was read for, and from the render the version changes in the hook gives null
// until the new read lands, as useFinanceSuggestion does.
export function useMonthHours(
  clientId: number,
  period: string,
  canRead: boolean,
  version = 0,
): HoursResult | null {
  const [result, setResult] = useState<{ version: number; hours: HoursResult } | null>(null)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    if (!canRead) return

    void (async () => {
      try {
        try {
          // The outcome is not read: a failure is reflected by the missing
          // fetch row below, and a success by the row it wrote.
          await supabase.functions.invoke('fetch-productive-hours', { body: { clientId, period } })
        } catch {
          // A rejected invoke is the same as a failed one.
        }
        if (cancelled) return

        const [links, budgets, fetches] = await Promise.all([
          supabase.from('client_productive_projects').select('productive_project_id').eq('client_id', clientId),
          supabase
            .from('client_month_budgets')
            .select('productive_deal_id, name, starts_on, ends_on, budgeted_minutes, worked_minutes')
            .eq('client_id', clientId)
            .eq('period', period),
          supabase.from('client_month_hours_fetch').select('fetched_at').eq('client_id', clientId).eq('period', period),
        ])
        if (cancelled) return
        if (links.error || budgets.error || fetches.error) return

        // The date the stored hours are AS OF, which is what month-end is
        // judged against -- not the date on the viewer's clock. A snapshot
        // taken on the 20th is "hours so far" for good, even when it is read
        // on the 4th of the next month because that day's fetch failed. When
        // the fetch succeeds the row was just written, so this is today. The
        // viewer's local date of fetched_at, as localDay explains. An
        // unparseable timestamp reads as the period's own first day: not
        // finished, so nothing is filled from data of unknown age.
        const row = (fetches.data ?? [])[0] as { fetched_at: string } | undefined
        const fetchedAt = row ? new Date(row.fetched_at) : null
        const asOf =
          fetchedAt !== null && !Number.isNaN(fetchedAt.getTime()) ? localDay(fetchedAt) : period

        setResult({
          version,
          hours: hoursFromBudgets({
            period,
            today: asOf,
            linked: (links.data ?? []).length > 0,
            fetched: row !== undefined,
            budgets: (budgets.data ?? []) as BudgetRow[],
          }),
        })
      } catch {
        // A rejected read is a failed read: stay null.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [clientId, period, canRead, version])

  return result !== null && result.version === version ? result.hours : null
}
