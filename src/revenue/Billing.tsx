import { useState } from 'react'
import { formatPeriod } from '../lib/month'
import { axisLabels, barGeometry, monthRows, monthlyTotals } from './chartMath'
import type { MonthRow, MonthTotal, RevenueRow } from './chartMath'
import { MonthPanel } from './MonthPanel'
import { formatMoney } from './money'
import type { RetentionClient } from './retentionMath'
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

// A rise carries its plus sign. formatMoney already signs a fall, and a column
// where only the negatives are marked reads as though the unmarked ones are
// neutral rather than positive.
function formatChange(cents: number): string {
  return cents > 0 ? `+${formatMoney(cents)}` : formatMoney(cents)
}

// What the hover says. Retainer, project work, total and the change against
// the month before -- spec 6e §3. The retention RATE is deliberately not here:
// it is retainer-only, it is noise over one month on this roster, and it
// cannot carry the sentence that makes it defensible. §3.1 has the argument;
// the panel has the rate.
function describeMonth(month: MonthRow, totals: readonly MonthTotal[]): string {
  if (!month.entered) return ' · not entered'

  const parts = [
    `${formatMoney(month.retainerCents)} retainer`,
    `${formatMoney(month.projectCents)} project work`,
    `${formatMoney(month.totalCents ?? 0)} total`,
  ]

  // Only when there IS a pair to compare. monthRows returns null where there
  // is not, and a "vs" clause naming a month nobody entered would be the
  // fabrication the whole module refuses.
  if (month.changeCents !== null) {
    const index = totals.findIndex((entry) => entry.period === month.period)
    parts.push(`${formatChange(month.changeCents)} vs ${formatPeriod(totals[index - 1].period)}`)
  }

  return ` · ${parts.join(' · ')}`
}

export function Billing({
  clients,
  rows,
  currentPeriod,
}: {
  clients: readonly RetentionClient[]
  rows: readonly RevenueRow[]
  currentPeriod: string
}) {
  // Which month's figures the tooltip is showing. Driven by hover AND focus, so
  // it is reachable without a pointer -- a tooltip only a mouse can open is one
  // a keyboard user does not have.
  const [active, setActive] = useState<string | null>(null)

  // Which month's panel is open. Separate from `active` deliberately: hovering
  // must not close an open panel, and an open panel must not follow the
  // pointer -- the reader opens August and then runs the pointer along the
  // chart reading tooltips while August stays put.
  const [opened, setOpened] = useState<string | null>(null)

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

  const rowsByMonth = monthRows(totals)
  const activeMonth = rowsByMonth.find((month) => month.period === active) ?? null

  // Clicking the open month closes it; clicking another switches straight to
  // it. Making the reader close one before opening the next would double every
  // click, and comparing two months is the point of the panel.
  function toggle(period: string) {
    setOpened((current) => (current === period ? null : period))
  }

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

      {/* preserveAspectRatio="none" is load-bearing, not tidying. The default
          scales the viewBox UNIFORMLY, so in a container wider than 600px the
          chart renders at 600x200 centred inside it with empty space either
          side -- a chart that silently refuses to widen, which is precisely
          what it looks like. `none` lets the horizontal axis follow the
          container. Nothing distorts that matters: the 2px inter-segment gap
          is vertical, and the rects' 2px corner radius is the only thing that
          stretches. */}
      <svg
        aria-label={summary}
        className={styles.chart}
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      >
        {bars.map((bar) => (
          /* A button, not a focusable <g>. Before slice 6e these were
             tabIndex={0} with no role: reachable by keyboard, announced as
             nothing, and activatable by neither Enter nor Space. Hanging a
             click on that would have made an interaction that exists only for
             a mouse. */
          <g
            aria-expanded={opened === bar.period}
            aria-label={`${formatPeriod(bar.period)}, open breakdown`}
            data-entered={bar.entered ? 'true' : 'false'}
            data-selected={opened === bar.period ? 'true' : 'false'}
            data-testid="billing-bar"
            key={bar.period}
            onBlur={() => setActive(null)}
            onClick={() => toggle(bar.period)}
            onFocus={() => setActive(bar.period)}
            onKeyDown={(event) => {
              // A native <button> does this for free; an SVG group with a
              // button role has to do it by hand, and Space must not also
              // scroll the page.
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                toggle(bar.period)
              }
            }}
            onMouseEnter={() => setActive(bar.period)}
            onMouseLeave={() => setActive(null)}
            role="button"
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

      {/* The months, as HTML beneath the svg rather than <text> inside it.
          The chart is stretched with preserveAspectRatio="none", which would
          stretch glyphs with it. Equal cells, one per bar, is what keeps the
          two aligned -- barGeometry slots the bars evenly across the same
          width, so cell centres and bar centres coincide.

          aria-hidden because "Jul Aug Sep" read aloud with no values attached
          is noise sitting between the chart's own description and the table
          that carries the numbers. */}
      <p aria-hidden="true" className={`t-caption ${styles.axis}`} data-testid="billing-axis">
        {axisLabels(totals).map((label) => (
          <span className={styles.axisLabel} data-testid="billing-axis-label" key={label.period}>
            <span className={styles.axisMonth}>{label.month}</span>
            {label.year !== null && <span className={styles.axisYear}>{label.year}</span>}
          </span>
        ))}
      </p>

      {activeMonth !== null && (
        <p className={`t-caption ${styles.summary}`} data-testid="billing-tooltip">
          {formatPeriod(activeMonth.period)}
          {describeMonth(activeMonth, totals)}
        </p>
      )}

      {/* The panel sits between the chart and the thirteen-month table, so the
          month it describes stays on screen above it. No fetch: every figure
          it shows is already in the props. */}
      {opened !== null && (
        <MonthPanel
          clients={clients}
          onClose={() => setOpened(null)}
          period={opened}
          rows={rows}
        />
      )}

      {/* The same numbers as text. Required rather than a courtesy: it is what
          makes the chart readable without sight of it, and what discharges the
          obligation any low-contrast mark would otherwise carry. */}
      <table aria-label="Billing by month" className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th className={styles.figure} scope="col">
              Retainer
            </th>
            <th className={styles.figure} scope="col">
              Project work
            </th>
            <th className={styles.figure} scope="col">
              Total
            </th>
            <th className={styles.figure} scope="col">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {rowsByMonth.map((month) => (
            <tr key={month.period}>
              <th scope="row">{formatPeriod(month.period)}</th>
              <td className={styles.figure}>
                {month.entered ? formatMoney(month.retainerCents) : 'not entered'}
              </td>
              <td className={styles.figure}>
                {month.entered ? formatMoney(month.projectCents) : '—'}
              </td>
              <td className={styles.figure}>
                {month.totalCents === null ? '—' : formatMoney(month.totalCents)}
              </td>
              {/* An em dash, never $0. null here means the comparison could not
                  be made -- no month before this one, or the one before it was
                  never entered -- and $0 would report that absence as a finding
                  of no change. chartMath.monthRows sets the rule. */}
              <td className={styles.figure}>
                {month.changeCents === null ? '—' : formatChange(month.changeCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
