// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Billing } from './Billing'
import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'
import styles from './Revenue.module.css'

function row(client_id: number, period: string, retainer: number, project = 0): RevenueRow {
  return { client_id, period, retainer_cents: retainer, project_cents: project }
}

const ROWS: RevenueRow[] = [
  row(1, '2026-07-01', 400000, 100000),
  row(1, '2026-08-01', 450000),
  row(1, '2026-09-01', 500000, 50000),
]

const CLIENTS: RetentionClient[] = [
  { id: 1, name: 'Acme', started_on: '2020-01-01', ended_on: null, end_reason_code: null },
]

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Billing', () => {
  it('names itself', () => {
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeTruthy()
  })

  it('draws one bar group per month', () => {
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    expect(screen.getAllByTestId('billing-bar')).toHaveLength(3)
  })

  it('carries a legend, because identity may never be colour alone', () => {
    // The dataviz skill's non-negotiable for two or more series. Without it the
    // only thing distinguishing retainer from project work is a fill, which is
    // exactly what a colourblind reader cannot use.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const legend = screen.getByTestId('billing-legend')
    expect(legend.textContent).toContain('Retainer')
    expect(legend.textContent).toContain('Project work')
  })

  it('offers the same numbers as a table, not only as pixels', () => {
    // Also the skill's requirement, and this project's: a chart that exists
    // only as a picture is unreadable to a screen reader and unassertable in a
    // test. The table is the text path.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const table = screen.getByRole('table', { name: /billing/i })
    expect(table.textContent).toContain('September 2026')
    expect(table.textContent).toContain('$5,000')
    expect(table.textContent).toContain('$500')
  })

  it('describes the chart to a screen reader rather than leaving it silent', () => {
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const figure = screen.getByRole('img', { name: /billing/i })
    expect(figure.getAttribute('aria-label')).toMatch(/July 2026/)
    expect(figure.getAttribute('aria-label')).toMatch(/September 2026/)
  })

  it('shows a month’s figures on hover, and hides them again on leaving', () => {
    // fireEvent, not userEvent.hover: jsdom has no layout, so pointer
    // simulation over an SVG rect resolves to nothing and the assertion below
    // would pass for the wrong reason.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const bars = screen.getAllByTestId('billing-bar')
    expect(screen.queryByTestId('billing-tooltip')).toBeNull()

    fireEvent.mouseEnter(bars[2])
    expect(screen.getByTestId('billing-tooltip').textContent).toContain('September 2026')
    expect(screen.getByTestId('billing-tooltip').textContent).toContain('$5,000')

    fireEvent.mouseLeave(bars[2])
    expect(screen.queryByTestId('billing-tooltip')).toBeNull()
  })

  it('says a month was not entered rather than showing it as zero', () => {
    // The gap, in the tooltip. "$0 retainer" would be a claim about the month;
    // "not entered" is the truth about it.
    render(
      <Billing
        clients={CLIENTS}
        rows={[row(1, '2026-07-01', 400000), row(1, '2026-09-01', 500000)]}
        currentPeriod="2026-09-01"
      />,
    )

    fireEvent.mouseEnter(screen.getAllByTestId('billing-bar')[1])
    const tooltip = screen.getByTestId('billing-tooltip')
    expect(tooltip.textContent).toContain('not entered')
    expect(tooltip.textContent).not.toContain('$0')
  })

  it('shows a month’s figures on KEYBOARD focus, not only on hover', async () => {
    // A tooltip reachable only by pointer is a tooltip a keyboard user does not
    // have. Each bar is focusable and reveals the same panel.
    const user = userEvent.setup()
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    await user.tab()
    const tooltip = screen.getByTestId('billing-tooltip')
    expect(tooltip.textContent).toContain('July 2026')
    expect(tooltip.textContent).toContain('$4,000')
  })

  it('says so when there is nothing to chart, rather than drawing an empty box', () => {
    render(<Billing clients={CLIENTS} rows={[]} currentPeriod="2026-09-01" />)

    expect(screen.queryByTestId('billing-bar')).toBeNull()
    expect(document.body.textContent).toMatch(/no revenue|nothing to chart/i)
  })

  it('draws NO bar for an unentered month but keeps its column', () => {
    // The whole argument for bars over a line, at the render layer. August has
    // no rows: it must occupy its position with nothing drawn, so the year's
    // shape is honest about the hole.
    render(
      <Billing
        clients={CLIENTS}
        rows={[row(1, '2026-07-01', 400000), row(1, '2026-09-01', 500000)]}
        currentPeriod="2026-09-01"
      />,
    )

    const bars = screen.getAllByTestId('billing-bar')
    expect(bars).toHaveLength(3)
    expect(bars[1].getAttribute('data-entered')).toBe('false')
    expect(bars[1].querySelectorAll('rect')).toHaveLength(0)
  })

  it('marks an ENTERED zero month as entered, so it is not read as a gap', () => {
    render(
      <Billing
        clients={CLIENTS}
        rows={[row(1, '2026-08-01', 0, 0), row(1, '2026-09-01', 500000)]}
        currentPeriod="2026-09-01"
      />,
    )

    const bars = screen.getAllByTestId('billing-bar')
    expect(bars[0].getAttribute('data-entered')).toBe('true')
  })

  it('STRETCHES to fill a wide container rather than centring at 600px', () => {
    // The defect that arrives with a wide page. The viewBox is 600x200 and the
    // default preserveAspectRatio scales uniformly, so in a 1150px-wide grid
    // cell the chart would render at 600x200 CENTRED in it -- unchanged, with
    // empty space either side, and looking for all the world like a chart that
    // simply did not widen. `none` is what lets the horizontal axis follow the
    // container. The 2px inter-segment gap is vertical and is unaffected.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const figure = screen.getByRole('img', { name: /billing/i })
    expect(figure.getAttribute('preserveAspectRatio')).toBe('none')
  })

  it('labels the axis with one month under each bar, in order', () => {
    // The owner's ask on 2026-09-10: a chart of thirteen unlabelled bars makes
    // the reader count backwards from the right to work out which month they
    // are looking at.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const labels = screen.getAllByTestId('billing-axis-label')
    expect(labels).toHaveLength(screen.getAllByTestId('billing-bar').length)
    expect(labels.map((node) => node.textContent)).toEqual([
      'Jul2026',
      'Aug',
      'Sep',
    ])
  })

  it('dates the axis once per year rather than thirteen times', () => {
    render(
      <Billing
        clients={CLIENTS}
        rows={[row(1, '2025-12-01', 100000), row(1, '2026-01-01', 100000)]}
        currentPeriod="2026-01-01"
      />,
    )

    expect(
      screen.getAllByTestId('billing-axis-label').map((node) => node.textContent),
    ).toEqual(['Dec2025', 'Jan2026'])
  })

  it('hides the axis row from a screen reader, which has the table', () => {
    // "Jul Aug Sep" read aloud with no values attached is noise between the
    // chart's description and the table that actually carries the numbers.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    expect(screen.getByTestId('billing-axis').getAttribute('aria-hidden')).toBe('true')
  })

  it('gives the axis exactly one cell per bar, so the two cannot drift', () => {
    // The labels are HTML beneath the svg rather than <text> inside it -- the
    // svg is stretched with preserveAspectRatio="none" and would stretch the
    // glyphs with it. Alignment therefore rests on the two having the same
    // number of equal cells, which is worth asserting rather than assuming.
    render(
      <Billing
        clients={CLIENTS}
        rows={[row(1, '2026-07-01', 400000), row(1, '2026-09-01', 500000)]}
        currentPeriod="2026-09-01"
      />,
    )

    expect(screen.getAllByTestId('billing-axis-label')).toHaveLength(3)
  })

  it('totals each month and says how it moved against the one before', () => {
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const table = screen.getByRole('table', { name: /billing/i })
    expect(table.textContent).toContain('Total')
    expect(table.textContent).toContain('Change')
    // July 4,000 + 1,000 = 5,000; August 4,500; September 5,000 + 500 = 5,500.
    expect(table.textContent).toContain('$5,500')
    expect(table.textContent).toContain('-$500')
    expect(table.textContent).toContain('+$1,000')
  })

  it('leaves the first month\'s change blank rather than calling it zero', () => {
    // Nothing precedes it. "$0" would claim it matched a month that is not
    // there.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const first = screen.getByRole('row', { name: /July 2026/ })
    expect(first.textContent).toContain('—')
    expect(first.textContent).not.toContain('$0')
  })

  it('refuses a total or a change for an unentered month', () => {
    render(
      <Billing
        clients={CLIENTS}
        rows={[row(1, '2026-07-01', 400000), row(1, '2026-09-01', 500000)]}
        currentPeriod="2026-09-01"
      />,
    )

    const gap = screen.getByRole('row', { name: /August 2026/ })
    expect(gap.textContent).toContain('not entered')
    expect(gap.textContent).not.toContain('$0')

    // And September, whose predecessor is that gap, cannot report a change
    // either -- reaching back to July would compare two months two apart.
    const after = screen.getByRole('row', { name: /September 2026/ })
    expect(after.textContent).toContain('—')
  })

  it('carries the total and the change in the hover, not only the two halves', () => {
    // The owner's ask, 2026-09-10. Spec 6e §3.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    fireEvent.mouseEnter(screen.getAllByTestId('billing-bar')[2])
    const tooltip = screen.getByTestId('billing-tooltip').textContent ?? ''
    expect(tooltip).toContain('$5,500')
    expect(tooltip).toContain('+$1,000')
  })

  it('leaves the change out of the hover where there is no pair to compare', () => {
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    fireEvent.mouseEnter(screen.getAllByTestId('billing-bar')[0])
    expect(screen.getByTestId('billing-tooltip').textContent).not.toContain('vs')
  })

  // Spec 6e §4.3. They were focusable <g> elements with no role: announced as
  // nothing and not activatable by keyboard. A click turns that from an
  // untidiness into a defect.
  it('makes each bar a button that names its own month', () => {
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const bars = screen.getAllByTestId('billing-bar')
    expect(bars[2].getAttribute('role')).toBe('button')
    expect(bars[2].getAttribute('aria-label')).toContain('September 2026')
    expect(bars[2].getAttribute('aria-expanded')).toBe('false')
  })

  it('opens that month on click', async () => {
    const user = userEvent.setup()
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    await user.click(screen.getAllByTestId('billing-bar')[2])

    expect(screen.getByRole('region', { name: /September 2026 breakdown/ })).toBeTruthy()
    expect(screen.getAllByTestId('billing-bar')[2].getAttribute('aria-expanded')).toBe('true')
  })

  it('opens it from the KEYBOARD too, on Enter and on Space', () => {
    // A drill-down reachable only by pointer is a drill-down a keyboard user
    // does not have.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    fireEvent.keyDown(screen.getAllByTestId('billing-bar')[2], { key: 'Enter' })
    expect(screen.getByRole('region', { name: /September 2026/ })).toBeTruthy()

    fireEvent.keyDown(screen.getAllByTestId('billing-bar')[2], { key: 'Escape' })
    fireEvent.keyDown(screen.getAllByTestId('billing-bar')[1], { key: ' ' })
    expect(screen.getByRole('region', { name: /August 2026/ })).toBeTruthy()
  })

  it('marks the open bar as selected, and not with colour alone', () => {
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    fireEvent.click(screen.getAllByTestId('billing-bar')[2])

    expect(screen.getAllByTestId('billing-bar')[2].getAttribute('data-selected')).toBe('true')
    expect(screen.getAllByTestId('billing-bar')[1].getAttribute('data-selected')).toBe('false')
  })

  it('closes when the same bar is clicked again', async () => {
    const user = userEvent.setup()
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const bar = () => screen.getAllByTestId('billing-bar')[2]
    await user.click(bar())
    await user.click(bar())

    expect(screen.queryByRole('region', { name: /breakdown/ })).toBeNull()
  })

  it('switches straight from one month to another without closing first', async () => {
    // Comparing two months is the point. Making the reader close one before
    // opening the next would double every click.
    const user = userEvent.setup()
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    await user.click(screen.getAllByTestId('billing-bar')[2])
    await user.click(screen.getAllByTestId('billing-bar')[1])

    expect(screen.getByRole('region', { name: /August 2026 breakdown/ })).toBeTruthy()
    expect(screen.queryByRole('region', { name: /September 2026 breakdown/ })).toBeNull()
  })

  it('opens an UNENTERED month too, and says so rather than refusing', () => {
    // Refusing the click would leave the reader tapping a bar that does
    // nothing. The panel is where "nobody entered this" gets explained.
    render(
      <Billing
        clients={CLIENTS}
        rows={[row(1, '2026-07-01', 400000), row(1, '2026-09-01', 500000)]}
        currentPeriod="2026-09-01"
      />,
    )

    fireEvent.click(screen.getAllByTestId('billing-bar')[1])

    expect(screen.getByRole('region', { name: /August 2026/ }).textContent).toMatch(
      /no entries/i,
    )
  })

  it('carries a y axis of round figures, starting at zero', () => {
    // The owner's ask: a rough feel for what each bar is worth. Zero first is
    // not negotiable -- a bar's LENGTH is the quantity, so a truncated
    // baseline makes a small difference look like a large one.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const labels = screen.getAllByTestId('billing-y-label').map((n) => n.textContent)
    expect(labels[0]).toBe('$0')
    expect(labels.length).toBeGreaterThan(2)
    // ROWS tops out at $5,500, so the ceiling is a round figure above it.
    expect(labels[labels.length - 1]).toMatch(/^\$[\d,.]+k?$/)
  })

  it('draws a gridline for every label, so the two cannot drift', () => {
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    expect(screen.getAllByTestId('billing-gridline')).toHaveLength(
      screen.getAllByTestId('billing-y-label').length,
    )
  })

  it('scales the bars to the TOP GRIDLINE, not to the tallest bar', () => {
    // Otherwise the tallest bar touches the top of the plot while the axis
    // says it falls short of the last label -- an axis describing a chart it
    // does not match.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const bars = screen.getAllByTestId('billing-bar')
    const tallest = [...bars[2].querySelectorAll('rect')].reduce(
      (sum, rect) => sum + Number(rect.getAttribute('height')),
      0,
    )
    // The EXACT height, not merely "less than the plot" -- that weaker
    // assertion passed with the ceiling removed, because the inter-segment gap
    // already keeps a full-height bar at 198. It was a test that could not
    // fail, caught by mutating the thing it claimed to check.
    //
    // September is $5,500 against a $6,000 ceiling, in a 200-high plot whose
    // usable height is 198 once the 2px gap is taken: 5500/6000 * 198 = 181.5.
    expect(tallest).toBeCloseTo(181.5, 1)
  })

  it('hides the axis from a screen reader, which has the table', () => {
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    expect(screen.getByTestId('billing-y-axis').getAttribute('aria-hidden')).toBe('true')
  })

  it('draws no axis when there is nothing to scale', () => {
    // Every month entered at zero. A $0-to-$100 axis would imply a scale the
    // data does not have.
    render(
      <Billing
        clients={CLIENTS}
        rows={[row(1, '2026-08-01', 0, 0), row(1, '2026-09-01', 0, 0)]}
        currentPeriod="2026-09-01"
      />,
    )

    expect(screen.queryAllByTestId('billing-gridline')).toHaveLength(0)
  })

  it('follows the cursor rather than sitting below the chart', () => {
    // The owner's ask. A caption parked under the plot makes the reader look
    // away from the bar they are pointing at to read its figures.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const bar = screen.getAllByTestId('billing-bar')[2]
    fireEvent.mouseEnter(bar)
    fireEvent.mouseMove(bar, { clientX: 300, clientY: 200 })

    const tip = screen.getByTestId('billing-tooltip')
    expect(tip.style.left).toBe('316px')
    expect(tip.style.top).toBe('216px')

    fireEvent.mouseMove(bar, { clientX: 420, clientY: 90 })
    expect(screen.getByTestId('billing-tooltip').style.left).toBe('436px')
  })

  it('flips to the other side of the cursor near the right edge', () => {
    // jsdom's viewport is 1024 wide. Without this the card is drawn off-screen
    // for the last months of the year, which are the ones most often read.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const bar = screen.getAllByTestId('billing-bar')[2]
    fireEvent.mouseEnter(bar)
    fireEvent.mouseMove(bar, { clientX: 1000, clientY: 200 })

    const tip = screen.getByTestId('billing-tooltip')
    expect(tip.getAttribute('data-flipped')).toBe('true')
    expect(Number.parseInt(tip.style.left, 10)).toBeLessThan(1000)
  })

  it('positions itself from the BAR when opened by keyboard, not from a cursor', async () => {
    // There is no pointer in a tab. Falling back to the last mouse position --
    // or to nothing -- would put the card somewhere unrelated to the bar the
    // keyboard is on.
    const user = userEvent.setup()
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    await user.tab()

    const tip = screen.getByTestId('billing-tooltip')
    expect(tip.textContent).toContain('July 2026')
    expect(tip.getAttribute('data-source')).toBe('focus')
  })

  // ROWS September: $5,000 retainer, $500 project, $5,500 total, +$1,000 on
  // August. Hovering one segment is a question about THAT segment, so the
  // other figure is noise -- but the month's total and its movement are the
  // context that makes either number mean anything, so they always stay.
  function hoverSegment(barIndex: number, which: number) {
    const bar = screen.getAllByTestId('billing-bar')[barIndex]
    const rect = bar.querySelectorAll('rect')[which]
    fireEvent.mouseEnter(bar, { clientX: 300, clientY: 200 })
    fireEvent.mouseMove(rect, { clientX: 300, clientY: 200 })
    return screen.getByTestId('billing-tooltip')
  }

  it('emphasises the RETAINER and drops the project figure on the lower segment', () => {
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const tip = hoverSegment(2, 0)
    expect(screen.getByTestId('billing-hover-figure').textContent).toContain('$5,000')
    expect(tip.textContent).toContain('retainer')
    expect(tip.textContent).not.toContain('project work')
    expect(tip.textContent).toContain('$5,500')
    expect(tip.textContent).toContain('+$1,000')
  })

  it('emphasises the PROJECT figure and drops the retainer on the upper segment', () => {
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const tip = hoverSegment(2, 1)
    expect(screen.getByTestId('billing-hover-figure').textContent).toContain('$500')
    expect(tip.textContent).toContain('project work')
    expect(tip.textContent).not.toContain('retainer')
    expect(tip.textContent).toContain('$5,500')
    expect(tip.textContent).toContain('+$1,000')
  })

  it('shows both halves when the pointer is on the bar but not on a segment', () => {
    // The 2px gap between the two marks, and the bar group's own area. Reading
    // a stale segment there would label the gap as whichever mark was touched
    // last.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const bar = screen.getAllByTestId('billing-bar')[2]
    fireEvent.mouseEnter(bar, { clientX: 300, clientY: 200 })
    fireEvent.mouseMove(bar, { clientX: 300, clientY: 200 })

    const tip = screen.getByTestId('billing-tooltip')
    expect(tip.textContent).toContain('retainer')
    expect(tip.textContent).toContain('project work')
    expect(screen.queryByTestId('billing-hover-figure')).toBeNull()
  })

  it('shows both halves on KEYBOARD focus, which points at no segment', async () => {
    const user = userEvent.setup()
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    await user.tab()

    const tip = screen.getByTestId('billing-tooltip')
    expect(tip.textContent).toContain('retainer')
    expect(tip.textContent).toContain('project work')
  })

  it('bands the total and change columns, and only those', () => {
    // The owner's ask: the two columns he actually reads should carry weight
    // the four raw figures beside them do not.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const header = screen.getAllByRole('columnheader').map((cell) => ({
      label: cell.textContent,
      banded: cell.className.includes(styles.band),
    }))

    expect(header).toEqual([
      { label: 'Month', banded: false },
      { label: 'Retainer', banded: false },
      { label: 'Project work', banded: false },
      { label: 'Total', banded: true },
      { label: 'Change', banded: true },
    ])
  })

  it('bands the same two cells on every body row', () => {
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const row = screen.getByRole('row', { name: /September 2026/ })
    const banded = [...row.querySelectorAll('td')].map((cell) =>
      cell.className.includes(styles.band),
    )
    expect(banded).toEqual([false, false, true, true])
  })

  it('wears token colours and never a literal', () => {
    // tokens.css is the only file permitted a colour literal, and
    // tests/tokens.test.ts enforces it globally -- this asserts the chart in
    // particular reaches for the validated series tokens rather than inventing
    // a fill inline.
    render(<Billing clients={CLIENTS} rows={ROWS} currentPeriod="2026-09-01" />)

    const markup = document.body.innerHTML
    expect(markup).toContain('var(--chart-retainer)')
    expect(markup).toContain('var(--chart-project)')
    expect(markup).not.toMatch(/#[0-9a-fA-F]{6}/)
  })
})
