// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Billing } from './Billing'
import type { RevenueRow } from './chartMath'

function row(client_id: number, period: string, retainer: number, project = 0): RevenueRow {
  return { client_id, period, retainer_cents: retainer, project_cents: project }
}

const ROWS: RevenueRow[] = [
  row(1, '2026-07-01', 400000, 100000),
  row(1, '2026-08-01', 450000),
  row(1, '2026-09-01', 500000, 50000),
]

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Billing', () => {
  it('names itself', () => {
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeTruthy()
  })

  it('draws one bar group per month', () => {
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

    expect(screen.getAllByTestId('billing-bar')).toHaveLength(3)
  })

  it('carries a legend, because identity may never be colour alone', () => {
    // The dataviz skill's non-negotiable for two or more series. Without it the
    // only thing distinguishing retainer from project work is a fill, which is
    // exactly what a colourblind reader cannot use.
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

    const legend = screen.getByTestId('billing-legend')
    expect(legend.textContent).toContain('Retainer')
    expect(legend.textContent).toContain('Project work')
  })

  it('offers the same numbers as a table, not only as pixels', () => {
    // Also the skill's requirement, and this project's: a chart that exists
    // only as a picture is unreadable to a screen reader and unassertable in a
    // test. The table is the text path.
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

    const table = screen.getByRole('table', { name: /billing/i })
    expect(table.textContent).toContain('September 2026')
    expect(table.textContent).toContain('$5,000')
    expect(table.textContent).toContain('$500')
  })

  it('describes the chart to a screen reader rather than leaving it silent', () => {
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

    const figure = screen.getByRole('img', { name: /billing/i })
    expect(figure.getAttribute('aria-label')).toMatch(/July 2026/)
    expect(figure.getAttribute('aria-label')).toMatch(/September 2026/)
  })

  it('shows a month’s figures on hover, and hides them again on leaving', () => {
    // fireEvent, not userEvent.hover: jsdom has no layout, so pointer
    // simulation over an SVG rect resolves to nothing and the assertion below
    // would pass for the wrong reason.
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

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
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

    await user.tab()
    const tooltip = screen.getByTestId('billing-tooltip')
    expect(tooltip.textContent).toContain('July 2026')
    expect(tooltip.textContent).toContain('$4,000')
  })

  it('says so when there is nothing to chart, rather than drawing an empty box', () => {
    render(<Billing rows={[]} currentPeriod="2026-09-01" />)

    expect(screen.queryByTestId('billing-bar')).toBeNull()
    expect(document.body.textContent).toMatch(/no revenue|nothing to chart/i)
  })

  it('draws NO bar for an unentered month but keeps its column', () => {
    // The whole argument for bars over a line, at the render layer. August has
    // no rows: it must occupy its position with nothing drawn, so the year's
    // shape is honest about the hole.
    render(
      <Billing
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
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

    const figure = screen.getByRole('img', { name: /billing/i })
    expect(figure.getAttribute('preserveAspectRatio')).toBe('none')
  })

  it('labels the axis with one month under each bar, in order', () => {
    // The owner's ask on 2026-09-10: a chart of thirteen unlabelled bars makes
    // the reader count backwards from the right to work out which month they
    // are looking at.
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

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
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

    expect(screen.getByTestId('billing-axis').getAttribute('aria-hidden')).toBe('true')
  })

  it('gives the axis exactly one cell per bar, so the two cannot drift', () => {
    // The labels are HTML beneath the svg rather than <text> inside it -- the
    // svg is stretched with preserveAspectRatio="none" and would stretch the
    // glyphs with it. Alignment therefore rests on the two having the same
    // number of equal cells, which is worth asserting rather than assuming.
    render(
      <Billing
        rows={[row(1, '2026-07-01', 400000), row(1, '2026-09-01', 500000)]}
        currentPeriod="2026-09-01"
      />,
    )

    expect(screen.getAllByTestId('billing-axis-label')).toHaveLength(3)
  })

  it('totals each month and says how it moved against the one before', () => {
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

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
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

    const first = screen.getByRole('row', { name: /July 2026/ })
    expect(first.textContent).toContain('—')
    expect(first.textContent).not.toContain('$0')
  })

  it('refuses a total or a change for an unentered month', () => {
    render(
      <Billing
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

  it('wears token colours and never a literal', () => {
    // tokens.css is the only file permitted a colour literal, and
    // tests/tokens.test.ts enforces it globally -- this asserts the chart in
    // particular reaches for the validated series tokens rather than inventing
    // a fill inline.
    render(<Billing rows={ROWS} currentPeriod="2026-09-01" />)

    const markup = document.body.innerHTML
    expect(markup).toContain('var(--chart-retainer)')
    expect(markup).toContain('var(--chart-project)')
    expect(markup).not.toMatch(/#[0-9a-fA-F]{6}/)
  })
})
