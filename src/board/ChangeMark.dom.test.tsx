// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChangeArrow, ChangeText } from './ChangeMark'

afterEach(cleanup)

// Colour is never the only signal: the glyph and the sign are in the text, and
// the compact arrow says the whole thing in aria-label and title.
describe('ChangeText', () => {
  it('writes the arrow, the sign and the size', () => {
    render(<ChangeText change={{ direction: 'down', delta: -0.5 }} />)
    const chip = screen.getByTestId('score-change')
    expect(chip.textContent).toBe('▼ −0.50')
    expect(chip.dataset.direction).toBe('down')
  })

  it('carries a class per direction, so each gets its own fill', () => {
    const { rerender } = render(<ChangeText change={{ direction: 'up', delta: 0.33 }} />)
    const up = screen.getByTestId('score-change').className
    rerender(<ChangeText change={{ direction: 'down', delta: -0.33 }} />)
    const down = screen.getByTestId('score-change').className
    rerender(<ChangeText change={{ direction: 'same', delta: 0 }} />)
    const same = screen.getByTestId('score-change').className
    expect(new Set([up, down, same]).size).toBe(3)
  })
})

describe('ChangeArrow', () => {
  it('draws an up triangle, named in words', () => {
    render(<ChangeArrow change={{ direction: 'up', delta: 0.33 }} label="Communication" since="September" />)
    const arrow = screen.getByRole('img', { name: 'Communication up 0.33 from September' })
    expect(arrow.textContent).toBe('▲')
    expect(arrow.getAttribute('title')).toBe('Communication up 0.33 from September')
  })

  it('draws a down triangle, named in words', () => {
    render(<ChangeArrow change={{ direction: 'down', delta: -1 }} label="Delivery" since="September" />)
    const arrow = screen.getByRole('img', { name: 'Delivery down 1.00 from September' })
    expect(arrow.textContent).toBe('▼')
    expect(arrow.getAttribute('title')).toBe('Delivery down 1.00 from September')
  })

  it('draws an equals sign for no change', () => {
    render(<ChangeArrow change={{ direction: 'same', delta: 0 }} label="Growth" since="September" />)
    const arrow = screen.getByRole('img', { name: 'Growth unchanged from September' })
    expect(arrow.textContent).toBe('=')
  })
})
