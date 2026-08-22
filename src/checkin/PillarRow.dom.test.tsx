// @vitest-environment jsdom

import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { PillarRow } from './PillarRow'
import { MAX_PILLAR_SCORE } from '../lib/score'

// The first tests in this repository that can see a DOM. They exist because the
// owner's manual pass found something no other gate could reach: after clearing
// a pillar with the keyboard, Tab stopped on a second number before leaving the
// row, where an unscored pillar gives exactly one stop. Items 16 and 17 of the
// visual checklist.
//
// Everything else in src/checkin is tested in the node environment. This file
// opts into jsdom with the docblock above rather than changing the project
// default, so the live-credential and pure-logic suites are unaffected.

afterEach(() => {
  document.body.innerHTML = ''
})

// PillarRow is controlled: clearing is the parent deleting the score and
// re-rendering. Testing the focus behaviour without that round trip would test
// a sequence the app never performs, so this harness is the parent.
function Harness({ initial }: { initial: number | undefined }) {
  const [value, setValue] = useState<number | undefined>(initial)
  return (
    <PillarRow
      pillar="relationship"
      value={value}
      lastValue={null}
      disabled={false}
      onChange={setValue}
      onClear={() => setValue(undefined)}
    />
  )
}

const radios = () => screen.getAllByRole('radio') as HTMLInputElement[]
const focusedValue = () => (document.activeElement as HTMLInputElement | null)?.value

describe('a pillar row in a real DOM', () => {
  it('renders one radio per score, and a Clear only when something is scored', () => {
    const { unmount } = render(<Harness initial={undefined} />)
    expect(radios()).toHaveLength(MAX_PILLAR_SCORE)
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    unmount()

    render(<Harness initial={3} />)
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy()
  })

  it('gives an unscored group a single tab stop (checklist item 17)', async () => {
    const user = userEvent.setup()
    render(<Harness initial={undefined} />)

    await user.tab()
    expect(focusedValue()).toBe('1')

    // Out of the group entirely, not on to '2'. This is the behaviour the owner
    // saw and correctly read as right: a radio group is one stop, and the arrow
    // keys move within it.
    await user.tab()
    expect(radios().some((radio) => radio === document.activeElement)).toBe(false)
  })

  it('gives a scored group a single tab stop, on the checked radio', async () => {
    const user = userEvent.setup()
    render(<Harness initial={4} />)

    await user.tab()
    expect(focusedValue()).toBe('4')

    await user.tab()
    // Clear is the next stop while a score is set.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear' }))
  })

  it('clears the score, so the row is genuinely unscored afterwards', async () => {
    const user = userEvent.setup()
    render(<Harness initial={2} />)

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    // The half of item 16 that would have been serious: not quietly set to 1.
    expect(radios().some((radio) => radio.checked)).toBe(false)
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('leaves exactly one tab stop after Clear, like any unscored group (item 16)', async () => {
    const user = userEvent.setup()
    render(<Harness initial={2} />)

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    // handleClear sends focus to the first radio, because Clear unmounts itself
    // and a detached focused element drops focus to <body>.
    expect(focusedValue()).toBe('1')

    // The reported defect: this Tab landed on '2' -- the score that had just
    // been cleared -- before going on to leave the row. An unscored group must
    // behave like an unscored group no matter how it got that way.
    await user.tab()
    expect(focusedValue()).not.toBe('2')
    expect(radios().some((radio) => radio === document.activeElement)).toBe(false)
  })

  // The symptom above -- an extra tab stop -- does NOT reproduce here:
  // user-event recomputes the radio group when it tabs, so it never sees the
  // state a real browser saw. This test goes after the CAUSE instead, which is
  // observable: does focus land while the cleared score is still checked in the
  // DOM? If it does, the browser anchors the group's tab order to a radio that
  // is about to be unchecked, which is the only mechanism that explains the
  // owner's report.
  it('moves focus only after the cleared score has left the DOM', async () => {
    const user = userEvent.setup()
    render(<Harness initial={2} />)

    let checkedWhenFocusArrived: string[] | null = null
    const first = radios()[0]
    first.addEventListener(
      'focus',
      () => {
        checkedWhenFocusArrived = radios()
          .filter((radio) => radio.checked)
          .map((radio) => radio.value)
      },
      { once: true },
    )

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(checkedWhenFocusArrived).not.toBeNull()
    // Nothing may still be checked at that instant. '2' here means focus was
    // moved before React committed the clear.
    expect(checkedWhenFocusArrived).toEqual([])
  })

  it('does the same when Clear is activated from the keyboard', async () => {
    const user = userEvent.setup()
    render(<Harness initial={2} />)

    await user.tab() // the checked radio, 2
    await user.tab() // Clear
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear' }))

    await user.keyboard('{Enter}')

    expect(radios().some((radio) => radio.checked)).toBe(false)
    expect(focusedValue()).toBe('1')

    await user.tab()
    expect(focusedValue()).not.toBe('2')
  })
})
