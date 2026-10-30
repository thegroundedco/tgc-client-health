// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/useProfile'
import type { UseCheckin } from './useCheckin'

// The defect this file exists to catch, stated as the scenario the owner hit:
// a viewer opened a check-in, changed every score, pressed submit, and only
// then met checkins_insert_edit_scores refusing the write. The database was
// never wrong -- nothing was written -- but the screen offered controls that
// could not work. src/checkin/CheckIn.test.tsx (renderToStaticMarkup) already
// proves the save-status region and the gate's copy read correctly for every
// state; it does not touch component internals like `disabled` at all. This
// file renders the real component tree in jsdom (no mocked QuestionRow) with
// useCheckin mocked -- same seam CheckIn.test.tsx uses -- and reads the
// rendered DOM the way a reviewer opening the deployed page would: disabled
// attributes and visible text, never internal props or state.
const hookState = vi.hoisted(() => ({ current: null as UseCheckin | null }))

vi.mock('./useCheckin', () => ({
  useCheckin: () => hookState.current,
}))

// The end-client panel mounted in CheckIn pulls in useStatusChange and, through
// it, lib/supabase, which throws at module scope with no VITE_ env. This file
// is about the check-in screen, not the panel, so the hook is stubbed idle.
const statusChange = vi.hoisted(() => ({
  apply: vi.fn(async (_change: unknown) => true),
  state: { kind: 'idle' } as { kind: string; message?: string },
}))
vi.mock('../clients/useStatusChange', () => ({
  useStatusChange: () => ({ state: statusChange.state, apply: statusChange.apply }),
}))

// The suggestion banner mounted in CheckIn pulls in useConfirmSuggestion and,
// through it, lib/supabase, which throws at module scope with no VITE_ env.
vi.mock('./useConfirmSuggestion', () => ({
  useConfirmSuggestion: () => ({ state: { kind: 'idle' }, confirm: async () => true }),
}))

// The run and revert controls mounted in CheckIn pull in lib/supabase through
// useAiRun and useRevertSuggestion; stubbed idle here, tested in their own files.
vi.mock('../ai/useAiRun', () => ({
  useAiRun: () => ({ run: null, state: 'idle', start: async () => ({ ok: true }), starting: false }),
}))
vi.mock('./useRevertSuggestion', () => ({
  useRevertSuggestion: () => ({ state: { kind: 'idle' }, revert: async () => {} }),
}))

// Finance suggestion reads Supabase; stubbed, controllable per test.
const finance = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('./useFinanceSuggestion', () => ({
  useFinanceSuggestion: () => finance.current,
}))

const { CheckIn } = await import('./CheckIn')

afterEach(() => {
  finance.current = null
  document.body.innerHTML = ''
  statusChange.apply.mockReset()
  statusChange.apply.mockResolvedValue(true)
  statusChange.state = { kind: 'idle' }
})

const PERIOD = '2026-08-01'
// Long clear of the gate, so a test not about the gate itself gets every
// question enabled or disabled purely by role, with no Advocacy-shaped
// surprise mixed in.
const CLIENT = { id: 1, name: 'Acme', status: 'active', started_on: '2020-01-01' }

function profile(role: Profile['role']): Profile {
  return {
    id: 'profile-1',
    email: 'sam@example.com',
    full_name: 'Sam Someone',
    is_active: true,
    role,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

// One question already scored and a note already typed, so this is exactly
// the shape the owner hit: a form with real content on screen, not an empty
// one where "nothing to save" would be doing the blocking instead of
// canEdit.
function mockCheckin(overrides: Partial<UseCheckin> = {}): UseCheckin {
  return {
    status: 'ready',
    loadError: null,
    stored: null,
    lastMonth: null,
    lastPeriod: '2026-07-01',
    draft: { answers: { comm_constructive: 4 }, notes: 'Renewal conversation went well.' },
    saveState: { kind: 'dirty' },
    advocacyApplies: true,
    required: 21,
    scored: 1,
    localOverall: null,
    storedOverall: null,
    lastOverall: null,
    hasContent: true,
    storedSubmitted: false,
    storedByYou: false,
    draftPersisted: true,
    unsavedFromEarlierVisit: false,
    setAnswer: vi.fn(),
    setAnswers: vi.fn(),
    setNotes: vi.fn(),
    reload: vi.fn(),
    submit: vi.fn(),
    ...overrides,
  }
}

// The third parameter carries CheckIn's own props (currently just
// onEditClient) rather than widening `overrides`, which is UseCheckin's shape
// and has nothing to do with what CheckIn itself accepts. Defaulted to `{}` so
// every call site above this line, written before onEditClient existed, keeps
// working untouched -- and the no-op default below is what supplies the prop
// for them, now that CheckIn requires it. A test that cares what the press does
// passes its own spy and overrides this.
function renderAs(
  role: Profile['role'],
  overrides: Partial<UseCheckin> = {},
  props: Partial<{ onEditClient: () => void }> = {},
) {
  hookState.current = mockCheckin(overrides)
  return render(
    <CheckIn
      client={CLIENT}
      period={PERIOD}
      profile={profile(role)}
      onBack={() => {}}
      onEditClient={() => {}}
      {...props}
    />,
  )
}

describe('CheckIn, a viewer (no edit_scores)', () => {
  it('renders every question radio disabled', () => {
    renderAs('viewer')
    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBeGreaterThan(0)
    for (const radio of radios) {
      expect((radio as HTMLInputElement).disabled).toBe(true)
    }
  })

  it('renders the Clear button disabled, for the one question already scored', () => {
    renderAs('viewer')
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('renders the notes textarea disabled', () => {
    renderAs('viewer')
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('renders the submit control disabled', () => {
    renderAs('viewer')
    // saveState is 'dirty' with content, so submitLabel is 'Save draft' --
    // asserted by name to prove the reason for the disabled state is canEdit,
    // not some other case (SAVING renders no accessible button at all, and an
    // empty form would also block, but this fixture has content).
    expect(
      (screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('states the reason on screen, near the disabled controls', () => {
    renderAs('viewer')
    const notice = screen.getByText(/you can view this client.s scores, but you can.t score/i)
    expect(notice).toBeTruthy()
    expect(notice.textContent).toMatch(/admin can change/i)
    // Written for a non-technical reader: the internal name of the thing a
    // viewer lacks never appears on screen.
    expect(document.body.textContent).not.toMatch(/capability/i)
  })
})

describe('CheckIn, an account_manager (holds edit_scores)', () => {
  it('leaves every question radio enabled', () => {
    renderAs('account_manager')
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLInputElement).disabled).toBe(false)
    }
  })

  it('leaves the notes textarea enabled', () => {
    renderAs('account_manager')
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('does not render the read-only notice', () => {
    renderAs('account_manager')
    expect(screen.queryByText(/you can view this client.s scores, but/i)).toBeNull()
  })
})

// The owner: "when I click into a card, I'd love for there to be an option to
// hit edit client and it takes you into the client roster's edit panel." Same
// capability the board checks before offering Add client -- reused rather than
// a second rule about who may edit.
describe('CheckIn, the Edit client button', () => {
  it('offers Edit client to someone who can manage clients', () => {
    const onEditClient = vi.fn()
    renderAs('account_manager', {}, { onEditClient })

    fireEvent.click(screen.getByRole('button', { name: /edit client/i }))
    expect(onEditClient).toHaveBeenCalled()
  })

  // FINAL-REVIEW FINDING 6: onEditClient was optional. Board is the only caller
  // and always passes it, so the optionality bought nothing and cost this: a
  // future caller who forgot it would get a check-in screen with no Edit client
  // button for any admin, with a clean build and a green suite.
  //
  // A TYPE-LEVEL assertion, so it fails `npm run build` rather than this run:
  // the expect-error directive below IS the assertion. Make the prop optional
  // again and that directive becomes unused, and tsc fails on it.
  it('requires onEditClient of every caller, so a forgotten one cannot compile', () => {
    const omitted = (
      // @ts-expect-error -- onEditClient is required; leaving it out is the error.
      <CheckIn client={CLIENT} period={PERIOD} profile={profile('viewer')} onBack={() => {}} />
    )
    expect(omitted.type).toBe(CheckIn)
  })

  it('offers it to nobody else', () => {
    // Capability, never a role string: `can` is the only check in this app.
    renderAs('viewer', {}, { onEditClient: vi.fn() })

    expect(screen.queryByRole('button', { name: /edit client/i })).toBeNull()
  })
})

describe('CheckIn, when the Advocacy gate is shut', () => {
  // The reason is NOT a hook field -- the screen derives it from the
  // client's start date via advocacyGate(). Rendering the real component
  // tree (rather than the string-based CheckIn.test.tsx) is what lets this
  // count radios by section rather than by text.
  it('disables every Advocacy radio and leaves the other 17 enabled', () => {
    hookState.current = mockCheckin({ advocacyApplies: false, required: 17, scored: 0, draft: { answers: {}, notes: '' }, hasContent: false, saveState: { kind: 'clean' } })
    render(
      <CheckIn
        client={{ ...CLIENT, started_on: null }}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
        onEditClient={() => {}}
      />,
    )

    const advocacy = within(screen.getByTestId('bucket-advocacy')).getAllByRole('radio')
    // 4 choice questions x 3 options, now that Advocacy renders ChoiceRow
    // rather than QuestionRow's five-option scale.
    expect(advocacy).toHaveLength(12)
    for (const radio of advocacy) expect((radio as HTMLInputElement).disabled).toBe(true)

    const communication = within(screen.getByTestId('bucket-communication')).getAllByRole('radio')
    for (const radio of communication) expect((radio as HTMLInputElement).disabled).toBe(false)
  })
})

// Fix round 1, Cosmetic 3: this test sets `advocacyApplies: true` against
// CLIENT (started_on 2020-01-01, long clear of the gate) -- it was never
// about the gate being shut, and had been left inside that describe by
// mistake. Its own block, so a reader of either describe's name is told the
// truth about what its tests cover.
describe('CheckIn, the question controls per kind', () => {
  it('renders choice controls for Advocacy and 1-5 for the rest', () => {
    hookState.current = mockCheckin({ advocacyApplies: true })
    render(
      <CheckIn
        client={CLIENT}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
        onEditClient={() => {}}
      />,
    )

    const advocacy = within(screen.getByTestId('bucket-advocacy'))
    expect(advocacy.getAllByRole('radio')).toHaveLength(12) // 4 questions x No/Unsure/Yes
    const communication = within(screen.getByTestId('bucket-communication'))
    expect(communication.getAllByRole('radio')).toHaveLength(15) // 3 x 1-5
  })

  it('draws the choice control for Finances as well as Advocacy', () => {
    hookState.current = mockCheckin({ advocacyApplies: true })
    render(
      <CheckIn
        client={CLIENT}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
        onEditClient={() => {}}
      />,
    )

    const rackRate = screen.getByRole('radiogroup', { name: /Paying rack rate/ })
    expect(within(rackRate).getAllByRole('radio')).toHaveLength(3)
  })

  // The owner asked for anchored ends on 2026-08-31 and they were already
  // there -- he had not seen them, because they scrolled away above question
  // fourteen. Pinning them fixed the scrolling and not the seeing: on
  // 2026-09-01 he confirmed the sticky line worked and asked for the legend
  // inside each bucket instead, under the heading and above the first prompt.
  //
  // Placement itself is still untestable here -- CSS Modules are stubbed under
  // jsdom, so getComputedStyle reports nothing and an assertion on `position`
  // would pass or fail for reasons unrelated to the stylesheet. What IS
  // testable is that the copy survives, which is what a careless change to the
  // legend would break, and that there is now one per scale bucket.
  it('still states both anchors, once per bucket that has a scale', () => {
    hookState.current = mockCheckin({ advocacyApplies: true })
    render(
      <CheckIn
        client={CLIENT}
        period={PERIOD}
        profile={profile('account_manager')}
        onBack={() => {}}
        onEditClient={() => {}}
      />,
    )

    const legends = screen.getAllByTestId('scale-legend')
    expect(legends).toHaveLength(4)
    for (const legend of legends) {
      expect(legend.textContent).toContain('strongly disagree')
      expect(legend.textContent).toContain('strongly agree')
    }
  })
})

// Spec §3: the pause/cancel panel is a manage_clients control on the READY
// screen only. useStatusChange is a mock here (tests/supabaseModuleScope.test.ts
// forbids reaching lib/supabase unmocked), so this proves the mount and the two
// props CheckIn hands the panel -- hasCheckin and onPaused -- not the panel's
// own behaviour, which is EndClientPanel.dom.test.tsx's.
describe('CheckIn, the end-client panel', () => {
  it('offers it to someone who can manage clients', () => {
    renderAs('account_manager')
    expect(screen.getByRole('button', { name: 'Cancelled this month' })).toBeTruthy()
  })

  it('does not offer it to a viewer', () => {
    renderAs('viewer')
    expect(screen.queryByRole('button', { name: 'Cancelled this month' })).toBeNull()
  })

  it('does not offer it while the check-in is still loading', () => {
    renderAs('account_manager', { status: 'loading' })
    expect(screen.queryByRole('button', { name: 'Cancelled this month' })).toBeNull()
  })

  it('goes back to the board once a pause has been written', async () => {
    const onBack = vi.fn()
    hookState.current = mockCheckin()
    render(
      <CheckIn client={CLIENT} period={PERIOD} profile={profile('account_manager')} onBack={onBack} onEditClient={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Paused this month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause Acme' }))
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
    expect(statusChange.apply).toHaveBeenCalledWith({ kind: 'pause' })
  })

  it('warns that a month with a stored check-in keeps the client on its board', () => {
    renderAs('account_manager', { stored: { id: 'c1' } as unknown as UseCheckin['stored'] })
    fireEvent.click(screen.getByRole('button', { name: 'Paused this month' }))
    expect(screen.getByText(/already have a check-in/)).toBeTruthy()
  })

  it('does not make that claim when the month has no stored check-in', () => {
    renderAs('account_manager', { stored: null })
    fireEvent.click(screen.getByRole('button', { name: 'Paused this month' }))
    expect(screen.queryByText(/already have a check-in/)).toBeNull()
  })
})

describe('CheckIn, the suggestion banner', () => {
  const flagged = { id: 'c1', suggested_at: '2026-10-29T12:00:00Z' } as unknown as UseCheckin['stored']

  it('offers an enabled Confirm to someone who may score, when the form matches the stored row', () => {
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'clean' } })
    expect(screen.getByText(/Suggested by AI on Oct 29/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables Confirm once an answer has been changed', () => {
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'dirty' } })
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Save them instead/)).toBeTruthy()
  })

  it('disables Confirm when the form opened with an unsaved draft from an earlier visit', () => {
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'clean' }, unsavedFromEarlierVisit: true })
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the line but no Confirm to a viewer', () => {
    renderAs('viewer', { stored: flagged })
    expect(screen.getByText(/Suggested by AI on Oct 29/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
  })
})

describe('CheckIn, finance answers from revenue', () => {
  const SUGGESTION = {
    fin_rack_rate: { value: 1, reason: 'R1' },
    fin_rate_increased: { value: 3, reason: 'R2' },
  }
  const blank = { answers: {}, notes: '' }

  function props(role: Profile['role'] = 'account_manager') {
    return { client: CLIENT, period: PERIOD, profile: profile(role), onBack: () => {}, onEditClient: () => {} }
  }

  it('fills both blank answers in ONE setAnswers call and shows both reasons', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', { draft: blank })
    const h = hookState.current as UseCheckin
    expect(h.setAnswers).toHaveBeenCalledTimes(1)
    expect(h.setAnswers).toHaveBeenCalledWith({ fin_rack_rate: 1, fin_rate_increased: 3 })
    expect(h.setAnswer).not.toHaveBeenCalled()
    const hints = screen.getAllByTestId('answer-hint')
    expect(hints.map((n) => n.textContent)).toEqual(['R1', 'R2'])
    expect(within(screen.getByText('Paying rack rate.').closest('section') as HTMLElement).getByText('R1')).toBeTruthy()
  })

  it('skips an answer the database already holds', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', {
      draft: blank,
      stored: { fin_rack_rate: 5 } as unknown as UseCheckin['stored'],
    })
    expect((hookState.current as UseCheckin).setAnswers).toHaveBeenCalledTimes(1)
    expect((hookState.current as UseCheckin).setAnswers).toHaveBeenCalledWith({ fin_rate_increased: 3 })
  })

  it('skips an answer the form already holds', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', { draft: { answers: { fin_rack_rate: 3 }, notes: '' } })
    expect((hookState.current as UseCheckin).setAnswers).toHaveBeenCalledWith({ fin_rate_increased: 3 })
  })

  it('does not refill after the person clears; a new period or client fills again', () => {
    finance.current = SUGGESTION
    hookState.current = mockCheckin({ draft: blank })
    const first = hookState.current
    const { rerender } = render(<CheckIn {...props()} />)
    expect(first.setAnswers).toHaveBeenCalledTimes(1)

    // Same visit, draft still blank (as if cleared), same finance object.
    const cleared = mockCheckin({ draft: { answers: {}, notes: '' } })
    hookState.current = cleared
    rerender(<CheckIn {...props()} />)
    expect(cleared.setAnswers).not.toHaveBeenCalled()
    expect(first.setAnswers).toHaveBeenCalledTimes(1)

    const nextPeriod = mockCheckin({ draft: blank })
    hookState.current = nextPeriod
    rerender(<CheckIn {...props()} period="2026-09-01" />)
    expect(nextPeriod.setAnswers).toHaveBeenCalledTimes(1)

    const otherClient = mockCheckin({ draft: blank })
    hookState.current = otherClient
    rerender(<CheckIn {...props()} client={{ ...CLIENT, id: 2 }} period="2026-09-01" />)
    expect(otherClient.setAnswers).toHaveBeenCalledTimes(1)
  })

  it('does not fill for a viewer, who cannot edit, though the hint may show', () => {
    finance.current = SUGGESTION
    renderAs('viewer', { draft: blank })
    expect((hookState.current as UseCheckin).setAnswers).not.toHaveBeenCalled()
  })

  it('does nothing without a suggestion', () => {
    renderAs('account_manager', { draft: blank })
    expect((hookState.current as UseCheckin).setAnswers).not.toHaveBeenCalled()
    expect(screen.queryAllByTestId('answer-hint')).toHaveLength(0)
  })

  it('does nothing while loading', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', { status: 'loading', draft: blank })
    expect((hookState.current as UseCheckin).setAnswers).not.toHaveBeenCalled()
  })

  it('puts a hint on no other question', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', { draft: blank })
    expect(screen.getAllByTestId('answer-hint')).toHaveLength(2)
  })

  // The seam with suggested check-ins: Confirm is only offered while the form
  // matches the stored row, so a fill over a stored answer would disable it.
  it('does not fill, and leaves Confirm enabled, on a suggested row that already holds both answers', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', {
      stored: { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', fin_rack_rate: 5, fin_rate_increased: 1 } as unknown as UseCheckin['stored'],
      // Draft deliberately lacks the keys: the draft guard alone would not
      // catch this, so the test isolates the stored-row guard.
      draft: blank,
      saveState: { kind: 'clean' },
    })
    expect((hookState.current as UseCheckin).setAnswers).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('fills both keys once on a suggested row whose finance answers are null', () => {
    finance.current = SUGGESTION
    renderAs('account_manager', {
      stored: { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', fin_rack_rate: null, fin_rate_increased: null } as unknown as UseCheckin['stored'],
      draft: blank,
      saveState: { kind: 'clean' },
    })
    const h = hookState.current as UseCheckin
    expect(h.setAnswers).toHaveBeenCalledTimes(1)
    expect(h.setAnswers).toHaveBeenCalledWith({ fin_rack_rate: 1, fin_rate_increased: 3 })
  })
})

describe('CheckIn, run and revert controls', () => {
  const ai = { suggested_at: '2026-10-28T12:00:00Z', run_id: 1, notes: 'n', answers: {} }
  const manualRow = { id: 'c1', suggested_at: null, ai_suggestion: ai } as unknown as UseCheckin['stored']

  it('offers both to someone who may score a reviewed row with an AI copy', () => {
    renderAs('account_manager', { stored: manualRow, saveState: { kind: 'clean' } })
    expect((screen.getByRole('button', { name: 'Run AI score for this client' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Revert to AI suggested scores' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a manual row asks before overwriting', () => {
    renderAs('account_manager', { stored: manualRow, saveState: { kind: 'clean' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run AI score for this client' }))
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeTruthy()
  })

  it('offers neither to a viewer', () => {
    renderAs('viewer', { stored: manualRow })
    expect(screen.queryByRole('button', { name: 'Run AI score for this client' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revert to AI suggested scores' })).toBeNull()
  })

  it('disables both with unsaved changes', () => {
    renderAs('account_manager', { stored: manualRow, saveState: { kind: 'dirty' } })
    expect((screen.getByRole('button', { name: 'Run AI score for this client' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Revert to AI suggested scores' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText('You have unsaved changes. Save them first.')).toHaveLength(2)
  })

  it('hides revert on a row awaiting review', () => {
    const flagged = { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', ai_suggestion: ai } as unknown as UseCheckin['stored']
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'clean' } })
    expect(screen.queryByRole('button', { name: 'Revert to AI suggested scores' })).toBeNull()
  })
})
