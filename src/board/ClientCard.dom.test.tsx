// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientCard } from './ClientCard'
import type { CardCheckin } from './cardSummary'
import type { BoardClient, BoardScore } from './useBoard'

afterEach(() => {
  document.body.innerHTML = ''
})

const CLIENT: BoardClient = { id: 7, name: 'Polar Divide', status: 'active', started_on: null }
const ME = '11111111-1111-1111-1111-111111111111'

// Defaults a client past its 90 days, no check-in and no score -- the emptiest
// card the board draws. Every test overrides only what it is testing, so a
// future prop addition costs one line here rather than eighteen call sites.
type RenderOptions = {
  client?: BoardClient
  checkin?: CardCheckin | null
  score?: BoardScore | null
  viewerId?: string
  onOpen?: () => void
}

function renderCard(overrides: RenderOptions = {}) {
  const {
    client = CLIENT,
    checkin = null,
    score = null,
    viewerId = ME,
    onOpen = () => {},
  } = overrides
  return render(
    <ClientCard checkin={checkin} client={client} onOpen={onOpen} score={score} viewerId={viewerId} />,
  )
}

const bars = () => screen.getAllByTestId('bucket-bar')
const nameButton = () => screen.getByRole('button', { name: /Polar Divide/ })

describe('a client card', () => {
  it('shows an em dash for the total when there is no check-in', () => {
    renderCard({ checkin: null, score: null })

    expect(screen.getByText('Polar Divide')).toBeTruthy()
    // Not a 0: an unscored client is not a client scoring zero, and a false
    // "at risk" is as harmful as a false "healthy".
    expect(screen.getByTestId('total').textContent).toBe('—')
    expect(screen.getByText('Not started')).toBeTruthy()
  })

  it('shows the total from the view, and the band with its text label', () => {
    renderCard({
      checkin: {
        client_id: 7,
        submitted_at: '2026-08-21T17:04:00.000Z',
        submitted_by: ME,
        comm_score: 5,
        growth_score: 4,
        fin_score: 4,
        rel_score: 4,
        del_score: 4,
        adv_score: 4,
      },
      score: { client_id: 7, overall_score: 4, advocacy_applies: true },
    })

    // Two decimals, matching what the view stores: 4 and 4.00 are the same
    // number but only one of them lines up in a column of eleven cards.
    expect(screen.getByTestId('total').textContent).toBe('4.00')
    // The band must never be colour alone: teal against warm red measures
    // 1.76:1, so any two bands are indistinguishable without the label.
    expect(screen.getByText('Healthy')).toBeTruthy()
    expect(screen.getByText(/^Submitted .* by you$/)).toBeTruthy()
  })

  it('draws one bar per bucket, labelled, with the unscored ones marked', () => {
    renderCard({
      checkin: {
        client_id: 7,
        submitted_at: null,
        submitted_by: null,
        comm_score: 5,
        growth_score: 1,
        fin_score: null,
        rel_score: null,
        del_score: null,
        adv_score: null,
        // Raw answers drive the footer's count; the bucket scores above drive
        // the bars. The two are independent columns in real rows too.
        comm_constructive: 5,
        growth_hitting_goals: 1,
      },
      score: { client_id: 7, overall_score: null, advocacy_applies: true },
    })

    expect(bars()).toHaveLength(6)
    // A bar's height cannot be read aloud, so the label is the content and the
    // bar is the decoration -- not the other way round.
    expect(bars()[0].getAttribute('aria-label')).toMatch(/Communication: 5 of 5/)
    expect(bars()[1].getAttribute('aria-label')).toMatch(/Growth: 1 of 5/)
    expect(bars()[2].getAttribute('aria-label')).toMatch(/Finances: not scored/)
    expect(screen.getByText('Draft, 2 of 22 scored')).toBeTruthy()
  })

  it('keeps the bars in rubric order, not in the order the row happens to arrive', () => {
    // The row is an object, so its key order is whatever PostgREST returned.
    // The bars must follow BUCKETS, because the reader compares the same
    // position across eleven cards.
    renderCard({
      checkin: {
        growth_score: 1,
        rel_score: 5,
        client_id: 7,
        submitted_at: null,
        submitted_by: null,
      },
      score: { client_id: 7, overall_score: null, advocacy_applies: true },
    })

    const labels = bars().map((bar) => bar.getAttribute('aria-label'))
    expect(labels[0]).toMatch(/^Communication/)
    expect(labels[1]).toMatch(/^Growth/)
    expect(labels[3]).toMatch(/^Relationship/)
    expect(labels[5]).toMatch(/^Advocacy/)
  })

  // The owner's finding on the deployed board: the bars carried their mapping
  // in an aria-label, so a screen reader knew which bar was which and a sighted
  // reader got five anonymous columns. I had tested the label and never asked
  // whether a person could see the mapping.
  it('puts each bucket initial under its bar, in rubric order', () => {
    renderCard({ score: { client_id: 7, overall_score: null, advocacy_applies: true } })

    expect(screen.getAllByTestId('bucket-initial').map((node) => node.textContent)).toEqual([
      'C',
      'G',
      'F',
      'R',
      'D',
      'A',
    ])
  })

  it('does not read the initial out on top of the bar label', () => {
    renderCard({ score: { client_id: 7, overall_score: null, advocacy_applies: true } })

    // The letter is for the eye. The bar keeps role="img" with the full name, so
    // a screen reader hears "Finances: not scored" and not "F" after it.
    for (const initial of screen.getAllByTestId('bucket-initial')) {
      expect(initial.getAttribute('aria-hidden')).toBe('true')
    }
    expect(bars()[2].getAttribute('aria-label')).toMatch(/^Finances:/)
  })

  it('opens the check-in when the card is clicked', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    renderCard({ onOpen })

    await user.click(nameButton())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('is one tab stop, and opens on Enter', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    renderCard({ onOpen })

    await user.tab()
    expect(document.activeElement).toBe(nameButton())

    // One card, one stop. Two would mean a duplicate target -- the thing that
    // went wrong in the bucket rows and took a browser to find.
    await user.tab()
    expect(document.activeElement).not.toBe(nameButton())

    // Enter on the focused button, not a click: a keyboard user never clicks,
    // and a div with an onClick would pass the test above and fail this one.
    await user.tab()
    expect(document.activeElement).toBe(nameButton())
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('sizes the total from the .t-score role, not a local override', () => {
    // Why this is worth a test. The size used to come from .t-display plus a
    // local font-size in Board.module.css, at equal specificity -- so it only
    // won because that file loaded after base.css. Moving the card into its own
    // module is exactly the edit that reshuffles the order, and the number
    // would have rendered a quarter larger with every other test still green
    // (--step-4 is 2.4414rem against --step-3's 1.9531rem, measured
    // 2026-08-22). This pins the fix: the role does the sizing, and nothing
    // local competes with it.
    renderCard()

    const total = screen.getByTestId('total')
    expect(total.className.split(/\s+/)).toContain('t-score')
    expect(total.className).not.toContain('t-display')
    expect(total.getAttribute('style')).toBeNull()
  })

  it('has no button labelled Score all 3s', () => {
    // The control this whole slice exists to remove. It wrote a constant, so it
    // was a guaranteed no-op whenever the data already matched.
    renderCard()
    expect(screen.queryByRole('button', { name: /Score all 3s/i })).toBeNull()
  })

  it('is the only interactive thing on the card', () => {
    // The overlay makes the whole card clickable by covering it. Anything else
    // interactive would sit under that overlay and stop responding -- which is
    // why Score all 3s needed a stacking rule, and why nothing should need one
    // again.
    renderCard({
      checkin: { client_id: 7, submitted_at: null, submitted_by: null, comm_score: 3 },
      score: { client_id: 7, overall_score: null, advocacy_applies: true },
    })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  // Six bars when the gate is open, and every one of them labelled.
  it('draws six bars for a client past 90 days', () => {
    renderCard({
      client: { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' },
      checkin: {
        client_id: 1,
        submitted_at: null,
        submitted_by: null,
        comm_score: 4,
        growth_score: 3,
        fin_score: 5,
        rel_score: 2,
        del_score: 4,
        adv_score: 1,
      },
      score: { client_id: 1, overall_score: 3.5, advocacy_applies: true },
    })
    expect(screen.getAllByTestId('bucket-bar')).toHaveLength(6)
  })

  // FIVE bars and a sentence -- not six with an empty one, which reads as a
  // zero.
  it('draws five bars and a note for a client inside 90 days', () => {
    renderCard({
      client: { id: 1, name: 'Acme', status: 'active', started_on: '2026-08-01' },
      checkin: { client_id: 1, submitted_at: null, submitted_by: null, comm_score: 4 },
      score: { client_id: 1, overall_score: 3.5, advocacy_applies: false },
    })
    expect(screen.getAllByTestId('bucket-bar')).toHaveLength(5)
    expect(screen.queryByTestId('card-gated')).not.toBeNull()
  })

  it('names the six buckets in rubric order, so a reader compares positions across cards', () => {
    renderCard({
      client: { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' },
      checkin: {
        client_id: 1,
        submitted_at: null,
        submitted_by: null,
        comm_score: 4,
        growth_score: 3,
        fin_score: 5,
        rel_score: 2,
        del_score: 4,
        adv_score: 1,
      },
      score: { client_id: 1, overall_score: 3.5, advocacy_applies: true },
    })
    const initials = screen.getAllByTestId('bucket-initial').map((n) => n.textContent)
    expect(initials).toEqual(['C', 'G', 'F', 'R', 'D', 'A'])
  })

  // Four Nos is adv_score 1.00 -- a real, low bar, NOT an absent one.
  it('draws a bar for an Advocacy score of 1', () => {
    renderCard({
      client: { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' },
      checkin: { client_id: 1, submitted_at: null, submitted_by: null, adv_score: 1 },
      score: { client_id: 1, overall_score: 3.5, advocacy_applies: true },
    })
    const advocacy = screen.getAllByTestId('bucket-bar')[5]
    expect(advocacy.getAttribute('aria-label')).toBe('Advocacy: 1 of 5')
  })

  // ...and an unanswered Advocacy question is adv_score null, which is not a
  // score.
  it('says not scored for a null bucket', () => {
    renderCard({
      client: { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' },
      checkin: { client_id: 1, submitted_at: null, submitted_by: null, adv_score: null },
      score: { client_id: 1, overall_score: 3.5, advocacy_applies: true },
    })
    const advocacy = screen.getAllByTestId('bucket-bar')[5]
    expect(advocacy.getAttribute('aria-label')).toBe('Advocacy: not scored')
  })

  it('shows the overall from the view, to two decimals, out of 5', () => {
    renderCard({
      checkin: { client_id: 7, submitted_at: null, submitted_by: null },
      score: { client_id: 7, overall_score: 3.5, advocacy_applies: true },
    })
    expect(screen.getByTestId('total').textContent).toBe('3.50')
  })

  // An em dash, never a 0. A false "at risk" is as harmful as a false
  // "healthy".
  it('shows an em dash and Not scored when there is no overall', () => {
    renderCard({
      client: { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' },
      checkin: null,
      score: null,
    })
    expect(screen.getByTestId('total').textContent).toBe('—')
    expect(screen.getByText('Not scored')).not.toBeNull()
  })

  // The band thresholds moved with the scale: 3.6 and 2.2 on 1-5, not 18 and 11
  // out of 25. A card reading the old thresholds would call 3.50 healthy.
  it('bands on the 1-5 thresholds', () => {
    renderCard({
      checkin: { client_id: 7, submitted_at: null, submitted_by: null },
      score: { client_id: 7, overall_score: 3.5, advocacy_applies: true },
    })
    expect(screen.getByText('Watch')).not.toBeNull()
  })
})

describe('an archived client card', () => {
  const ARCHIVED: BoardClient = { id: 8, name: 'Test Client', status: 'former', started_on: null }
  const PAUSED: BoardClient = { id: 9, name: 'Bellwether', status: 'paused', started_on: null }

  it('marks an active card with no status pill, so the working roster stays quiet', () => {
    renderCard()

    // The default case carries no marker: eleven identical pills reading ACTIVE
    // would be noise on the screen whose whole job is the active roster.
    expect(screen.queryByTestId('card-status')).toBeNull()
  })

  it('names the status in words, not only as a colour', () => {
    // Parent spec §9.3: the brand's status fills are within 1.9:1 of each other,
    // so the distinction rests on hue plus a mandatory text label. A pill with
    // no word is unreadable in greyscale and to a colour-blind viewer.
    renderCard({ client: ARCHIVED })

    expect(screen.getByTestId('card-status').textContent).toBe('Former')
  })

  it('does not offer the name as a button', async () => {
    // checkins_insert_edit_scores has no status predicate, so the database would
    // accept a check-in for a client who left. This is the only thing that
    // stops one being written.
    const onOpen = vi.fn()
    renderCard({ client: ARCHIVED, onOpen })

    expect(screen.queryByRole('button', { name: /Test Client/ })).toBeNull()
    // Still legible, and still a heading: the card must remain findable and
    // readable, it just is not a link.
    expect(screen.getByRole('heading', { name: 'Test Client' })).toBeTruthy()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('says why it cannot be scored', async () => {
    renderCard({ client: ARCHIVED })

    expect(screen.getByTestId('card-locked').textContent).toContain('cannot be scored')
  })

  it('gives a paused client its own reason, not a churned one', async () => {
    renderCard({ client: PAUSED })

    expect(screen.getByTestId('card-status').textContent).toBe('Paused')
    expect(screen.getByTestId('card-locked').textContent).toContain('paused')
  })

  it('still shows the scores a former client did have', async () => {
    // Their history is unchanged, and hiding it would make the card look like a
    // client who was never scored.
    renderCard({
      client: ARCHIVED,
      checkin: {
        client_id: 8,
        submitted_at: '2026-08-21T17:04:00.000Z',
        submitted_by: ME,
        comm_score: 5,
        growth_score: 4,
        fin_score: 4,
        rel_score: 4,
        del_score: 4,
        adv_score: 4,
      },
      score: { client_id: 8, overall_score: 4, advocacy_applies: true },
    })

    expect(screen.getByTestId('total').textContent).toBe('4.00')
  })

  it('keeps the open button on an active card', async () => {
    // The regression guard for the branch above: an implementation that removed
    // the button for everyone would pass every test in the archived block.
    const onOpen = vi.fn()
    renderCard({ onOpen })

    await userEvent.click(screen.getByRole('button', { name: /Polar Divide/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('card-locked')).toBeNull()
  })
})
