import { useEffect } from 'react'
import { formatPeriod, previousPeriod } from '../lib/month'
import { monthBreakdown } from './breakdownMath'
import type { RevenueRow } from './chartMath'
import { formatMoney } from './money'
import { retention, retentionBasis } from './retentionMath'
import type { RetentionClient } from './retentionMath'
import styles from './Revenue.module.css'

// A month, opened. Slice 6e: the chart says how tall a bar is, and this says
// what it is made of -- two bars of identical height can have completely
// different compositions behind them, and the chart cannot show that.
//
// No fetch and no loading state, and that is the whole reason this is a panel
// rather than a route. Revenue.tsx already holds the entire revenue table and
// the entire roster (useRetention reads both), so every figure here is in
// memory before the click. A route would re-read data the page is holding and
// would have to render a spinner over numbers that are already present.
//
// Arithmetic lives in breakdownMath and retentionMath. This file formats.

// Whole percentages, rounded once here and never summed afterwards -- the same
// rule Retention and Concentration follow.
function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

export function MonthPanel({
  clients,
  onClose,
  period,
  rows,
}: {
  clients: readonly RetentionClient[]
  onClose: () => void
  period: string
  rows: readonly RevenueRow[]
}) {
  // Escape closes it. A panel that can only be dismissed by finding its button
  // is one a keyboard user has to hunt through to leave.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const month = formatPeriod(period)
  const report = monthBreakdown(clients, rows, period)
  const basePeriod = previousPeriod(period)

  return (
    <section aria-label={`${month} breakdown`} className={styles.panel}>
      <div className={styles.panelHead}>
        <h4 className="t-subhead">{month}</h4>
        <button className="button button--quiet" onClick={onClose} type="button">
          Close
        </button>
      </div>

      {/* The answer first, the workings after. Opening a month is a question
          about its total, and leaving that at the foot of the client list puts
          it behind a scroll -- which is what the owner reported.

          Absent entirely for a month nobody entered: $0 would be a claim about
          the month, and there is no total of nothing. */}
      {report.clients.length > 0 && (
        <p className={`t-score ${styles.panelTotal}`} data-testid="month-panel-total">
          {formatMoney(report.totalCents)}
          <span className={`t-caption ${styles.panelSplit}`}>
            {formatMoney(report.retainerCents)} retainer ·{' '}
            {formatMoney(report.projectCents)} project work
          </span>
        </p>
      )}

      <Rate
        basePeriod={basePeriod}
        clients={clients}
        period={period}
        rows={rows}
      />

      {report.clients.length === 0 ? (
        <p className="t-body prose">
          No entries for {month}. Nobody has recorded what was billed, which is not the same as
          nothing being billed.
        </p>
      ) : (
        <>
          <table aria-label={`${month} by client`} className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th className={styles.figure} scope="col">
                  Retainer
                </th>
                <th className={styles.figure} scope="col">
                  Project work
                </th>
                <th className={styles.figure} scope="col">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {report.clients.map((entry) => (
                <tr key={entry.clientId}>
                  <th data-testid="month-panel-client" scope="row">
                    {entry.name}
                  </th>
                  <td className={styles.figure}>{formatMoney(entry.retainerCents)}</td>
                  <td className={styles.figure}>{formatMoney(entry.projectCents)}</td>
                  <td className={styles.figure}>{formatMoney(entry.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Stated, never drawn as rows of $0. Spec 6e §4.1: a table with a
              gap in it looks unfinished, and that is exactly the pressure that
              fills the gap with a zero and turns "nobody said" into "we billed
              them nothing". */}
          {report.missing > 0 && (
            <p className={`t-caption ${styles.summary}`} data-testid="month-panel-missing">
              {report.missing} {report.missing === 1 ? 'client has' : 'clients have'} no entry
              for {month}, which is not the same as having been billed nothing.
            </p>
          )}
        </>
      )}
    </section>
  )
}

// The rate against the month before, with the sentence that makes it
// defensible. Split out because its two refusals -- no clients, no base month
// -- have to happen before any percentage is computed, and inlining that in
// the panel above would bury the panel's own structure in guards.
function Rate({
  basePeriod,
  clients,
  period,
  rows,
}: {
  basePeriod: string
  clients: readonly RetentionClient[]
  period: string
  rows: readonly RevenueRow[]
}) {
  if (clients.length === 0) return null

  const report = retention(clients, rows, period, basePeriod)

  // Both rates share a denominator and are null together. A percentage here
  // would be invented, which is the thing spec 6c §9 refuses.
  if (report.nrr === null || report.grr === null) {
    return (
      <p className="t-body prose">
        No retention rate for {formatPeriod(period)}: {formatPeriod(basePeriod)} has no entered
        revenue to measure it against.
      </p>
    )
  }

  return (
    <>
      <p className="t-caption" data-testid="month-panel-window">
        against {formatPeriod(basePeriod)}
      </p>
      <p className="t-body" data-testid="month-panel-rate">
        {formatRate(report.nrr)} net · {formatRate(report.grr)} gross
      </p>
      {/* The same sentence the Retention section says, from the same function.
          Two components assembling it separately is two sentences that agree
          today and drift the first time a counter is added. */}
      <p className={`t-caption ${styles.summary}`} data-testid="month-panel-basis">
        {retentionBasis(report, formatPeriod)}
      </p>
    </>
  )
}
