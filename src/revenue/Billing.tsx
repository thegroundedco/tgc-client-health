import { useState } from 'react'
import { formatPeriod } from '../lib/month'
import { barGeometry, monthlyTotals } from './chartMath'
import type { MonthTotal, RevenueRow } from './chartMath'
import { formatMoney } from './money'
import styles from './Revenue.module.css'

// What we are billing, and whether it is moving. Slice 6d, and the answer to
// the first of the four questions the owner wants this page to answer.
//
// BARS, NEVER A LINE, and the reason is not taste. A line interpolates between
// its points, so across an unentered month it draws a value nobody entered and
// presents the straight line through a hole as data. That is spec 6c §3.3 -- a
// missing row is not a zero -- expressed in pixels, and it is not hypothetical:
// RevenueAdmin deliberately skips a client left blank with no row on file, so
// partly-entered months are an ordinary state here. Bars let the hole be a hole.
//
// The geometry is chartMath's; this file draws rectangles and knows no
// arithmetic beyond formatting.

// A viewBox, not pixels: the SVG scales to its container and the numbers below
// are a coordinate space rather than a size on anybody's screen.
const VIEW = { width: 600, height: 200, gap: 2 }

function totalOf(month: MonthTotal): number {
  return month.retainerCents + month.projectCents
}

export function Billing({
  rows,
  currentPeriod,
}: {
  rows: readonly RevenueRow[]
  currentPeriod: string
}) {
  // Which month's figures the tooltip is showing. Driven by hover AND focus, so
  // it is reachable without a pointer -- a tooltip only a mouse can open is one
  // a keyboard user does not have.
  const [active, setActive] = useState<string | null>(null)

  const totals = monthlyTotals(rows, currentPeriod)

  if (totals.length === 0) {
    return (
      <section className={styles.section}>
        <h3 className="t-subhead">Billing</h3>
        <p className="t-body prose">
          No revenue has been entered yet, so there is nothing to chart. Enter a month on the
          Admin screen and it appears here.
        </p>
      </section>
    )
  }

  const { bars } = barGeometry(totals, VIEW)
  const entered = totals.filter((month) => month.entered)
  const first = entered[0]
  const last = entered[entered.length - 1]

  // Stated in words rather than left to the picture. A chart with no text
  // description is silent to a screen reader, and this sentence is also the
  // thing a test can assert about what the chart claims.
  const summary =
    first === undefined || last === undefined
      ? `Billing by month, ${formatPeriod(totals[0].period)} to ${formatPeriod(currentPeriod)}.`
      : `Billing by month, ${formatPeriod(first.period)} to ${formatPeriod(last.period)}: ` +
        `${formatMoney(totalOf(first))} to ${formatMoney(totalOf(last))}.`

  const activeMonth = totals.find((month) => month.period === active) ?? null

  return (
    <section className={styles.section}>
      <h3 className="t-subhead">Billing</h3>

      {/* Two series, so a legend is compulsory -- identity may never rest on
          colour alone, which is precisely what a colourblind reader cannot
          use. The swatch carries the colour; the text stays in ink. */}
      <p className={`t-caption ${styles.summary}`} data-testid="billing-legend">
        <span className={styles.swatchRetainer} aria-hidden="true" /> Retainer
        {'  '}
        <span className={styles.swatchProject} aria-hidden="true" /> Project work
      </p>

      <svg
        aria-label={summary}
        className={styles.chart}
        role="img"
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      >
        {bars.map((bar) => (
          <g
            data-entered={bar.entered ? 'true' : 'false'}
            data-testid="billing-bar"
            key={bar.period}
            onBlur={() => setActive(null)}
            onFocus={() => setActive(bar.period)}
            onMouseEnter={() => setActive(bar.period)}
            onMouseLeave={() => setActive(null)}
            tabIndex={0}
          >
            {/* An unentered month renders NO rect at all -- the gap, drawn. An
                entered zero renders a retainer rect of zero height, which is a
                different thing and must stay distinguishable. */}
            {bar.entered && (
              <>
                <rect
                  fill="var(--chart-retainer)"
                  height={bar.retainerHeight}
                  rx="2"
                  width={bar.width}
                  x={bar.x}
                  y={bar.retainerY}
                />
                {bar.projectHeight > 0 && (
                  <rect
                    fill="var(--chart-project)"
                    height={bar.projectHeight}
                    rx="2"
                    width={bar.width}
                    x={bar.x}
                    y={bar.projectY}
                  />
                )}
              </>
            )}
          </g>
        ))}
      </svg>

      {activeMonth !== null && (
        <p className={`t-caption ${styles.summary}`} data-testid="billing-tooltip">
          {formatPeriod(activeMonth.period)}
          {activeMonth.entered
            ? ` · ${formatMoney(activeMonth.retainerCents)} retainer · ${formatMoney(activeMonth.projectCents)} project work`
            : ' · not entered'}
        </p>
      )}

      {/* The same numbers as text. Required rather than a courtesy: it is what
          makes the chart readable without sight of it, and what discharges the
          obligation any low-contrast mark would otherwise carry. */}
      <table aria-label="Billing by month" className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Retainer</th>
            <th scope="col">Project work</th>
          </tr>
        </thead>
        <tbody>
          {totals.map((month) => (
            <tr key={month.period}>
              <th scope="row">{formatPeriod(month.period)}</th>
              <td>{month.entered ? formatMoney(month.retainerCents) : 'not entered'}</td>
              <td>{month.entered ? formatMoney(month.projectCents) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
