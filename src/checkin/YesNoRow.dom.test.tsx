// @vitest-environment jsdom

import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YesNoRow } from './YesNoRow'
import type { Question } from '../lib/buckets'

// YesNoRow is QuestionRow's two-option sibling, for Advocacy's four yes/no
// questions. It inherits QuestionRow's DOM-level tests unchanged -- the
// flushSync-before-focus fix and the visually-hidden-input requirement are
// the same fix for the same reason, just with two radios instead of five --
// plus a set of its own for the property that only this control has: a
// three-state value where `false` is an answer, not an absence of one.

afterEach(() => {
  document.body.innerHTML = ''
})

const QUESTION: Question = {
  key: 'adv_left_review',
  prompt: 'They have left a review.',
  kind: 'yesno',
}

// YesNoRow is controlled, like QuestionRow: clearing is the parent deleting
// the answer and re-rendering. Testing focus behaviour without that round
// trip would test a sequence the app never performs, so this harness is the
// parent.
function Harness({ initial }: { initial: boolean | undefined }) {
  const [value, setValue] = useState<boolean | undefined>(initial)
  return (
    <YesNoRow
      question={QUESTION}
      value={value}
      lastValue={null}
      disabled={false}
      onChange={setValue}
      onClear={() => setValue(undefined)}
    />
  )
}

function renderRow(overrides: Partial<Parameters<typeof YesNoRow>[0]> = {}) {
  const onChange = vi.fn()
  const onClear = vi.fn()
  render(
    <YesNoRow
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

describe('a yes/no row in a real DOM', () => {
  it('renders exactly two options, labelled Yes and No', () => {
    renderRow()
    expect(radios()).toHaveLength(2)
    expect(screen.getByLabelText('Yes')).not.toBeNull()
    expect(screen.getByLabelText('No')).not.toBeNull()
  })

  it('checks the radio matching value when it is true', () => {
    renderRow({ value: true })
    const yes = screen.getByLabelText('Yes') as HTMLInputElement
    const no = screen.getByLabelText('No') as HTMLInputElement
    expect(yes.checked).toBe(true)
    expect(no.checked).toBe(false)
  })

  // The case a truthiness check gets wrong: value === false must check "No",
  // not leave both radios unchecked as if the question were still unanswered.
  it('checks the radio matching value when it is false', () => {
    renderRow({ value: false })
    const yes = screen.getByLabelText('Yes') as HTMLInputElement
    const no = screen.getByLabelText('No') as HTMLInputElement
    expect(yes.checked).toBe(false)
    expect(no.checked).toBe(true)
  })

  it('checks neither radio when the question is unanswered', () => {
    renderRow({ value: undefined })
    for (const radio of radios()) {
      expect(radio.checked).toBe(false)
    }
  })

  it('fires onChange with true when Yes is clicked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderRow()

    await user.click(screen.getByLabelText('Yes'))

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('fires onChange with false when No is clicked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderRow()

    await user.click(screen.getByLabelText('No'))

    expect(onChange).toHaveBeenCalledWith(false)
  })

  // The case a truthiness check gets wrong. A cleared control and a control
  // answered No are different states, and only one of them offers Clear.
  it('offers Clear when the answer is No, not just when it is Yes', () => {
    renderRow({ value: false })
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeNull()
  })

  it('offers Clear when the answer is Yes', () => {
    renderRow({ value: true })
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeNull()
  })

  it('offers no Clear when the question is unanswered', () => {
    renderRow({ value: undefined })
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('disables both options and Clear when disabled is set', () => {
    renderRow({ value: true, disabled: true })

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

  it('shows "Yes" for last month when the prior answer was true', () => {
    renderRow({ lastValue: true })
    const label = screen.getByText('Last month:')
    expect(label.textContent).toBe('Last month: Yes')
  })

  it('shows "No" for last month when the prior answer was false', () => {
    renderRow({ lastValue: false })
    const label = screen.getByText('Last month:')
    expect(label.textContent).toBe('Last month: No')
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
    render(<Harness initial={false} />)

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(radios().some((radio) => radio.checked)).toBe(false)
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  // Clear unmounts itself the instant it fires (it only renders while
  // value !== undefined), taking focus with it. Without somewhere to send
  // focus, an element detached while focused drops it to <body>. This is the
  // same fix QuestionRow carries, reproduced here because a two-option group
  // anchors its tab order to its checked radio exactly the same way a
  // five-option one does.
  it('moves focus to the first radio (Yes) after Clear', async () => {
    const user = userEvent.setup()
    render(<Harness initial={true} />)

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(focusedValue()).toBe('yes')
  })

  it('moves focus only after the cleared answer has left the DOM', async () => {
    const user = userEvent.setup()
    render(<Harness initial={true} />)

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
  })
})
