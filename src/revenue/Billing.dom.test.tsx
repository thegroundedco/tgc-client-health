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
