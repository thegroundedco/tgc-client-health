// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RangeControl } from './RangeControl'

const MONTHS = ['2026-07-01', '2026-08-01', '2026-09-01']
const EXTENT = { anchor: '2026-09-01', earliest: '2026-07-01' }

function show(over: Record<string, unknown> = {}) {
  const onPreset = vi.fn()
  const onCustom = vi.fn()
  const onCompare = vi.fn()
  render(
    <RangeControl
      compare="none"
      custom={{ from: '2026-07-01', to: '2026-09-01' }}
      extent={EXTENT}
      months={MONTHS}
      onCompare={onCompare}
      onCustom={onCustom}
      onPreset={onPreset}
      preset="last12"
      {...over}
    />,
  )
  return { onPreset, onCustom, onCompare }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('RangeControl', () => {
  it('offers the presets the data can fill, and reports a choice', async () => {
    const user = userEvent.setup()
    const { onPreset } = show()

    await user.selectOptions(screen.getByRole('combobox', { name: /range/i }), 'last3')

    expect(onPreset).toHaveBeenCalledWith('last3')
  })

  it('leaves out a preset the data cannot fill', () => {
    // Q1 2026 has no rows in this extent, and offering it would blank the
    // chart. A range the data cannot fill is not a narrow view, it is an empty
    // one.
    show()

    const ids = [...screen.getByRole('combobox', { name: /range/i }).querySelectorAll('option')].map(
      (option) => option.value,
    )
    expect(ids).not.toContain('q1')
    expect(ids).toContain('q3')
    expect(ids).toContain('custom')
  })

  it('hides the month pickers until Custom is chosen', () => {
    show()

    expect(screen.queryByRole('combobox', { name: /from/i })).toBeNull()
  })

  it('offers only months that hold entries in the custom pickers', async () => {
    // A picker offering a month with no data is a picker that can blank the
    // chart from a choice that looked legitimate.
    const user = userEvent.setup()
    const { onCustom } = show({ preset: 'custom' })

    const from = screen.getByRole('combobox', { name: /from/i })
    expect([...from.querySelectorAll('option')].map((option) => option.value)).toEqual(MONTHS)

    await user.selectOptions(from, '2026-08-01')
    expect(onCustom).toHaveBeenCalledWith({ from: '2026-08-01', to: '2026-09-01' })
  })

  it('changes only the end when the To picker moves', async () => {
    const user = userEvent.setup()
    const { onCustom } = show({ preset: 'custom' })

    await user.selectOptions(screen.getByRole('combobox', { name: /^to/i }), '2026-08-01')

    expect(onCustom).toHaveBeenCalledWith({ from: '2026-07-01', to: '2026-08-01' })
  })

  // The range governs Billing and Concentration and NOT Retention, Tenure or
  // Churn. Unstated, a reader would take three sections as answers to a
  // question they never asked.
  it('says which sections it governs', () => {
    show()

    expect(screen.getByTestId('range-control').textContent).toMatch(
      /billing and concentration/i,
    )
  })

  it('offers custom alone when nothing has been entered', () => {
    show({ extent: { anchor: null, earliest: null }, months: [] })

    const ids = [...screen.getByRole('combobox', { name: /range/i }).querySelectorAll('option')].map(
      (option) => option.value,
    )
    expect(ids).toEqual(['custom'])
  })
})
