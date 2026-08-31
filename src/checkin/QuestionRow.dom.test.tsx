// @vitest-environment jsdom

import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuestionRow } from './QuestionRow'
import { SCORE_VALUES } from '../lib/scoreMath'
import type { Question } from '../lib/buckets'


// The first tests in this repository that can see a DOM. They exist because the
// owner's manual pass found something no other gate could reach: after clearing
// a pillar with the keyboard, Tab stopped on a second number before leaving the
// row, where an unscored pillar gives exactly one stop. Items 16 and 17 of the
// visual checklist. QuestionRow inherits the fix (and these tests) unchanged
// from the PillarRow it replaces.
//
// Everything else in src/checkin is tested in the node environment. This file
// opts into jsdom with the docblock above rather than changing the project
// default, so the live-credential and pure-logic suites are unaffected.

afterEach(() => {
  document.body.innerHTML = ''
})

const QUESTION: Question = { key: 'rel_respectful', prompt: 'They are respectful.', kind: 'scale' }

// QuestionRow is controlled: clearing is the parent deleting the score and
// re-rendering. Testing the focus behaviour without that round trip would test
// a sequence the app never performs, so this harness is the parent.
function Harness({ initial }: { initial: number | undefined }) {
  const [value, setValue] = useState<number | undefined>(initial)
  return (
    <QuestionRow
      question={QUESTION}
      value={value}
      lastValue={null}
      disabled={false}
      onChange={setValue}
      onClear={() => setValue(undefined)}
    />
  )
}

function renderRow(overrides: Partial<Parameters<typeof QuestionRow>[0]> = {}) {
  const onChange = vi.fn()
  const onClear = vi.fn()
  render(
    <QuestionRow
      question={QUESTION}
      value={undefined}
      lastValue={null}
      disabled={false}
      onChange={onChange}
      onClear={onClear}
      {...overrides}
    />,
  )
  return { onChange, onClear }
}

const radios = () => screen.getAllByRole('radio') as HTMLInputElement[]
const focusedValue = () => (document.activeElement as HTMLInputElement | null)?.value

describe('a question row in a real DOM', () => {
  it('renders one radio per score, and a Clear only when something is scored', () => {
    const { unmount } = render(<Harness initial={undefined} />)
    expect(radios()).toHaveLength(SCORE_VALUES.length)
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    unmount()

    render(<Harness initial={3} />)
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy()
  })

  it('checks the radio matching value, and no other', () => {
    render(<Harness initial={3} />)
    for (const radio of radios()) {
      expect(radio.checked).toBe(radio.value === '3')
    }
  })

  it('fires onChange with the clicked score', async () => {
    const user = userEvent.setup()
    const { onChange } = renderRow()

    await user.click(screen.getAllByRole('radio')[2])

    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('disables every radio and Clear when disabled is set', () => {
    renderRow({ value: 2, disabled: true })

    for (const radio of radios()) {
      expect(radio.disabled).toBe(true)
    }
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('shows "No score last month" when there is no prior value', () => {
    renderRow({ lastValue: null })
    expect(screen.getByText('No score last month')).not.toBeNull()
  })

  it('shows last month\'s value when there is one', () => {
    renderRow({ lastValue: 4 })
    const label = screen.getByText('Last month:')
    // Scoped to the label's own paragraph rather than screen.getByText('4'),
    // because '4' also appears as one of the five score options.
    expect(label.textContent).toBe('Last month: 4')
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

  it('names the group by its prompt, so 21 groups on one screen are distinguishable', () => {
    renderRow()
    expect(screen.getByRole('radiogroup', { name: 'They are respectful.' })).not.toBeNull()
  })

  // The radios are grouped by `name`. Two questions sharing one would make a
  // single group of ten across the whole screen -- picking a Delivery score would
  // silently unpick a Communication one.
  it('scopes its radio name to the question key', () => {
    renderRow()
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.getAttribute('name')).toBe('question-rel_respectful')
    }
  })

  // §7: one legend for the screen, not three anchors per question. 66 pieces of
  // copy nobody has written is what this row is not carrying.
  it('renders no per-question anchor list', () => {
    const { container } = render(
      <QuestionRow
        question={QUESTION}
        value={3}
        lastValue={null}
        disabled={false}
        onChange={() => {}}
        onClear={() => {}}
      />,
    )
    expect(container.querySelector('dl')).toBeNull()
  })
})
