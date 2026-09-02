// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeControl } from './ThemeControl'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ThemeControl', () => {
  // A switch rather than the three buttons this replaced. role="switch" carries
  // its own on/off state, so a screen reader announces "Dark mode, switch, on"
  // from one control -- which is what makes a two-position pill legitimate
  // rather than a picture of a control.
  it('is one switch, named for what it turns on', () => {
    render(<ThemeControl preference="light" onChange={vi.fn()} />)
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeTruthy()
    expect(screen.getAllByRole('switch')).toHaveLength(1)
  })

  it('reports dark as on and light as off', () => {
    const { rerender } = render(<ThemeControl preference="dark" onChange={vi.fn()} />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    rerender(<ThemeControl preference="light" onChange={vi.fn()} />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
  })

  it('asks for dark when it is showing light', async () => {
    const onChange = vi.fn()
    render(<ThemeControl preference="light" onChange={onChange} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith('dark')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('asks for light when it is showing dark', async () => {
    const onChange = vi.fn()
    render(<ThemeControl preference="dark" onChange={onChange} />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith('light')
  })

  // A switch must be operable from the keyboard, and a real <button> gets Enter
  // and Space for free. This asserts the element actually IS a button rather
  // than a div wearing the role, which would look identical and be unreachable.
  it('is a real button, so the keyboard works without help', async () => {
    const onChange = vi.fn()
    render(<ThemeControl preference="light" onChange={onChange} />)
    const control = screen.getByRole('switch')
    expect(control.tagName).toBe('BUTTON')
    expect(control.getAttribute('type')).toBe('button')
    control.focus()
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('dark')
  })

  // The sun and moon are decoration: the switch's name and state already say
  // everything. Left exposed they would be announced as stray images inside a
  // control that has just described itself.
  it('hides its icons from the accessibility tree', () => {
    const { container } = render(<ThemeControl preference="light" onChange={vi.fn()} />)
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThan(0)
    for (const svg of svgs) {
      expect(svg.getAttribute('aria-hidden')).toBe('true')
    }
  })
})
