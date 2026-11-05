// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUCKET_NOTE_MAX } from './bucketNotes'
import { BucketNotesPanel } from './BucketNotesPanel'
import type { BucketNote } from './bucketNotes'

afterEach(cleanup)

function setup(over: { note?: BucketNote; lastActions?: string; disabled?: boolean } = {}) {
  const onChange = vi.fn()
  const view = render(
    <BucketNotesPanel
      bucket="growth"
      disabled={over.disabled ?? false}
      lastActions={over.lastActions}
      note={over.note}
      onChange={onChange}
    />,
  )
  return { onChange, view }
}

const why = () => screen.getByLabelText('Why this score') as HTMLTextAreaElement
const actions = () => screen.getByLabelText('Action items') as HTMLTextAreaElement

describe('BucketNotesPanel', () => {
  it('labels both textareas with the exact copy, linked by htmlFor', () => {
    setup()
    // getByLabelText resolves through <label for>, so finding a textarea at
    // all proves the link. Asserting the tag too: a label pointing at the
    // panel's wrapper would resolve to the wrong thing.
    expect(why().tagName).toBe('TEXTAREA')
    expect(actions().tagName).toBe('TEXTAREA')
    const whyLabel = screen.getByText('Why this score')
    const actionsLabel = screen.getByText('Action items')
    expect(whyLabel.tagName).toBe('LABEL')
    expect(actionsLabel.tagName).toBe('LABEL')
    expect(whyLabel.getAttribute('for')).toBe(why().id)
    expect(actionsLabel.getAttribute('for')).toBe(actions().id)
  })

  it('ids are unique per bucket, so six panels on one page never collide', () => {
    render(
      <>
        <BucketNotesPanel bucket="growth" disabled={false} note={undefined} onChange={() => {}} />
        <BucketNotesPanel bucket="delivery" disabled={false} note={undefined} onChange={() => {}} />
      </>,
    )
    const ids = Array.from(document.querySelectorAll('textarea')).map((t) => t.id)
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    for (const id of ids) expect(id).not.toBe('')
  })

  it('clicking a label focuses its textarea', async () => {
    setup()
    const user = userEvent.setup()
    await user.click(screen.getByText('Why this score'))
    expect(document.activeElement).toBe(why())
    await user.click(screen.getByText('Action items'))
    expect(document.activeElement).toBe(actions())
  })

  it('typing calls onChange with the field and the text', () => {
    const { onChange } = setup()
    fireEvent.change(why(), { target: { value: 'Slow replies all month' } })
    expect(onChange).toHaveBeenLastCalledWith('why', 'Slow replies all month')
    fireEvent.change(actions(), { target: { value: 'Weekly call' } })
    expect(onChange).toHaveBeenLastCalledWith('actions', 'Weekly call')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('shows the stored text in each box', () => {
    setup({ note: { why: 'Because', actions: 'Do the thing' } })
    expect(why().value).toBe('Because')
    expect(actions().value).toBe('Do the thing')
  })

  it('shows an empty box for a missing field', () => {
    setup({ note: { actions: 'Only actions' } })
    expect(why().value).toBe('')
    expect(actions().value).toBe('Only actions')
  })

  it("shows last month's actions only when given", () => {
    const { view } = setup({ lastActions: 'Send the deck' })
    expect(screen.getByText("Last month's actions: Send the deck")).toBeTruthy()
    // Described by it, so a screen reader in the Action items box hears it.
    const lineId = screen.getByText("Last month's actions: Send the deck").id
    expect(lineId).not.toBe('')
    expect(actions().getAttribute('aria-describedby')).toBe(lineId)
    view.unmount()

    setup()
    expect(screen.queryByText(/Last month's actions/)).toBeNull()
    expect(actions().hasAttribute('aria-describedby')).toBe(false)
  })

  it('treats an empty last-month string as absent', () => {
    setup({ lastActions: '' })
    expect(screen.queryByText(/Last month's actions/)).toBeNull()
  })

  it('disabled makes both boxes uneditable', () => {
    setup({ disabled: true, note: { why: 'Read me' } })
    expect(why().disabled).toBe(true)
    expect(actions().disabled).toBe(true)
    // Still readable: a viewer sees the text.
    expect(why().value).toBe('Read me')
  })

  it('enabled leaves both boxes editable', () => {
    setup({ disabled: false })
    expect(why().disabled).toBe(false)
    expect(actions().disabled).toBe(false)
  })

  it('caps each box at the database limit', () => {
    setup()
    expect(why().maxLength).toBe(BUCKET_NOTE_MAX)
    expect(actions().maxLength).toBe(BUCKET_NOTE_MAX)
    expect(BUCKET_NOTE_MAX).toBe(2000)
  })

  it('names the group after its bucket', () => {
    setup()
    const group = screen.getByRole('group', { name: 'Growth notes' })
    expect(within(group).getByLabelText('Why this score')).toBe(why())
  })
})
