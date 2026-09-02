// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeControl } from './ThemeControl'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ThemeControl', () => {
  it('offers all three states at once', () => {
    render(<ThemeControl preference="system" onChange={vi.fn()} />)
    const group = screen.getByRole('group', { name: 'Theme' })
    expect(group).toBeTruthy()
    expect(screen.getByRole('button', { name: 'System' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Light' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dark' })).toBeTruthy()
  })

  // The reason there are three buttons rather than one that cycles. Board.tsx's
  // view toggle makes the same argument: a control that says what it will
  // BECOME gives no indication of what is currently showing.
  it('says which one is showing, without anybody working it out', () => {
    render(<ThemeControl preference="dark" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'System' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('reports the state that was pressed', async () => {
    const onChange = vi.fn()
    render(<ThemeControl preference="system" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(onChange).toHaveBeenCalledWith('light')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('still reports a press on the state already showing', async () => {
    const onChange = vi.fn()
    render(<ThemeControl preference="dark" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(onChange).toHaveBeenCalledWith('dark')
  })

  // type="button" on every one. These sit inside a header today and could sit
  // inside a form tomorrow, where a bare <button> defaults to type="submit"
  // and would submit it.
  it('never submits a form', () => {
    render(<ThemeControl preference="system" onChange={vi.fn()} />)
    for (const name of ['System', 'Light', 'Dark']) {
      expect(screen.getByRole('button', { name }).getAttribute('type')).toBe('button')
    }
  })
})
