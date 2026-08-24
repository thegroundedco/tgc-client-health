// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClientCard } from './ClientCard'
import { PILLARS } from '../lib/score'

afterEach(() => {
  document.body.innerHTML = ''
})

const CLIENT = { id: 7, name: 'Polar Divide', status: 'active' }
const ME = '11111111-1111-1111-1111-111111111111'

const bars = () => screen.getAllByTestId('pillar-bar')
const nameButton = () => screen.getByRole('button', { name: /Polar Divide/ })

describe('a client card', () => {
  it('shows an em dash for the total when there is no check-in', () => {
    render(<ClientCard checkin={null} client={CLIENT} onOpen={() => {}} viewerId={ME} />)

    expect(screen.getByText('Polar Divide')).toBeTruthy()
    // Not a 0: an unscored client is not a client scoring zero, and a false
    // "at risk" is as harmful as a false "healthy".
    expect(screen.getByTestId('total').textContent).toBe('—')
    expect(screen.getByText('Not started')).toBeTruthy()
  })

  it('shows the total from the row, and the band with its text label', () => {
    render(
      <ClientCard
        checkin={{
          total_score: 21,
          submitted_at: '2026-08-21T17:04:00.000Z',
          submitted_by: ME,
          relationship: 5,
          delivery: 4,
          financial: 4,
          sentiment: 4,
          growth: 4,
        }}
        client={CLIENT}
        onOpen={() => {}}
        viewerId={ME}
      />,
    )

    expect(screen.getByTestId('total').textContent).toBe('21')
    // The band must never be colour alone: teal against warm red measures
    // 1.76:1, so any two bands are indistinguishable without the label.
    expect(screen.getByText('Healthy')).toBeTruthy()
    expect(screen.getByText(/^Submitted .* by you$/)).toBeTruthy()
  })

  it('draws one bar per pillar, labelled, with the unscored ones marked', () => {
    render(
      <ClientCard
        checkin={{
          total_score: null,
          submitted_at: null,
          submitted_by: null,
          relationship: 5,
          delivery: 1,
          financial: null,
          sentiment: null,
          growth: null,
        }}
        client={CLIENT}
        onOpen={() => {}}
        viewerId={ME}
      />,
    )

    expect(bars()).toHaveLength(PILLARS.length)
    // A bar's height cannot be read aloud, so the label is the content and the
    // bar is the decoration -- not the other way round.
    expect(bars()[0].getAttribute('aria-label')).toMatch(/Relationship: 5 of 5/)
    expect(bars()[1].getAttribute('aria-label')).toMatch(/Delivery: 1 of 5/)
    expect(bars()[2].getAttribute('aria-label')).toMatch(/Financial: not scored/)
    expect(screen.getByText('Draft, 2 of 5 scored')).toBeTruthy()
  })

  it('keeps the bars in rubric order, not in the order the row happens to arrive', () => {
    // The row is an object, so its key order is whatever PostgREST returned.
    // The bars must follow PILLARS, because the reader compares the same
    // position across eleven cards.
    render(
      <ClientCard
        checkin={{
          growth: 1,
          relationship: 5,
          total_score: null,
          submitted_at: null,
          submitted_by: null,
        }}
        client={CLIENT}
        onOpen={() => {}}
        viewerId={ME}
      />,
    )

    const labels = bars().map((bar) => bar.getAttribute('aria-label'))
    expect(labels[0]).toMatch(/^Relationship/)
    expect(labels[4]).toMatch(/^Growth/)
  })

  // The owner's finding on the deployed board: the bars carried their mapping
  // in an aria-label, so a screen reader knew which bar was which and a sighted
  // reader got five anonymous columns. I had tested the label and never asked
  // whether a person could see the mapping.
  it('puts each pillar initial under its bar, in rubric order', () => {
    render(<ClientCard checkin={null} client={CLIENT} onOpen={() => {}} viewerId={ME} />)

    expect(screen.getAllByTestId('pillar-initial').map((node) => node.textContent)).toEqual([
      'R',
      'D',
      'F',
      'S',
      'G',
    ])
  })

  it('does not read the initial out on top of the bar label', () => {
    render(<ClientCard checkin={null} client={CLIENT} onOpen={() => {}} viewerId={ME} />)

    // The letter is for the eye. The bar keeps role="img" with the full name, so
    // a screen reader hears "Financial: not scored" and not "F" after it.
    for (const initial of screen.getAllByTestId('pillar-initial')) {
      expect(initial.getAttribute('aria-hidden')).toBe('true')
    }
    expect(bars()[2].getAttribute('aria-label')).toMatch(/^Financial:/)
  })

  it('opens the check-in when the card is clicked', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<ClientCard checkin={null} client={CLIENT} onOpen={onOpen} viewerId={ME} />)

    await user.click(nameButton())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('is one tab stop, and opens on Enter', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<ClientCard checkin={null} client={CLIENT} onOpen={onOpen} viewerId={ME} />)

    await user.tab()
    expect(document.activeElement).toBe(nameButton())

    // One card, one stop. Two would mean a duplicate target -- the thing that
    // went wrong in the pillar rows and took a browser to find.
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
    render(<ClientCard checkin={null} client={CLIENT} onOpen={() => {}} viewerId={ME} />)

    const total = screen.getByTestId('total')
    expect(total.className.split(/\s+/)).toContain('t-score')
    expect(total.className).not.toContain('t-display')
    expect(total.getAttribute('style')).toBeNull()
  })

  it('has no button labelled Score all 3s', () => {
    // The control this whole slice exists to remove. It wrote a constant, so it
    // was a guaranteed no-op whenever the data already matched.
    render(<ClientCard checkin={null} client={CLIENT} onOpen={() => {}} viewerId={ME} />)
    expect(screen.queryByRole('button', { name: /Score all 3s/i })).toBeNull()
  })

  it('is the only interactive thing on the card', () => {
    // The overlay makes the whole card clickable by covering it. Anything else
    // interactive would sit under that overlay and stop responding -- which is
    // why Score all 3s needed a stacking rule, and why nothing should need one
    // again.
    render(
      <ClientCard
        checkin={{ total_score: 15, submitted_at: null, submitted_by: null, relationship: 3 }}
        client={CLIENT}
        onOpen={() => {}}
        viewerId={ME}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})

describe('an archived client card', () => {
  const ARCHIVED = { id: 8, name: 'Test Client', status: 'former' }
  const PAUSED = { id: 9, name: 'Bellwether', status: 'paused' }

  it('marks an active card with no status pill, so the working roster stays quiet', () => {
    render(<ClientCard checkin={null} client={CLIENT} onOpen={() => {}} viewerId={ME} />)

    // The default case carries no marker: eleven identical pills reading ACTIVE
    // would be noise on the screen whose whole job is the active roster.
    expect(screen.queryByTestId('card-status')).toBeNull()
  })

  it('names the status in words, not only as a colour', () => {
    // Parent spec §9.3: the brand's status fills are within 1.9:1 of each other,
    // so the distinction rests on hue plus a mandatory text label. A pill with
    // no word is unreadable in greyscale and to a colour-blind viewer.
    render(<ClientCard checkin={null} client={ARCHIVED} onOpen={() => {}} viewerId={ME} />)

    expect(screen.getByTestId('card-status').textContent).toBe('Former')
  })

  it('does not offer the name as a button', async () => {
    // checkins_insert_edit_scores has no status predicate, so the database would
    // accept a check-in for a client who left. This is the only thing that
    // stops one being written.
    const onOpen = vi.fn()
    render(<ClientCard checkin={null} client={ARCHIVED} onOpen={onOpen} viewerId={ME} />)

    expect(screen.queryByRole('button', { name: /Test Client/ })).toBeNull()
    // Still legible, and still a heading: the card must remain findable and
    // readable, it just is not a link.
    expect(screen.getByRole('heading', { name: 'Test Client' })).toBeTruthy()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('says why it cannot be scored', async () => {
    render(<ClientCard checkin={null} client={ARCHIVED} onOpen={() => {}} viewerId={ME} />)

    expect(screen.getByTestId('card-locked').textContent).toContain('cannot be scored')
  })

  it('gives a paused client its own reason, not a churned one', async () => {
    render(<ClientCard checkin={null} client={PAUSED} onOpen={() => {}} viewerId={ME} />)

    expect(screen.getByTestId('card-status').textContent).toBe('Paused')
    expect(screen.getByTestId('card-locked').textContent).toContain('paused')
  })

  it('still shows the scores a former client did have', async () => {
    // Their history is unchanged, and hiding it would make the card look like a
    // client who was never scored.
    render(
      <ClientCard
        checkin={{
          total_score: 21,
          submitted_at: '2026-08-21T17:04:00.000Z',
          submitted_by: ME,
          relationship: 5,
          delivery: 4,
          financial: 4,
          sentiment: 4,
          growth: 4,
        }}
        client={ARCHIVED}
        onOpen={() => {}}
        viewerId={ME}
      />,
    )

    expect(screen.getByTestId('total').textContent).toBe('21')
  })

  it('keeps the open button on an active card', async () => {
    // The regression guard for the branch above: an implementation that removed
    // the button for everyone would pass every test in the archived block.
    const onOpen = vi.fn()
    render(<ClientCard checkin={null} client={CLIENT} onOpen={onOpen} viewerId={ME} />)

    await userEvent.click(screen.getByRole('button', { name: /Polar Divide/ }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('card-locked')).toBeNull()
  })
})
