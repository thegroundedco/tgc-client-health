// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/useProfile'
import type { UseCheckin } from './useCheckin'
import { readDraft, writeDraft } from './draftCache'

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
const hookState = vi.hoisted(() => ({ current: null as UseCheckin | null, real: false }))

// `real` switches to the actual hook, against the Supabase fake below, for the
// tests that need the form's own state (spec 2026-11-02 §5: a payment save must
// change the finance answers and nothing else, which a stub cannot show).
vi.mock('./useCheckin', async () => {
  const actual = await vi.importActual<typeof import('./useCheckin')>('./useCheckin')
  return {
    useCheckin: (...args: Parameters<typeof actual.useCheckin>) =>
      hookState.real ? actual.useCheckin(...args) : hookState.current,
  }
})

// Only the real useCheckin reaches this: the two reads its load() makes.
const checkinRows = vi.hoisted(() => ({ current: [] as unknown[] }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: table === 'checkins' ? checkinRows.current : [], error: null }),
        }),
      }),
    }),
  },
}))

// The payments box (spec 2026-11-02 §3) reads through useMonthPayment. Stubbed
// as a seam, honouring canRead the way the real hook does ('off', no query).
const payments = vi.hoisted(() => ({
  calls: [] as [number, string, boolean][],
  save: null as null | ((p: unknown) => Promise<{ ok: true } | { ok: false; error: string }>),
}))
vi.mock('../revenue/useMonthPayment', () => ({
  useMonthPayment: (clientId: number, period: string, canRead: boolean) => {
    payments.calls.push([clientId, period, canRead])
    return {
      status: canRead ? 'ready' : 'off',
      loadError: null,
      row: null,
      storedRetainer: 400000,
      enteredByName: null,
      save: async (p: unknown) => (payments.save ? payments.save(p) : { ok: true }),
      reload: () => {},
    }
  },
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
const runs = vi.hoisted(() => ({ onFinished: (() => {}) as () => void }))
vi.mock('../ai/useAiRun', () => ({
  useAiRun: (_period: string, onFinished: () => void) => {
    runs.onFinished = onFinished
    return { run: null, state: 'idle', start: async () => ({ ok: true }), starting: false }
  },
}))
const reverts = vi.hoisted(() => ({
  revert: vi.fn(async (_args: unknown) => {}),
  onSuccess: null as null | (() => void),
}))
vi.mock('./useRevertSuggestion', async () => {
  const { useState } = await import('react')
  return {
    useRevertSuggestion: () => {
      const [state, setState] = useState<{ kind: string }>({ kind: 'idle' })
      return {
        state,
        revert: async (args: unknown) => {
          await reverts.revert(args)
          setState({ kind: 'reverted' })
        },
      }
    },
  }
})

// Finance suggestion reads Supabase; stubbed, controllable per test. `after`
// is what the read returns once a payment save has bumped the version.
const finance = vi.hoisted(() => ({ current: null as unknown, after: null as unknown, versions: [] as number[] }))
vi.mock('./useFinanceSuggestion', () => ({
  useFinanceSuggestion: (_c: number, _p: string, _r: boolean, _k: boolean, version = 0) => {
    finance.versions.push(version)
    return version > 0 ? finance.after : finance.current
  },
}))

// Productive hours (spec 2026-11-04 §7). Stubbed as a seam, honouring canRead
// the way the real hook does (null, no request). `byVersion` is what a Try
// again (a bumped version) returns; `current` is the first read.
const hours = vi.hoisted(() => ({
  current: null as unknown,
  byVersion: {} as Record<number, unknown>,
  calls: [] as [number, string, boolean, number][],
}))
vi.mock('./useMonthHours', () => ({
  useMonthHours: (clientId: number, period: string, canRead: boolean, version = 0) => {
    hours.calls.push([clientId, period, canRead, version])
    if (!canRead) return null
    return version in hours.byVersion ? hours.byVersion[version] : hours.current
  },
}))

// A capability can be withheld per test, for the role no preset has today: one
// that may edit scores but not see revenue (Review Focus 5). Everything else
// answers exactly as the real presets do.
const caps = vi.hoisted(() => ({ withheld: [] as string[] }))
vi.mock('../lib/capabilities', async () => {
  const actual = await vi.importActual<typeof import('../lib/capabilities')>('../lib/capabilities')
  return {
    ...actual,
    can: (role: string, capability: Parameters<typeof actual.can>[1]) =>
      caps.withheld.includes(capability) ? false : actual.can(role, capability),
  }
})

const { CheckIn } = await import('./CheckIn')

afterEach(() => {
  finance.current = null
  hours.current = null
  hours.byVersion = {}
  hours.calls.length = 0
  caps.withheld = []
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
    hoursApplies: false,
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

  it('with unsaved changes, disables Run (with its caption) but leaves revert enabled and captionless', () => {
    renderAs('account_manager', { stored: manualRow, saveState: { kind: 'dirty' } })
    expect((screen.getByRole('button', { name: 'Run AI score for this client' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Revert to AI suggested scores' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getAllByText('You have unsaved changes. Save them first.')).toHaveLength(1)
  })

  it('manual row: revert shown and enabled with or without unsaved changes', () => {
    for (const saveState of [{ kind: 'clean' }, { kind: 'dirty' }] as const) {
      cleanup()
      renderAs('account_manager', { stored: manualRow, saveState })
      expect((screen.getByRole('button', { name: 'Revert to AI suggested scores' }) as HTMLButtonElement).disabled).toBe(false)
    }
  })

  it('still-suggested row: revert hidden when clean, shown and enabled when dirty', () => {
    const flagged = { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', ai_suggestion: ai } as unknown as UseCheckin['stored']
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'clean' } })
    expect(screen.queryByRole('button', { name: 'Revert to AI suggested scores' })).toBeNull()
    cleanup()
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'dirty' } })
    expect((screen.getByRole('button', { name: 'Revert to AI suggested scores' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('no parseable ai_suggestion: revert hidden even with unsaved changes', () => {
    const noAi = { id: 'c1', suggested_at: null, ai_suggestion: null } as unknown as UseCheckin['stored']
    renderAs('account_manager', { stored: noAi, saveState: { kind: 'dirty' } })
    expect(screen.queryByRole('button', { name: 'Revert to AI suggested scores' })).toBeNull()
  })

  it('viewer with unsaved changes on a still-suggested row: revert hidden', () => {
    const flagged = { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', ai_suggestion: ai } as unknown as UseCheckin['stored']
    renderAs('viewer', { stored: flagged, saveState: { kind: 'dirty' } })
    expect(screen.queryByRole('button', { name: 'Revert to AI suggested scores' })).toBeNull()
  })

  it('still-suggested row with unsaved changes: Revert gets the stored row, then draft cleared and reloaded', async () => {
    writeDraft(CLIENT.id, PERIOD, { answers: { comm_constructive: 2 }, notes: 'edit' })
    reverts.revert.mockClear()
    const stored = { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', ai_suggestion: ai } as unknown as UseCheckin['stored']
    let seen: unknown = 'unset'
    const reload = vi.fn(() => {
      seen = readDraft(CLIENT.id, PERIOD)
    })
    renderAs('account_manager', { stored, saveState: { kind: 'dirty' }, reload })
    fireEvent.click(screen.getByRole('button', { name: 'Revert to AI suggested scores' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect((reverts.revert.mock.calls[0][0] as { current: unknown }).current).toBe(stored)
    expect(seen).toBeNull()
    window.localStorage.clear()
  })

  it('Cancel with unsaved changes: no revert call, no reload, draft kept', () => {
    writeDraft(CLIENT.id, PERIOD, { answers: { comm_constructive: 2 }, notes: 'edit' })
    reverts.revert.mockClear()
    const reload = vi.fn()
    const stored = { id: 'c1', suggested_at: null, ai_suggestion: ai } as unknown as UseCheckin['stored']
    renderAs('account_manager', { stored, saveState: { kind: 'dirty' }, reload })
    fireEvent.click(screen.getByRole('button', { name: 'Revert to AI suggested scores' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(reverts.revert).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(readDraft(CLIENT.id, PERIOD)).not.toBeNull()
    window.localStorage.clear()
  })

  it('hides revert on a row awaiting review', () => {
    const flagged = { id: 'c1', suggested_at: '2026-10-29T12:00:00Z', ai_suggestion: ai } as unknown as UseCheckin['stored']
    renderAs('account_manager', { stored: flagged, saveState: { kind: 'clean' } })
    expect(screen.queryByRole('button', { name: 'Revert to AI suggested scores' })).toBeNull()
  })

  it('revert receives the STORED row answers as current, not the draft', async () => {
    const stored = { id: 'c1', suggested_at: null, ai_suggestion: ai, fin_rack_rate: 5 } as unknown as UseCheckin['stored']
    renderAs('account_manager', {
      stored,
      saveState: { kind: 'clean' },
      draft: { answers: { fin_rack_rate: 1 }, notes: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Revert to AI suggested scores' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
    await waitFor(() => expect(reverts.revert).toHaveBeenCalledTimes(1))
    expect((reverts.revert.mock.calls[0][0] as { current: unknown }).current).toBe(stored)
  })

  describe('reloading after the stored row is rewritten', () => {
    const seedDraft = () => {
      // A draft that matches the old row: edited, then edited back, never saved.
      writeDraft(CLIENT.id, PERIOD, { answers: { comm_constructive: 2 }, notes: 'old' })
      expect(readDraft(CLIENT.id, PERIOD)).not.toBeNull()
    }
    const reloadSeesDraft = (overrides: Partial<UseCheckin>) => {
      let seen: unknown = 'unset'
      const reload = vi.fn(() => {
        seen = readDraft(CLIENT.id, PERIOD)
      })
      renderAs('account_manager', { ...overrides, reload })
      return { reload, seen: () => seen }
    }
    afterEach(() => {
      window.localStorage.clear()
    })

    it('a successful revert clears the local draft before reloading', async () => {
      seedDraft()
      const stored = { id: 'c1', suggested_at: null, ai_suggestion: ai } as unknown as UseCheckin['stored']
      const r = reloadSeesDraft({ stored, saveState: { kind: 'clean' } })
      fireEvent.click(screen.getByRole('button', { name: 'Revert to AI suggested scores' }))
      fireEvent.click(screen.getByRole('button', { name: 'Revert' }))
      await waitFor(() => expect(r.reload).toHaveBeenCalledTimes(1))
      expect(r.seen()).toBeNull()
    })

    it('a finished run clears the local draft before reloading', () => {
      seedDraft()
      const stored = { id: 'c1', suggested_at: null } as unknown as UseCheckin['stored']
      const r = reloadSeesDraft({ stored, saveState: { kind: 'clean' } })
      act(() => runs.onFinished())
      expect(r.reload).toHaveBeenCalledTimes(1)
      expect(r.seen()).toBeNull()
    })

    it('a run that finishes over unsaved edits neither reloads nor clears the draft', () => {
      seedDraft()
      const stored = { id: 'c1', suggested_at: null } as unknown as UseCheckin['stored']
      const r = reloadSeesDraft({ stored, saveState: { kind: 'dirty' } })
      act(() => runs.onFinished())
      expect(r.reload).not.toHaveBeenCalled()
      expect(readDraft(CLIENT.id, PERIOD)).not.toBeNull()
    })
  })
})

describe('CheckIn, the payments box', () => {
  afterEach(() => {
    payments.calls.length = 0
  })

  // The owner moved the box into Finances on 2026-11-02: inside that section,
  // under its heading and above its first question, and in no other section.
  it('shows the payments box inside Finances, above its questions, for someone who may see revenue', () => {
    renderAs('account_manager')
    expect(payments.calls.at(-1)).toEqual([CLIENT.id, PERIOD, true])
    const heading = screen.getByRole('heading', { name: 'August payments' })
    const finances = screen.getByTestId('bucket-finances')
    expect(finances.contains(heading)).toBe(true)
    const financesHeading = within(finances).getByTestId('bucket-heading')
    const firstQuestion = within(finances).getAllByRole('radiogroup')[0]
    expect(financesHeading.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(heading.compareDocumentPosition(firstQuestion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('heading', { name: /payments/ })).toHaveLength(1)
  })

  it('a viewer gets no payments box and no revenue query', () => {
    renderAs('viewer')
    expect(payments.calls.length).toBeGreaterThan(0)
    expect(payments.calls.every(([, , canRead]) => canRead === false)).toBe(true)
    expect(screen.queryByRole('heading', { name: /payments/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /retainer/ })).toBeNull()
  })
})

// Spec 2026-11-02 §5, through the REAL useCheckin: the form's own state is what
// is under test, so a stubbed hook would prove nothing.
describe('CheckIn, finance answers after a payment save', () => {
  const radio = (key: string, value: number) =>
    document.querySelector(`input[name="question-${key}"][value="${value}"]`) as HTMLInputElement

  async function openAsAdmin() {
    hookState.real = true
    window.localStorage.clear()
    render(
      <CheckIn client={CLIENT} period={PERIOD} profile={profile('admin')} onBack={() => {}} onEditClient={() => {}} />,
    )
    await screen.findByRole('heading', { name: 'August payments' })
  }

  // Leave and come back, keeping localStorage: what a reload restores.
  async function reopenAsAdmin() {
    cleanup()
    render(
      <CheckIn client={CLIENT} period={PERIOD} profile={profile('admin')} onBack={() => {}} onEditClient={() => {}} />,
    )
    await screen.findByRole('heading', { name: 'August payments' })
  }

  async function confirmPayment() {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Confirm .* retainer/ }))
    })
  }

  afterEach(() => {
    hookState.real = false
    checkinRows.current = []
    finance.after = null
    finance.versions.length = 0
    payments.save = null
    window.localStorage.clear()
  })

  it('after a payment save the finance answers take the new values over the stored placeholder', async () => {
    // The AI's "finance pending revenue" placeholders, stored. Before the save
    // the data gives no answer; after it, only the rate change is answered.
    checkinRows.current = [
      { client_id: CLIENT.id, period: PERIOD, fin_rate_increased: 3, fin_rack_rate: 3, comm_timely: 4, notes: null },
    ]
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up on last month.' } }
    await openAsAdmin()
    expect(radio('fin_rate_increased', 3).checked).toBe(true)
    expect(document.getElementById('checkin-save-status')?.textContent).not.toMatch(/Unsaved/)

    await confirmPayment()
    await waitFor(() => expect(radio('fin_rate_increased', 5).checked).toBe(true))
    // The data still gives no rack-rate answer: left alone.
    expect(radio('fin_rack_rate', 3).checked).toBe(true)
    expect(document.getElementById('checkin-save-status')?.textContent).toMatch(/Unsaved changes/)
  })

  it('a payment save keeps unsaved score edits', async () => {
    checkinRows.current = [
      { client_id: CLIENT.id, period: PERIOD, fin_rate_increased: 3, comm_timely: 4, notes: null },
    ]
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up on last month.' } }
    await openAsAdmin()
    fireEvent.click(radio('comm_timely', 2))
    expect(radio('comm_timely', 2).checked).toBe(true)

    await confirmPayment()
    await waitFor(() => expect(radio('fin_rate_increased', 5).checked).toBe(true))
    expect(radio('comm_timely', 2).checked).toBe(true)
  })

  // Fix round 1: the overwrite is persisted, so leaving after a payment save
  // cannot bring the stored placeholder back as an "earlier visit" draft that
  // Save would then write over revenue that now exists.
  it('after a score edit and a payment save, a reload keeps the new finance value', async () => {
    checkinRows.current = [
      { client_id: CLIENT.id, period: PERIOD, fin_rate_increased: 3, comm_timely: 4, notes: null },
    ]
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up on last month.' } }
    await openAsAdmin()
    fireEvent.click(radio('comm_timely', 2))
    await confirmPayment()
    await waitFor(() => expect(radio('fin_rate_increased', 5).checked).toBe(true))

    await reopenAsAdmin()
    await waitFor(() => expect(radio('comm_timely', 2).checked).toBe(true))
    expect(radio('fin_rate_increased', 5).checked).toBe(true)
  })

  it('after a payment save with no typed edit, a reload restores the new value as unsaved', async () => {
    checkinRows.current = [
      { client_id: CLIENT.id, period: PERIOD, fin_rate_increased: 3, comm_timely: 4, notes: null },
    ]
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up on last month.' } }
    await openAsAdmin()
    await confirmPayment()
    await waitFor(() => expect(radio('fin_rate_increased', 5).checked).toBe(true))

    await reopenAsAdmin()
    await waitFor(() => expect(radio('fin_rate_increased', 5).checked).toBe(true))
    expect(screen.getByText(/from an earlier visit on this device and have not been saved/)).toBeTruthy()
  })

  // Spec §5: the payment save changes a finance answer on a row the AI
  // suggested, so the form no longer matches the stored suggestion. Confirm
  // would confirm answers that are not on screen; Save is what remains, and it
  // must stay enabled so the person can still finish.
  it('a payment save that changes a finance answer on a suggested row disables Confirm but not Save', async () => {
    checkinRows.current = [
      {
        id: 'c1',
        client_id: CLIENT.id,
        period: PERIOD,
        suggested_at: '2026-10-29T12:00:00Z',
        fin_rate_increased: 3,
        comm_timely: 4,
        notes: null,
      },
    ]
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up on last month.' } }
    await openAsAdmin()
    const confirm = () => screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
    expect(confirm().disabled).toBe(false)

    await confirmPayment()
    await waitFor(() => expect(radio('fin_rate_increased', 5).checked).toBe(true))
    expect(confirm().disabled).toBe(true)
    expect(screen.getByText(/Save them instead/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a failed payment save changes no answer', async () => {
    checkinRows.current = [{ client_id: CLIENT.id, period: PERIOD, fin_rate_increased: 3, notes: null }]
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up on last month.' } }
    payments.save = async () => ({ ok: false, error: 'Nope.' })
    await openAsAdmin()
    await confirmPayment()
    await screen.findByText('Nope.')
    expect(radio('fin_rate_increased', 3).checked).toBe(true)
    expect(finance.versions.every((v) => v === 0)).toBe(true)
  })
})

// Spec 2026-11-04 §4 and §7: Productive hours in Finances and Hours.
describe('CheckIn, hours from Productive', () => {
  const OCT = '2026-10-01'
  const blank = { answers: {}, notes: '' }
  const LINE = { dealId: 'd1', name: 'Budget A', budgetedHours: 20, workedHours: 21, diffHours: 1, flagged: false }
  const SCORED = {
    applies: true,
    lines: [LINE],
    answer: { value: 2, reason: 'From Productive: 27.5h worked vs 20h budgeted (+7.5h).' },
    note: null,
  }
  const UNREACHABLE = {
    applies: true,
    lines: [],
    answer: null,
    note: "Couldn't reach Productive – answer by hand or try again",
  }
  const NO_BUDGET = { applies: false, reason: 'no_budget', message: 'No fixed monthly budget' }
  const hoursGroup = () => screen.queryByRole('radiogroup', { name: /Hours within budget/ })

  function props(role: Profile['role'] = 'account_manager') {
    return { client: CLIENT, period: OCT, profile: profile(role), onBack: () => {}, onEditClient: () => {} }
  }
  function renderHours(role: Profile['role'], overrides: Partial<UseCheckin> = {}) {
    hookState.current = mockCheckin({ hoursApplies: true, ...overrides })
    return render(<CheckIn {...props(role)} />)
  }

  it('fills Hours within budget once, only when blank in the database and the form', () => {
    hours.current = SCORED
    hookState.current = mockCheckin({ hoursApplies: true, draft: blank })
    const first = hookState.current
    const { rerender } = render(<CheckIn {...props()} />)
    expect(first.setAnswers).toHaveBeenCalledTimes(1)
    expect(first.setAnswers).toHaveBeenCalledWith({ fin_hours_in_budget: 2 })

    // Same visit, cleared by the person: not refilled.
    const cleared = mockCheckin({ hoursApplies: true, draft: { answers: {}, notes: '' } })
    hookState.current = cleared
    rerender(<CheckIn {...props()} />)
    expect(cleared.setAnswers).not.toHaveBeenCalled()

    // A new period fills again.
    const next = mockCheckin({ hoursApplies: true, draft: blank })
    hookState.current = next
    rerender(<CheckIn {...props()} period="2026-11-01" />)
    expect(next.setAnswers).toHaveBeenCalledWith({ fin_hours_in_budget: 2 })
  })

  it('does not fill an answer already in the form', () => {
    hours.current = SCORED
    renderHours('account_manager', { draft: { answers: { fin_hours_in_budget: 5 }, notes: '' } })
    expect((hookState.current as UseCheckin).setAnswers).not.toHaveBeenCalled()
  })

  it('does not overwrite a stored hours answer', () => {
    hours.current = SCORED
    renderHours('account_manager', {
      draft: blank,
      stored: { fin_hours_in_budget: 3, fin_hours_applies: true } as unknown as UseCheckin['stored'],
    })
    expect((hookState.current as UseCheckin).setAnswers).not.toHaveBeenCalled()
  })

  // Withheld from an account manager rather than tested as a viewer: a viewer
  // has no view_revenue either, so the hours would never arrive and the test
  // could not tell the edit_scores guard from the canRead one.
  it('does not fill for someone who cannot edit scores', () => {
    hours.current = SCORED
    caps.withheld = ['edit_scores']
    renderHours('account_manager', { draft: blank })
    expect(hours.calls.at(-1)?.[2]).toBe(true)
    expect((hookState.current as UseCheckin).setAnswers).not.toHaveBeenCalled()
  })

  it('fills hours together with the finance answers in ONE call when both are ready', () => {
    finance.current = { fin_rack_rate: { value: 1, reason: 'R1' } }
    hours.current = SCORED
    renderHours('account_manager', { draft: blank })
    const h = hookState.current as UseCheckin
    expect(h.setAnswers).toHaveBeenCalledTimes(1)
    expect(h.setAnswers).toHaveBeenCalledWith({ fin_rack_rate: 1, fin_hours_in_budget: 2 })
  })

  it('fills hours that arrive after the finance answers were filled', () => {
    finance.current = { fin_rack_rate: { value: 1, reason: 'R1' } }
    hookState.current = mockCheckin({ hoursApplies: true, draft: blank })
    const first = hookState.current
    const { rerender } = render(<CheckIn {...props()} />)
    expect(first.setAnswers).toHaveBeenCalledWith({ fin_rack_rate: 1 })

    hours.current = SCORED
    const later = mockCheckin({ hoursApplies: true, draft: { answers: { fin_rack_rate: 1 }, notes: '' } })
    hookState.current = later
    rerender(<CheckIn {...props()} />)
    expect(later.setAnswers).toHaveBeenCalledTimes(1)
    expect(later.setAnswers).toHaveBeenCalledWith({ fin_hours_in_budget: 2 })
  })

  it('Try again reads the hours again and fills if the answer is still blank', () => {
    hours.current = UNREACHABLE
    hours.byVersion = { 1: SCORED }
    renderHours('account_manager', { draft: blank })
    const h = hookState.current as UseCheckin
    expect(h.setAnswers).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(hours.calls.at(-1)?.[3]).toBe(1)
    expect(h.setAnswers).toHaveBeenCalledWith({ fin_hours_in_budget: 2 })
  })

  it('shows the hours reason as the hint on the hours question', () => {
    hours.current = SCORED
    renderHours('account_manager', { draft: { answers: { fin_hours_in_budget: 2 }, notes: '' } })
    const group = hoursGroup() as HTMLElement
    expect(group.closest('section')?.textContent).toContain('From Productive: 27.5h worked vs 20h budgeted (+7.5h).')
  })

  it('shows the hours box inside Finances and Hours, beside the hours question', () => {
    hours.current = SCORED
    renderHours('account_manager')
    const finances = screen.getByTestId('bucket-finances')
    const box = within(finances).getByTestId('hours-box')
    expect(within(box).getByText('Budget A')).toBeTruthy()
    // Immediately before the hours question in document order, after the rest.
    const rate = screen.getByRole('radiogroup', { name: /Rate vs last month/ })
    expect(rate.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(box.compareDocumentPosition(hoursGroup() as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(hours.calls.at(-1)).toEqual([CLIENT.id, OCT, true, 0])
  })

  it('still shows the box, with its message, when the question is hidden', () => {
    hours.current = NO_BUDGET
    renderHours('account_manager', { hoursApplies: false })
    const finances = screen.getByTestId('bucket-finances')
    expect(within(finances).getByText('No fixed monthly budget')).toBeTruthy()
    expect(hoursGroup()).toBeNull()
  })

  it('labels the section "Finances and Hours"', () => {
    renderHours('account_manager')
    const finances = screen.getByTestId('bucket-finances')
    expect(within(finances).getByTestId('bucket-heading').textContent).toBe('Finances and Hours')
  })

  it('a payment save re-reads finance only: hours are neither overwritten nor re-fetched', async () => {
    hours.current = SCORED
    finance.after = { fin_rate_increased: { value: 5, reason: 'Up.' } }
    renderHours('admin', {
      draft: { answers: { fin_hours_in_budget: 3 }, notes: '' },
      stored: { fin_hours_in_budget: 3, fin_hours_applies: true } as unknown as UseCheckin['stored'],
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Confirm .* retainer/ }))
    })
    const h = hookState.current as UseCheckin
    await waitFor(() => expect(h.setAnswers).toHaveBeenCalledWith({ fin_rate_increased: 5 }, { overwrite: true }))
    for (const [values] of (h.setAnswers as ReturnType<typeof vi.fn>).mock.calls) {
      expect(values).not.toHaveProperty('fin_hours_in_budget')
    }
    expect(hours.calls.every(([, , , v]) => v === 0)).toBe(true)
    finance.after = null
  })
})

// Through the REAL useCheckin, because which questions are asked and what the
// count is against are the hook's to decide; a stub would hand back whatever
// the test told it to.
describe('CheckIn, whether the hours question is asked', () => {
  const OCT = '2026-10-01'
  const NO_BUDGET = { applies: false, reason: 'no_budget', message: 'No fixed monthly budget' }
  const UNREACHABLE = {
    applies: true,
    lines: [],
    answer: null,
    note: "Couldn't reach Productive – answer by hand or try again",
  }
  const hoursGroup = () => screen.queryByRole('radiogroup', { name: /Hours within budget/ })
  const caption = () => screen.getByTestId('overall-caption').textContent

  async function open(client: typeof CLIENT | { id: number; name: string; status: string; started_on: string | null }, role: Profile['role'] = 'account_manager') {
    hookState.real = true
    window.localStorage.clear()
    render(<CheckIn client={client} period={OCT} profile={profile(role)} onBack={() => {}} onEditClient={() => {}} />)
    await screen.findByTestId('overall-caption')
  }

  afterEach(() => {
    hookState.real = false
    checkinRows.current = []
    window.localStorage.clear()
  })

  it('hides the hours question and counts 17/21 when hours do not apply', async () => {
    hours.current = NO_BUDGET
    await open(CLIENT)
    expect(hoursGroup()).toBeNull()
    expect(caption()).toBe('not scored · 0 of 21 answered')
    cleanup()
    await open({ ...CLIENT, started_on: null })
    expect(hoursGroup()).toBeNull()
    expect(caption()).toBe('not scored · 0 of 17 answered')
  })

  it('asks the hours question and counts 18/22 when hours apply', async () => {
    hours.current = UNREACHABLE
    await open(CLIENT)
    expect(hoursGroup()).not.toBeNull()
    expect(caption()).toBe('not scored · 0 of 22 answered')
    cleanup()
    await open({ ...CLIENT, started_on: null })
    expect(caption()).toBe('not scored · 0 of 18 answered')
  })

  it('the hours result wins over the stored flag once it is read', async () => {
    hours.current = NO_BUDGET
    checkinRows.current = [{ client_id: CLIENT.id, period: OCT, fin_hours_applies: true, notes: null }]
    await open(CLIENT)
    expect(hoursGroup()).toBeNull()
  })

  it('shows the hours question from the stored row for an editor without view_revenue', async () => {
    caps.withheld = ['view_revenue']
    checkinRows.current = [{ client_id: CLIENT.id, period: OCT, fin_hours_applies: true, notes: null }]
    await open(CLIENT)
    expect(hoursGroup()).not.toBeNull()
    expect(hours.calls.length).toBeGreaterThan(0)
    expect(hours.calls.every(([, , canRead]) => canRead === false)).toBe(true)
    expect(screen.queryByTestId('hours-box')).toBeNull()
    // And it can still be answered: the editor's controls are live.
    expect(
      (document.querySelector('input[name="question-fin_hours_in_budget"][value="5"]') as HTMLInputElement).disabled,
    ).toBe(false)
  })

  it('hides it from the stored row for that editor when the row says it does not apply', async () => {
    caps.withheld = ['view_revenue']
    checkinRows.current = [{ client_id: CLIENT.id, period: OCT, fin_hours_applies: false, notes: null }]
    await open(CLIENT)
    expect(hoursGroup()).toBeNull()
    expect(caption()).toBe('not scored · 0 of 21 answered')
  })
})
