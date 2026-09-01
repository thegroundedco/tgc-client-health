// @vitest-environment jsdom

import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChoiceRow } from './ChoiceRow'
import { RATE_OPTIONS } from '../lib/buckets'
import type { Question } from '../lib/buckets'

// ChoiceRow is QuestionRow's three-option sibling, for Finances' and
// Advocacy's seven choice questions. It inherits QuestionRow's DOM-level
// tests unchanged -- the flushSync-before-focus fix and the
// visually-hidden-input requirement are the same fix for the same reason,
// just with three radios instead of two or five -- plus a set of its own for
// the properties that only this control has: a three-state value read from
// CHOICE_OPTIONS, ordered worse-left to better-right.

afterEach(() => {
  document.body.innerHTML = ''
})

const QUESTION: Question = {
  key: 'adv_left_review',
  prompt: 'They have left a review.',
  kind: 'choice',
}

// ChoiceRow is controlled, like QuestionRow: clearing is the parent deleting
// the answer and re-rendering. Testing focus behaviour without that round
// trip would test a sequence the app never performs, so this harness is the
// parent.
function Harness({
  initial,
  question = QUESTION,
}: {
  initial: number | undefined
  question?: Question
}) {
  const [value, setValue] = useState<number | undefined>(initial)
  return (
    <ChoiceRow
      question={question}
      value={value}
      lastValue={null}
      disabled={false}
      onChange={setValue}
      onClear={() => setValue(undefined)}
    />
  )
}

function props(overrides: Partial<Parameters<typeof ChoiceRow>[0]> = {}) {
  return {
    question: QUESTION,
    value: undefined,
    lastValue: null,
    disabled: false,
    onChange: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  }
}

function renderRow(overrides: Partial<Parameters<typeof ChoiceRow>[0]> = {}) {
  const merged = props(overrides)
  render(<ChoiceRow {...merged} />)
  return { onChange: merged.onChange, onClear: merged.onClear }
}

const radios = () => screen.getAllByRole('radio') as HTMLInputElement[]
const focusedValue = () => (document.activeElement as HTMLInputElement | null)?.value

describe('a choice row in a real DOM', () => {
  it('renders the options worse-left to better-right', () => {
    // Every control on this screen runs the same direction. A row that ran
    // best-first would make the leftmost box mean the opposite of its neighbour
    // fourteen rows up.
    render(<ChoiceRow {...props()} />)
    const labels = screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)
    expect(labels).toEqual(['1', '3', '5'])
  })

  it('renders exactly three options, labelled No, Unsure and Yes', () => {
    renderRow()
    expect(radios()).toHaveLength(3)
    expect(screen.getByLabelText('No')).not.toBeNull()
    expect(screen.getByLabelText('Unsure')).not.toBeNull()
    expect(screen.getByLabelText('Yes')).not.toBeNull()
  })

  // The rate question is the one `choice` question that does not read
  // No/Unsure/Yes. Its labels come from the question, its VALUES do not: the
  // same 1/3/5 in the same column, which is the only reason relabelling it was
  // not a migration.
  describe('a question carrying its own three words', () => {
    const RATE: Question = {
      key: 'fin_rate_increased',
      prompt: 'Rate over the last 90 days.',
      kind: 'choice',
      options: RATE_OPTIONS,
    }

    it('renders the question\'s labels over the same three values', () => {
      render(<ChoiceRow {...props({ question: RATE })} />)
      expect(screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual(
        ['1', '3', '5'],
      )
      expect(screen.getByLabelText('Decreased')).toBeTruthy()
      expect(screen.getByLabelText('Break even')).toBeTruthy()
      expect(screen.getByLabelText('Increased')).toBeTruthy()
      // The default words must not leak onto it.
      expect(screen.queryByLabelText('Unsure')).toBeNull()
    })

    it('reads last month in the question\'s own words', () => {
      // The failure this prevents is a wrong word, not a missing one: a stored
      // 3 printed as "Unsure" on a question whose 3 means "Break even" is a
      // sentence that looks fine and says something else.
      render(<ChoiceRow {...props({ question: RATE, lastValue: 3 })} />)
      // Read off the "Last month:" line itself. A page-wide text query would
      // find "Break even" on the radio too and pass without the line ever
      // rendering.
      expect(screen.getByText('Last month:').textContent).toBe('Last month: Break even')
    })

    it('anchors Clear\'s focus to THIS question\'s first option', () => {
      // firstRadio follows the question's own options now. Asserted on the
      // accessible name rather than on the value, because both option sets
      // start at 1 -- a firstRadio still bound to CHOICE_OPTIONS would focus a
      // radio with the same value and this would pass while being wrong.
      render(<Harness initial={5} question={RATE} />)
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      expect(focusedValue()).toBe('1')
      expect((document.activeElement as HTMLInputElement).labels?.[0]?.textContent).toBe(
        'Decreased',
      )
    })
  })

  it('checks the radio matching value when it is 5 (Yes)', () => {
    renderRow({ value: 5 })
    const yes = screen.getByLabelText('Yes') as HTMLInputElement
    const no = screen.getByLabelText('No') as HTMLInputElement
    expect(yes.checked).toBe(true)
    expect(no.checked).toBe(false)
  })

  it('shows a No as answered, and offers Clear for it', () => {
    // === value, never truthiness: 1 is an answer. A truthy check would leave No
    // unchecked and hide Clear from anyone who answered it, stranding them with
    // no way back to unanswered.
    render(<ChoiceRow {...props({ value: 1 })} />)
    const no = screen.getByRole('radio', { name: 'No' }) as HTMLInputElement
    expect(no.checked).toBe(true)
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy()
  })

  it('checks neither radio when the question is unanswered', () => {
    renderRow({ value: undefined })
    for (const radio of radios()) {
      expect(radio.checked).toBe(false)
    }
  })

  it('fires onChange with 5 when Yes is clicked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderRow()

    await user.click(screen.getByLabelText('Yes'))

    expect(onChange).toHaveBeenCalledWith(5)
  })

  it('fires onChange with 1 when No is clicked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderRow()

    await user.click(screen.getByLabelText('No'))

    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('offers Clear when the answer is No, not just when it is Yes', () => {
    renderRow({ value: 1 })
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeNull()
  })

  it('offers Clear when the answer is Yes', () => {
    renderRow({ value: 5 })
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeNull()
  })

  it('offers no Clear when the question is unanswered', () => {
    renderRow({ value: undefined })
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('disables all three options and Clear when disabled is set', () => {
    renderRow({ value: 5, disabled: true })

    for (const radio of radios()) {
      expect(radio.disabled).toBe(true)
    }
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('shows "No answer last month" when there is no prior value', () => {
    renderRow({ lastValue: null })
    expect(screen.getByText('No answer last month')).not.toBeNull()
  })

  it('reads last month by its label, not its number', () => {
    render(<ChoiceRow {...props({ lastValue: 3 })} />)
    const label = screen.getByText('Last month:')
    expect(label.textContent).toBe('Last month: Unsure')
  })

  it('shows a legacy value that no control can write as a bare number', () => {
    // August 2026's Finance answers contain 2s and 4s. Rendering one as a choice
    // label would invent an answer nobody gave; rendering nothing would hide real
    // history.
    render(<ChoiceRow {...props({ lastValue: 4 })} />)
    expect(screen.getByText(/4/)).toBeTruthy()
  })

  it('names the group by its prompt', () => {
    renderRow()
    expect(screen.getByRole('radiogroup', { name: 'They have left a review.' })).not.toBeNull()
  })

  // The radios are grouped by `name`. Two questions sharing one would make a
  // single group across the whole screen -- picking one question's answer
  // would silently unpick another's.
  it('scopes its radio name to the question key', () => {
    renderRow()
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.getAttribute('name')).toBe('question-adv_left_review')
    }
  })

  it('clears the answer, so the row is genuinely unanswered afterwards', async () => {
    const user = userEvent.setup()
    render(<Harness initial={1} />)

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(radios().some((radio) => radio.checked)).toBe(false)
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('keeps focus in the row after Clear', () => {
    // The flushSync ordering the owner reported against QuestionRow. Without it
    // the group stays anchored to the radio about to be unchecked and the next
    // Tab stops on the answer just cleared.
    render(<ChoiceRow {...props({ value: 5 })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'No' }))
  })

  it('moves focus only after the cleared answer has left the DOM', async () => {
    const user = userEvent.setup()
    render(<Harness initial={5} />)

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
    expect(checkedWhenFocusArrived).toEqual([])
    expect(focusedValue()).toBe('1')
  })
})
