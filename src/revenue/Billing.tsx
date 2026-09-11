import { useState } from 'react'
import type { ReactNode } from 'react'
import { formatPeriod } from '../lib/month'
import { axisLabels, axisTicks, barGeometry, monthRows, monthlyTotals } from './chartMath'
import type { MonthRow, MonthTotal, RevenueRow } from './chartMath'
import { MonthPanel } from './MonthPanel'
import { formatMoney } from './money'
import type { RetentionClient } from './retentionMath'
import { availablePresets, resolveRange } from './rangeMath'
import type { RangePreset } from './rangeMath'
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

// How far the card sits from the cursor, and how much room it needs before it
// has to flip to the other side. A card drawn off the right edge is invisible
// for the most recent months, which are the ones most often read.
// Which mark the pointer is over, or null for the gap between them, the bar
// group's own area, and every keyboard focus -- none of which point at one
// half rather than the other.
type Segment = 'retainer' | 'project' | null

// Read off the element under the pointer rather than held as its own state.
// Two handlers racing -- one on each rect, one on the group -- would leave a
// stale segment whenever the pointer crossed the gap, and label it as
// whichever mark it touched last.
function segmentAt(target: EventTarget | null): Segment {
  if (!(target instanceof Element)) return null
  const value = target.getAttribute('data-segment')
  return value === 'retainer' || value === 'project' ? value : null
}

const CARD_OFFSET = 16
const CARD_ROOM = 240

function totalOf(month: MonthTotal): number {
  return month.retainerCents + month.projectCents
}

// A rise carries its plus sign. formatMoney already signs a fall, and a column
// where only the negatives are marked reads as though the unmarked ones are
// neutral rather than positive.
// Compact, because the axis is for a rough feel and six full digits on every
// gridline crowds the plot into a strip. $125,000 reads as $125k; anything
// under a thousand keeps its exact figure, where "$0.5k" would be worse than
// useless.
function formatAxis(cents: number): string {
  const dollars = cents / 100
  if (dollars === 0) return '$0'
  if (dollars < 1000) return formatMoney(cents)
  return `$${Math.round(dollars / 100) / 10}k`.replace('.0k', 'k')
}

function formatChange(cents: number): string {
  return cents > 0 ? `+${formatMoney(cents)}` : formatMoney(cents)
}

// What the hover card says.
//
// Pointing at ONE mark is a question about that mark, so the other half is
// dropped and the one being pointed at is given the room -- but the month's
// total and its movement always stay, because a segment figure alone says
// nothing about whether the month was good. The owner's shape, 2026-09-11.
//
// The retention RATE is still deliberately absent: it is retainer-only, it is
// noise over one month on this roster, and it cannot carry the sentence that
// makes it defensible. Spec 6e §3.1 has the argument; the panel has the rate.
function describeMonth(
  month: MonthRow,
  totals: readonly MonthTotal[],
  segment: Segment,
): ReactNode {
  if (!month.entered) return <span> · not entered</span>

  // Only when there IS a pair to compare. monthRows returns null where there
  // is not, and a "vs" clause naming a month nobody entered would be the
  // fabrication the whole module refuses.
  let movement = ''
  if (month.changeCents !== null) {
    const index = totals.findIndex((entry) => entry.period === month.period)
    movement = ` · ${formatChange(month.changeCents)} vs ${formatPeriod(totals[index - 1].period)}`
  }
  const context = `${formatMoney(month.totalCents ?? 0)} total${movement}`

  if (segment === null) {
    return (
      <>
        <span>
          {formatMoney(month.retainerCents)} retainer ·{' '}
          {formatMoney(month.projectCents)} project work
        </span>
        <span>{context}</span>
      </>
    )
  }

  const cents = segment === 'retainer' ? month.retainerCents : month.projectCents
  return (
    <>
      <span className={styles.hoverFigure} data-testid="billing-hover-figure">
        {formatMoney(cents)}{' '}
        <span className={styles.hoverWhich}>
          {segment === 'retainer' ? 'retainer' : 'project work'}
        </span>
      </span>
      <span>{context}</span>
    </>
  )
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

  // Where the hover card is drawn, in VIEWPORT coordinates -- the card is
  // position: fixed, so clientX/clientY and getBoundingClientRect agree with
  // it without any scroll arithmetic.
  //
  // `source` is not decoration: a pointer has a position and a Tab key does
  // not. Opened by keyboard the card takes its place from the BAR, or it would
  // appear at wherever the mouse happened to be left, which is nowhere related
  // to what the keyboard is on.
  // Which months the chart draws. 'all' by default: the whole picture is
  // where a reader starts, and every narrowing is a deliberate act from there.
  const [preset, setPreset] = useState<RangePreset>('all')
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)

  const [point, setPoint] = useState<{
    x: number
    y: number
    source: 'pointer' | 'focus'
    segment: Segment
  } | null>(null)

  // The months that actually hold entries, which is what every preset
  // resolves against and what the custom pickers may offer. A range the data
  // cannot fill is not a narrow view, it is an empty one.
  const months = [...new Set(rows.filter((r) => r.period <= currentPeriod).map((r) => r.period))].sort()
  const extent = {
    anchor: months.length > 0 ? months[months.length - 1] : null,
    earliest: months.length > 0 ? months[0] : null,
  }
  const presets = availablePresets(extent)

  const fallback = custom ?? {
    from: extent.earliest ?? currentPeriod,
    to: extent.anchor ?? currentPeriod,
  }
  const range = preset === 'custom' ? fallback : resolveRange(preset, extent)
  const backwards = range !== null && range.from > range.to

  const totals =
    range === null || backwards ? [] : monthlyTotals(rows, range.to, range.from)

  // Rendered above every branch below, including the refusals: a reader who
  // has picked a range that shows nothing must be able to pick another without
  // reloading the page.
  const controls = (
    <div className={styles.controls}>
      <label className="t-caption">
        Range{' '}
        <select
          className={styles.rangeSelect}
          onChange={(event) => setPreset(event.target.value as RangePreset)}
          value={preset}
        >
          {presets.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {/* Only months that hold entries. A picker offering a month with no data
          is a picker that can blank the chart. */}
      {preset === 'custom' && (
        <>
          <label className="t-caption">
            From{' '}
            <select
              className={styles.rangeSelect}
              onChange={(event) => setCustom({ ...fallback, from: event.target.value })}
              value={fallback.from}
            >
              {months.map((month) => (
                <option key={month} value={month}>
                  {formatPeriod(month)}
                </option>
              ))}
            </select>
          </label>
          <label className="t-caption">
            To{' '}
            <select
              className={styles.rangeSelect}
              onChange={(event) => setCustom({ ...fallback, to: event.target.value })}
              value={fallback.to}
            >
              {months.map((month) => (
                <option key={month} value={month}>
                  {formatPeriod(month)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  )

  if (months.length === 0) {
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

  if (totals.length === 0) {
    return (
      <section className={styles.section}>
        <h3 className="t-subhead">Billing</h3>
        {controls}
        <p className="t-body prose" data-testid="billing-range-problem">
          {backwards
            ? 'That range runs backwards: the first month is after the last. Pick a later month to finish on.'
            : 'No revenue has been entered for those months.'}
        </p>
      </section>
    )
  }

  // The axis is derived from the data, then the bars are scaled to IT rather
  // than to the tallest bar. Round figures are the whole point of an axis
  // meant to give a rough feel; scaling to an exact $108,574.50 maximum would
  // put the tallest bar at the top of the plot and leave every label an
  // awkward number.
  const ticks = axisTicks(totals.reduce((max, m) => Math.max(max, totalOf(m)), 0))
  const ceiling = ticks[ticks.length - 1]
  const { bars } = barGeometry(totals, VIEW, ceiling)
  const rangeRetainer = totals.reduce((sum, month) => sum + month.retainerCents, 0)
  const rangeProject = totals.reduce((sum, month) => sum + month.projectCents, 0)
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

  // Placed rather than positioned by CSS alone: only JavaScript knows where
  // the pointer is. The flip is measured against the viewport's own width, so
  // it holds on a phone and on a wide monitor without a breakpoint.
  const flipped = point !== null && point.x > window.innerWidth - CARD_ROOM
  const cardX = point === null ? 0 : flipped ? point.x - CARD_OFFSET : point.x + CARD_OFFSET
  const cardY = point === null ? 0 : point.y + (point.source === 'focus' ? -CARD_OFFSET : CARD_OFFSET)

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

      {controls}

      {/* What the chosen range comes to. The reason the picker exists is to
          ask "what did we bill in that period", and a chart alone answers it
          only by eye. */}
      <p className={`t-score ${styles.rangeTotal}`} data-testid="billing-range-total">
        {formatMoney(rangeRetainer + rangeProject)}
        <span className={`t-caption ${styles.rangeSplit}`}>
          {formatMoney(rangeRetainer)} retainer · {formatMoney(rangeProject)} project work
        </span>
      </p>

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
      <div className={styles.plot}>
        {/* aria-hidden: read aloud, "$0 $25k $50k" between the chart's
            description and the table is noise. The table carries the numbers. */}
        {ceiling > 0 && (
          <span aria-hidden="true" className={styles.yAxis} data-testid="billing-y-axis">
            {ticks.map((value) => (
              <span
                className={`t-caption ${styles.yLabel}`}
                data-testid="billing-y-label"
                key={value}
                style={{ insetBlockEnd: `${(value / ceiling) * 100}%` }}
              >
                {formatAxis(value)}
              </span>
            ))}
          </span>
        )}

      <svg
        aria-label={summary}
        className={styles.chart}
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      >
        {/* Gridlines live INSIDE the svg and the labels beside it do not, and
            that split is forced: preserveAspectRatio="none" stretches the
            horizontal axis, which leaves a horizontal RULE unharmed and would
            stretch every glyph of a <text>. */}
        {ceiling > 0 &&
          ticks.map((value) => (
            <line
              data-testid="billing-gridline"
              key={value}
              stroke="var(--rule-hairline)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              x1="0"
              x2={VIEW.width}
              y1={VIEW.height - (value / ceiling) * VIEW.height}
              y2={VIEW.height - (value / ceiling) * VIEW.height}
            />
          ))}
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
            onBlur={() => {
              setActive(null)
              setPoint(null)
            }}
            onClick={() => toggle(bar.period)}
            onFocus={(event) => {
              setActive(bar.period)
              const box = event.currentTarget.getBoundingClientRect()
              setPoint({ x: box.left + box.width / 2, y: box.top, source: 'focus', segment: null })
            }}
            onKeyDown={(event) => {
              // A native <button> does this for free; an SVG group with a
              // button role has to do it by hand, and Space must not also
              // scroll the page.
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                toggle(bar.period)
              }
            }}
            onMouseEnter={(event) => {
              setActive(bar.period)
              // Placed on ENTER as well as on move. A pointer that comes to
              // rest on a bar without moving again emits no mousemove, and the
              // card would never appear.
              setPoint({
                x: event.clientX,
                y: event.clientY,
                source: 'pointer',
                segment: segmentAt(event.target),
              })
            }}
            onMouseLeave={() => {
              setActive(null)
              setPoint(null)
            }}
            onMouseMove={(event) =>
              setPoint({
                x: event.clientX,
                y: event.clientY,
                source: 'pointer',
                segment: segmentAt(event.target),
              })
            }
            role="button"
            tabIndex={0}
          >
            {/* An unentered month renders NO rect at all -- the gap, drawn. An
                entered zero renders a retainer rect of zero height, which is a
                different thing and must stay distinguishable. */}
            {bar.entered && (
              <>
                <rect
                  data-segment="retainer"
                  fill="var(--chart-retainer)"
                  height={bar.retainerHeight}
                  rx="2"
                  width={bar.width}
                  x={bar.x}
                  y={bar.retainerY}
                />
                {bar.projectHeight > 0 && (
                  <rect
                    data-segment="project"
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
      </div>

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

      {activeMonth !== null && point !== null && (
        /* Fixed to the viewport and pointer-events: none, so the card can never
           sit between the cursor and the bar it describes -- which would make
           it flicker as the pointer entered and left its own tooltip. */
        <p
          className={`t-caption ${styles.hoverCard}`}
          data-flipped={flipped ? 'true' : 'false'}
          data-source={point.source}
          data-testid="billing-tooltip"
          style={{ left: `${cardX}px`, top: `${cardY}px` }}
        >
          <span className={styles.hoverMonth}>{formatPeriod(activeMonth.period)}</span>
          {describeMonth(activeMonth, totals, point.segment)}
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
            <th className={`${styles.figure} ${styles.band} ${styles.bandStart}`} scope="col">
              Total
            </th>
            <th className={`${styles.figure} ${styles.band} ${styles.bandEnd}`} scope="col">
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
              <td className={`${styles.figure} ${styles.band} ${styles.bandStart}`}>
                {month.totalCents === null ? '—' : formatMoney(month.totalCents)}
              </td>
              {/* An em dash, never $0. null here means the comparison could not
                  be made -- no month before this one, or the one before it was
                  never entered -- and $0 would report that absence as a finding
                  of no change. chartMath.monthRows sets the rule. */}
              <td className={`${styles.figure} ${styles.band} ${styles.bandEnd}`}>
                {month.changeCents === null ? '—' : formatChange(month.changeCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
