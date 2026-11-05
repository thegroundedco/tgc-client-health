// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FOCUS_MAX } from './bucketNotes'
import { FocusBox } from './FocusBox'

afterEach(cleanup)

function setup(over: { value?: string; lastFocus?: string | null; disabled?: boolean } = {}) {
  const onChange = vi.fn()
  const view = render(
    <FocusBox
      disabled={over.disabled ?? false}
      lastFocus={over.lastFocus ?? null}
      onChange={onChange}
      value={over.value ?? ''}
    />,
  )
  return { onChange, view }
}

const box = () => screen.getByLabelText("This month's focus") as HTMLTextAreaElement
const HINT = "The one or two things we'll work on with this client this month."

describe('FocusBox', () => {
  it('is headed with the exact copy, and the heading labels the textarea', () => {
    setup()
    const heading = screen.getByRole('heading', { name: "This month's focus" })
    expect(heading.textContent).toBe("This month's focus")
    expect(box().tagName).toBe('TEXTAREA')
  })

  it('clicking the heading focuses the textarea', async () => {
    setup()
    await userEvent.setup().click(screen.getByText("This month's focus"))
    expect(document.activeElement).toBe(box())
  })

  it('shows the hint, and the textarea is described by it', () => {
    setup()
    const hint = screen.getByText(HINT)
    expect(hint.id).not.toBe('')
    expect(box().getAttribute('aria-describedby')?.split(' ')).toContain(hint.id)
  })

  it("shows last month's focus only when there was one", () => {
    const { view } = setup({ lastFocus: 'Win the rebrand' })
    const line = screen.getByText('Last month: Win the rebrand')
    expect(box().getAttribute('aria-describedby')?.split(' ')).toContain(line.id)
    view.unmount()

    setup({ lastFocus: null })
    expect(screen.queryByText(/Last month:/)).toBeNull()
    cleanup()

    setup({ lastFocus: '' })
    expect(screen.queryByText(/Last month:/)).toBeNull()
    cleanup()

    setup({ lastFocus: '   ' })
    expect(screen.queryByText(/Last month:/)).toBeNull()
    expect(box().getAttribute('aria-describedby')).toBe('checkin-focus-hint')
  })

  it('shows the value and reports typing', () => {
    const { onChange } = setup({ value: 'Ship it' })
    expect(box().value).toBe('Ship it')
    fireEvent.change(box(), { target: { value: 'Ship it now' } })
    expect(onChange).toHaveBeenCalledWith('Ship it now')
  })

  it('disabled makes it uneditable but still readable', () => {
    setup({ disabled: true, value: 'Read me' })
    expect(box().disabled).toBe(true)
    expect(box().value).toBe('Read me')
  })

  it('enabled leaves it editable', () => {
    setup({ disabled: false })
    expect(box().disabled).toBe(false)
  })

  it('caps the box at the database limit', () => {
    setup()
    expect(box().maxLength).toBe(FOCUS_MAX)
    expect(FOCUS_MAX).toBe(1000)
  })
})
