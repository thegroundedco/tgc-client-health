// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Churn } from './Churn'
import type { DepartedRow, LifecycleClient } from './tenureMath'

afterEach(() => {
  document.body.innerHTML = ''
})

function row(
  name: string,
  days: number | null,
  over: Partial<LifecycleClient> = {},
): DepartedRow {
  const client: LifecycleClient = {
    id: name.length,
    name,
    status: 'former',
    started_on: days === null ? null : '2025-01-01',
    ended_on: '2026-08-25',
    end_reason_code: 'price',
    end_reason_note: null,
    ...over,
  }
  return { client, days }
}

describe('Churn', () => {
  it('shows who left, when, why and for how long they had been with you', () => {
    render(<Churn rows={[row('Delta', 396)]} />)

    const item = screen.getByRole('list', { name: 'Departures' }).querySelector('li')
    const text = item?.textContent ?? ''
    expect(text).toContain('Delta')
    // The "when" this test is named for. row()'s fixed ended_on is
    // '2026-08-25', which formatDay renders as 'Aug 25, 2026' -- previously
    // unasserted, so deleting the date expression from Churn.tsx entirely
    // still passed this test.
    expect(text).toContain('Aug 25, 2026')
    expect(text).toContain('Price')
    expect(text).toContain('1 yr 1 mo')
  })

  // The parent spec: the code makes reasons countable across clients, the note
  // carries the story, and "a coded reason alone loses the story, and free text
  // alone cannot be counted -- hence both". A ledger showing only the code
  // would be the countable half of a thing whose point is the story.
  it('shows the note beside the coded reason', () => {
    render(
      <Churn
        rows={[row('Delta', 396, { end_reason_note: 'Budget moved to paid media.' })]}
      />,
    )

    expect(screen.getByText(/Budget moved to paid media/)).toBeTruthy()
  })

  it('says nothing where no note was written', () => {
    render(<Churn rows={[row('Delta', 396, { end_reason_note: null })]} />)

    expect(screen.queryByTestId('churn-note')).toBe(null)
  })

  // The only churn event in production is exactly this: no start date, so its
  // tenure-at-churn cannot be known. Never zero, never blank.
  it('reads unknown when the departed client had no start date', () => {
    render(<Churn rows={[row('Delta', null)]} />)

    const item = screen.getByRole('list', { name: 'Departures' }).querySelector('li')
    expect(item?.textContent).toContain('unknown')
  })

  // THE tripwire, and the reason it is worth more than it looks. A churn rate
  // is the obvious thing to add to a churn report, and spec §6 is the reason it
  // must not be added while one event is all there is: a rate computed on one
  // departure is 9.1%, a number that reads as a fact and means nothing.
  it('renders no percentage anywhere', () => {
    render(<Churn rows={[row('Delta', 396), row('Echo', 200)]} />)

    expect(document.body.textContent).not.toMatch(/\d\s*%/)
  })

  // THE CAPTION IS COMPUTED, NOT WRITTEN. The test this replaces asserted only
  // that the words 'rate' and 'start date' appeared, which is why the sentence
  // was free to go false on the live site: it said "a rate needs more than one
  // departure" and "the breakdown needs the clients who left to have a recorded
  // start date" while production held TWO departures, one of them WITH a start
  // date. Both stated reasons were wrong and 977 tests passed.
  //
  // Every assertion below pins a NUMBER the component has to derive from its
  // own rows, so static prose cannot satisfy them.

  it('counts the departures it is not computing a rate from', () => {
    render(<Churn rows={[row('Delta', 396), row('Echo', null)]} />)

    const text = document.body.textContent ?? ''
    // Two, from the rows. Static prose claiming one departure fails here, which
    // is the exact defect this test exists for.
    expect(text).toContain('2 departures are too few')
  })

  it('counts how many of the departed have no recorded start date', () => {
    render(<Churn rows={[row('Delta', 396), row('Echo', null)]} />)

    const text = document.body.textContent ?? ''
    expect(text).toContain('1 of them has no recorded start date')
  })

  it('stops claiming a missing start date once every departed client has one', () => {
    // The half that cannot be faked with a reworded sentence: when the reason
    // evaporates, the clause has to disappear. It also stops the caption
    // claiming a breakdown is impossible when it has become possible, which is
    // a decision for the owner rather than something to assert either way.
    render(<Churn rows={[row('Delta', 396), row('Echo', 200)]} />)

    const text = document.body.textContent ?? ''
    expect(text).not.toContain('no recorded start date')
    expect(text).toContain('Every client who left has a recorded start date')
  })

  it('reads as a singular departure when there is only one', () => {
    render(<Churn rows={[row('Delta', null)]} />)

    const text = document.body.textContent ?? ''
    expect(text).toContain('1 departure is too few')
    expect(text).toContain('1 of them has no recorded start date')
  })

  it('does not mistake a missing END date for a missing start date', () => {
    // `days` is null for BOTH -- no start date and no end date -- so a caption
    // computed from `days` would report this client as having no recorded start
    // date when it has one. The row below started on a known day and has no
    // recorded end, which is why the list beside it renders 'unknown' for the
    // date. Only started_on may drive the start-date clause.
    render(<Churn rows={[row('Delta', null, { started_on: '2025-01-01', ended_on: null })]} />)

    const text = document.body.textContent ?? ''
    expect(text).not.toContain('no recorded start date')
    expect(text).toContain('Every client who left has a recorded start date')
  })

  // Spec §6 IA calls this destination "revenue retention and churn" -- and the
  // word only appeared inside the non-empty branch, so on the day the ledger
  // empties the page would stop saying the word "churn" anywhere, with nothing
  // to notice. The empty state has to say it too.
  it('says so when nobody has left, and still names churn', () => {
    render(<Churn rows={[]} />)

    expect(screen.getByText(/nobody has left/i)).toBeTruthy()
    expect(document.body.textContent).toMatch(/churn/i)
  })
})
