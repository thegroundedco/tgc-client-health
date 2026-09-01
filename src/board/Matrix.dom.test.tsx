// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Matrix } from './Matrix'
import type { CardCheckin } from './cardSummary'
import type { BoardClient, BoardScore } from './useBoard'

afterEach(() => {
  document.body.innerHTML = ''
})

const PERIOD = '2026-08-01'
const OLD = '2020-01-01'

function client(id: number, name: string, overrides: Partial<BoardClient> = {}): BoardClient {
  return { id, name, status: 'active', started_on: OLD, ...overrides }
}

function checkin(id: number, scores: Partial<CardCheckin> = {}): CardCheckin {
  return {
    client_id: id,
    submitted_at: null,
    submitted_by: null,
    comm_score: null,
    growth_score: null,
    fin_score: null,
    rel_score: null,
    del_score: null,
    adv_score: null,
    ...scores,
  }
}

type Given = {
  clients?: BoardClient[]
  checkins?: [number, CardCheckin][]
  scores?: [number, BoardScore][]
  onOpen?: (client: BoardClient) => void
}

function renderMatrix(given: Given = {}) {
  const {
    clients = [client(1, 'Babaloo')],
    checkins = [],
    scores = [],
    onOpen = () => {},
  } = given
  return render(
    <Matrix
      checkins={new Map(checkins)}
      clients={clients}
      onOpen={onOpen}
      period={PERIOD}
      scores={new Map(scores)}
    />,
  )
}

const cells = () => screen.getAllByTestId('matrix-cell')
const averages = () => screen.getAllByTestId('matrix-average')

describe('the matrix table', () => {
  it('is a real table with a caption naming the month', () => {
    // Not a grid of divs. This is what makes a screen reader announce
    // "Colorfil, Growth, 5.00" instead of reading sixty loose numbers.
    renderMatrix()
    const table = screen.getByTestId('matrix-table')
    expect(table.tagName).toBe('TABLE')
    expect(table.querySelector('caption')?.textContent).toContain('August 2026')
  })

  it('heads every bucket column with its full name, and splits Advocacy in two', () => {
    // The full word, not the card's initial: a table has a column and a
    // scroller to spend width on. And no Band column -- the band reads beside
    // the client's name instead. Owner's calls, 2026-09-01.
    //
    // Advocacy is the one bucket with sub-columns, so it appears once in the
    // first header row and its Score and Context appear in the second.
    renderMatrix()
    expect(screen.getAllByRole('columnheader').map((head) => head.textContent)).toEqual([
      'Client',
      'Communication',
      'Growth',
      'Finances',
      'Relationship',
      'Delivery',
      'Advocacy',
      'Overall',
      'Score',
      'Context',
    ])
  })

  it('files Score and Context under Advocacy rather than beside it', () => {
    // scope="colgroup" is the difference between a screen reader saying
    // "Advocacy, Context, Review and Case study" and reading Context as a
    // seventh bucket. The two sub-headers are plain columns within it.
    renderMatrix()
    const advocacy = screen.getByRole('columnheader', { name: 'Advocacy' })
    expect(advocacy.getAttribute('scope')).toBe('colgroup')
    expect((advocacy as HTMLTableCellElement).colSpan).toBe(2)
    for (const name of ['Score', 'Context']) {
      expect(screen.getByRole('columnheader', { name }).getAttribute('scope')).toBe('col')
    }
    // Every other column spans both header rows, so the header is one block
    // rather than a row of labels above a row of blanks.
    expect((screen.getByRole('columnheader', { name: 'Client' }) as HTMLTableCellElement).rowSpan)
      .toBe(2)
    expect((screen.getByRole('columnheader', { name: 'Overall' }) as HTMLTableCellElement).rowSpan)
      .toBe(2)
  })

  it('gives every row exactly as many cells as the header has columns', () => {
    // The check a colSpan gets wrong silently. A footer that spans one column
    // too many or too few shifts the whole Average row sideways under headings
    // that no longer describe it, and nothing else in this file would notice.
    //
    // Width is the FIRST header row's spans summed, not a count of <th> -- the
    // header is two rows now and counting elements would give ten for a
    // nine-column table.
    renderMatrix({
      clients: [client(1, 'A'), client(2, 'B')],
      checkins: [[1, checkin(1, { comm_score: 4 })]],
    })
    const table = screen.getByTestId('matrix-table')
    const spanOf = (row: Element) =>
      [...row.children].reduce(
        (total, cell) => total + ((cell as HTMLTableCellElement).colSpan || 1),
        0,
      )
    const width = spanOf(table.querySelector('thead tr')!)
    expect(width).toBe(9)
    for (const row of table.querySelectorAll('tbody tr, tfoot tr')) {
      expect(spanOf(row)).toBe(width)
    }
  })

  it('scopes both header axes, and puts the Average row in a tfoot', () => {
    renderMatrix()
    const table = screen.getByTestId('matrix-table')
    for (const head of table.querySelectorAll('thead th')) {
      // colgroup for Advocacy, which parents two sub-columns; col for the rest.
      expect(['col', 'colgroup']).toContain(head.getAttribute('scope'))
    }
    for (const head of table.querySelectorAll('tbody th')) {
      expect(head.getAttribute('scope')).toBe('row')
    }
    const feet = table.querySelectorAll('tfoot')
    expect(feet).toHaveLength(1)
    expect(feet[0].querySelector('th')?.getAttribute('scope')).toBe('row')
    expect(feet[0].querySelector('th')?.textContent).toBe('Average')
  })

  it('draws one row per active client, alphabetically', () => {
    renderMatrix({
      clients: [client(3, 'York'), client(1, 'Babaloo'), client(2, 'Gait Happens')],
    })
    // The name alone, not the whole cell: the cell also carries the band word.
    expect(screen.getAllByTestId('matrix-name').map((name) => name.textContent)).toEqual([
      'Babaloo',
      'Gait Happens',
      'York',
    ])
  })

  it('draws six bucket cells per row, in rubric order', () => {
    renderMatrix({
      checkins: [
        [
          1,
          checkin(1, {
            comm_score: 3.67,
            growth_score: 3.33,
            fin_score: 4,
            rel_score: 3.75,
            del_score: 3.5,
            adv_score: 5,
          }),
        ],
      ],
    })
    expect(cells().map((cell) => cell.textContent)).toEqual([
      '3.67',
      '3.33',
      '4.00',
      '3.75',
      '3.50',
      '5.00',
    ])
  })

  it('renders an em dash for a missing cell, never a 0', () => {
    // The property the whole model is built on: a missing answer must never
    // read as a low score.
    renderMatrix({ checkins: [[1, checkin(1, { comm_score: 4 })]] })
    const text = cells().map((cell) => cell.textContent)
    expect(text[0]).toBe('4.00')
    for (const value of text.slice(1)) {
      expect(value).toContain('—')
      expect(value).not.toContain('0')
    }
  })

  it('gives a client with no check-in at all a full row of em dashes', () => {
    renderMatrix({ clients: [client(1, 'Babaloo')] })
    for (const cell of cells()) {
      expect(cell.textContent).toContain('—')
    }
    expect(screen.getByTestId('matrix-overall').textContent).toContain('—')
  })

  it('bands each cell on its own value, and the name and overall on the overall', () => {
    renderMatrix({
      checkins: [[1, checkin(1, { comm_score: 5, growth_score: 3, fin_score: 1 })]],
      scores: [[1, { client_id: 1, overall_score: 3, advocacy_applies: true }]],
    })
    // 3.6 and 2.2 -- the shipped bands, not a second set. A cell at 3.00 is
    // Watch and a cell at 1.00 is At risk.
    expect(cells().map((cell) => cell.getAttribute('data-band'))).toEqual([
      'healthy',
      'watch',
      'at_risk',
      'incomplete',
      'incomplete',
      'incomplete',
    ])
    const row = screen.getByTestId('matrix-row')
    expect(row.querySelector('th')?.getAttribute('data-band')).toBe('watch')
    expect(screen.getByTestId('matrix-overall').getAttribute('data-band')).toBe('watch')
  })

  it('reads the band beside the client name, so colour is never the only signal', () => {
    // Parent spec §9.3: teal against amber measures 1.06:1, so no band may be
    // carried by hue alone. The band used to be its own column; it now sits at
    // the right end of the client cell.
    //
    // The two parts are asserted separately rather than as the cell's whole
    // text. There is no separator between them any more -- the layout does that
    // job -- so a concatenated assertion would read "BabalooHealthy" and would
    // be pinning an artefact of the DOM rather than anything a person sees.
    renderMatrix({
      scores: [[1, { client_id: 1, overall_score: 4.71, advocacy_applies: true }]],
    })
    const row = screen.getByTestId('matrix-row')
    expect(within(row).getByTestId('matrix-name').textContent).toBe('Babaloo')
    expect(within(row).getByTestId('matrix-band').textContent).toBe('Healthy')
    expect(screen.getByTestId('matrix-overall').textContent).toBe('4.71')
  })

  it('reads Not scored beside the name when the overall is null', () => {
    renderMatrix({ scores: [[1, { client_id: 1, overall_score: null, advocacy_applies: true }]] })
    expect(screen.getByTestId('matrix-band').textContent).toBe('Not scored')
  })

  it('keeps the band out of the button, so the control is named for the client', () => {
    // The band is a fact about the client, not a thing you can click. Inside the
    // button it would make the accessible name "Babaloo - Watch" and imply the
    // word was part of the target.
    renderMatrix({
      scores: [[1, { client_id: 1, overall_score: 3, advocacy_applies: true }]],
    })
    expect(screen.getByRole('button', { name: 'Babaloo' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Watch/ })).toBeNull()
  })

  it('averages each bucket across the roster', () => {
    renderMatrix({
      clients: [client(1, 'A'), client(2, 'B')],
      checkins: [
        [1, checkin(1, { comm_score: 4 })],
        [2, checkin(2, { comm_score: 5 })],
      ],
    })
    expect(averages()[0].textContent).toBe('4.50')
  })

  it('asterisks an average built from fewer clients than were eligible', () => {
    renderMatrix({
      clients: [client(1, 'A'), client(2, 'B')],
      checkins: [[1, checkin(1, { comm_score: 4 })]],
    })
    expect(averages()[0].textContent).toContain('*')
    // The exact shortfall, for a screen reader and for inspection.
    expect(averages()[0].textContent).toContain('averaged from 1 of 2 clients')
    expect(screen.getByTestId('matrix-footnote')).toBeTruthy()
  })

  it('does not asterisk Advocacy for a client the gate excludes', () => {
    // Nothing is missing; the gate is doing its job. An asterisk that is always
    // on stops being read.
    renderMatrix({
      clients: [client(1, 'A'), client(2, 'New', { started_on: '2026-07-15' })],
      checkins: [[1, checkin(1, { adv_score: 5 })]],
    })
    expect(averages()[5].textContent).toBe('5.00')
    expect(averages()[5].textContent).not.toContain('*')
  })

  it('shows no footnote when nothing is asterisked', () => {
    renderMatrix({ checkins: [[1, checkin(1, { comm_score: 4 })]] })
    // Communication is complete for the one client; every other column has
    // nobody scored, which is an em dash rather than an asterisk.
    expect(screen.queryByTestId('matrix-footnote')).toBeNull()
  })

  it('opens a client when their row header is clicked', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    renderMatrix({ clients: [client(7, 'Babaloo')], onOpen })

    await user.click(screen.getByRole('button', { name: 'Babaloo' }))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0].id).toBe(7)
  })

  it('says so plainly when there is no active client to show', () => {
    // Reachable with the archive toggle on and every client archived: Board's
    // empty-roster branch does not fire, because `visible` is not empty.
    renderMatrix({ clients: [client(1, 'Gone', { status: 'churned' })] })
    expect(screen.queryByTestId('matrix-table')).toBeNull()
    expect(screen.getByText(/No active clients/)).toBeTruthy()
  })

  describe("Advocacy's context cell", () => {
    // The half of the column that says WHICH advocacy a client has. "2.00" does
    // not. Owner's design, 2026-09-01.
    const context = () => screen.getByTestId('matrix-context').textContent

    it('lists what the client has, in rubric order', () => {
      renderMatrix({
        checkins: [
          [
            1,
            checkin(1, {
              adv_score: 3,
              adv_would_refer: 5,
              adv_left_review: 5,
              adv_case_study: 1,
              adv_reference_check: 1,
            }),
          ],
        ],
      })
      expect(context()).toBe('Review and Referral')
    })

    it('reads None yet when the bucket is scored and nothing is a Yes', () => {
      renderMatrix({
        checkins: [
          [
            1,
            checkin(1, {
              adv_score: 1,
              adv_left_review: 1,
              adv_case_study: 1,
              adv_would_refer: 1,
              adv_reference_check: 1,
            }),
          ],
        ],
      })
      expect(context()).toBe('None yet')
    })

    it('reads an em dash when the bucket is not scored, like the score beside it', () => {
      // The distinction the whole model rests on: four answered Nos say "None
      // yet", four unasked questions say nothing at all. If these two ever
      // render the same, a gated client reads as a client with no advocacy.
      renderMatrix({ clients: [client(1, 'Babaloo')] })
      expect(context()).toContain('—')
      expect(context()).not.toContain('None yet')
    })

    it('is not banded, because a sentence has no place on a 1-5 scale', () => {
      renderMatrix({
        checkins: [[1, checkin(1, { adv_score: 5, adv_left_review: 5 })]],
      })
      expect(screen.getByTestId('matrix-context').getAttribute('data-band')).toBeNull()
    })

    it('leaves the Advocacy score, and its column average, in place', () => {
      // The reason the column was SPLIT rather than replaced: the vertical scan
      // is what the matrix exists for, and a column of sentences cannot average.
      renderMatrix({
        clients: [client(1, 'A'), client(2, 'B')],
        checkins: [
          [1, checkin(1, { adv_score: 5, adv_left_review: 5 })],
          [2, checkin(2, { adv_score: 1 })],
        ],
      })
      expect(averages()[5].textContent).toBe('3.00')
    })
  })
})
