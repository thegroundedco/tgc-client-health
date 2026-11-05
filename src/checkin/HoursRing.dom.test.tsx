// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { HoursRing } from './HoursRing'
import { ringPercent } from './hoursFromBudgets'

describe('ringPercent', () => {
  it.each([
    [0, 1200, 0], [600, 1200, 50], [1200, 1200, 100], [1800, 1200, 100], [5, 0, 100],
  ])('%i of %i is %i', (worked, budgeted, percent) => expect(ringPercent(worked, budgeted)).toBe(percent))
})

describe('HoursRing', () => {
  afterEach(cleanup)
  const fill = () => screen.queryByTestId('hours-ring-fill')

  it('is an image with a spoken label', () => {
    render(<HoursRing budgetedMinutes={300} workedMinutes={678} />)
    const ring = screen.getByRole('img', { name: '11:18 of 5:00 budgeted hours' })
    expect(ring.tagName.toLowerCase()).toBe('svg')
  })

  it('fills by worked / budgeted', () => {
    render(<HoursRing budgetedMinutes={1200} workedMinutes={300} />)
    expect(fill()?.getAttribute('stroke-dasharray')).toBe('25 100')
    expect(fill()?.getAttribute('pathLength')).toBe('100')
    expect(screen.getByRole('img').getAttribute('data-over')).toBe('false')
  })

  it('caps at a full ring and switches to the over colour past budget', () => {
    render(<HoursRing budgetedMinutes={300} workedMinutes={678} />)
    expect(fill()?.getAttribute('stroke-dasharray')).toBe('100 100')
    expect(screen.getByRole('img').getAttribute('data-over')).toBe('true')
    expect(fill()?.getAttribute('class')).toMatch(/over/)
  })

  it('is not over at exactly the budget', () => {
    render(<HoursRing budgetedMinutes={300} workedMinutes={300} />)
    expect(screen.getByRole('img').getAttribute('data-over')).toBe('false')
    expect(fill()?.getAttribute('class')).not.toMatch(/over/)
  })

  it('draws no arc at zero worked', () => {
    render(<HoursRing budgetedMinutes={300} workedMinutes={0} />)
    expect(fill()).toBeNull()
  })
})
