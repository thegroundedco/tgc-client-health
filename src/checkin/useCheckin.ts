import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { previousPeriod } from '../lib/month'
import { PILLARS, scoredCount, totalScore } from '../lib/score'
import type { Pillar } from '../lib/score'
import type { Profile } from '../auth/useProfile'
import type { Database } from '../types/database'
import { INITIAL_SAVE_STATE, saveReducer } from './saveState'
import type { SaveState } from './saveState'
import {
  EMPTY_DRAFT,
  clearDraft,
  draftsDiffer,
  isDraftEmpty,
  readDraft,
  writeDraft,
} from './draftCache'
import type { Draft, PillarScores } from './draftCache'

export type CheckinRow = Database['public']['Tables']['checkins']['Row']

export type UseCheckin = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  stored: CheckinRow | null
  lastMonth: CheckinRow | null
  lastPeriod: string
  draft: Draft
  saveState: SaveState
  scored: number
  localTotal: number | null
  hasContent: boolean
  storedSubmitted: boolean
  storedByYou: boolean
  draftPersisted: boolean
  unsavedFromEarlierVisit: boolean
  setPillar: (pillar: Pillar, value: number | null) => void
  setNotes: (notes: string) => void
  reload: () => void
  submit: () => void
}

// The form's shape, from a stored row. Kept here rather than in draftCache
// because it is the only place a database row and a local draft meet.
function draftFromRow(row: CheckinRow | null): Draft {
  if (!row) return EMPTY_DRAFT
  const pillars: PillarScores = {}
  for (const pillar of PILLARS) {
    const value = row[pillar]
    if (value !== null) pillars[pillar] = value
  }
  return { pillars, notes: row.notes ?? '' }
}

export function useCheckin(
  clientId: number,
  period: string,
  profile: Profile,
): UseCheckin {
  const lastPeriod = previousPeriod(period)

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stored, setStored] = useState<CheckinRow | null>(null)
  const [lastMonth, setLastMonth] = useState<CheckinRow | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [draftPersisted, setDraftPersisted] = useState(true)
  const [unsavedFromEarlierVisit, setUnsavedFromEarlierVisit] = useState(false)
  const [saveState, dispatch] = useReducer(saveReducer, INITIAL_SAVE_STATE)

  // Read inside submit() to refuse a second concurrent write. The reducer
  // cannot do this: a state update is not visible until the next render, so two
  // presses in the same tick would both see `clean` and both send a request.
  // The button is disabled during a save, which stops the ordinary case; this
  // stops the ordinary case's edges.
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    setStatus('loading')
    // One query for both months. §5.2: fewer round trips and one failure mode
    // rather than three. `.in` rather than two `.eq` calls, so a partial
    // failure -- this month readable, last month not -- is not a state this
    // screen has to have an answer for.
    try {
      const { data, error } = await supabase
        .from('checkins')
        .select('*')
        .eq('client_id', clientId)
        .in('period', [lastPeriod, period])

      if (error) {
        // describeError, not error.message: an empty message is falsy, and the
        // `loadError &&` guard on the screen would miss it and render a form
        // over a failed read. See src/lib/errorText.ts.
        setLoadError(describeError(error))
        setStatus('error')
        return
      }

      const thisMonth = data.find((row) => row.period === period) ?? null
      const previous = data.find((row) => row.period === lastPeriod) ?? null

      // Never write after a failed read: everything below runs only because
      // both of the above succeeded.
      setLoadError(null)
      setStored(thisMonth)
      setLastMonth(previous)

      // §5.5: if a saved row and a local draft disagree, the draft wins and the
      // screen says it has not been saved. The stored row is the fallback, not
      // the default -- somebody typed the draft, and nobody typed the fallback.
      const fromStorage = readDraft(clientId, period)
      const fromDatabase = draftFromRow(thisMonth)
      const differs = fromStorage !== null && draftsDiffer(fromStorage, fromDatabase)
      setDraft(differs && fromStorage ? fromStorage : fromDatabase)
      setUnsavedFromEarlierVisit(differs)

      setStatus('ready')
      // `clean` means what its two consumers read it to mean, not "freshly
      // loaded from somewhere": submitBlock treats `clean` plus a submitted
      // stored row as nothing left to write, and displayedTotal shows the
      // *stored* total for `clean` and the local one only once the form is
      // dirty/saving/failed. Both are only true when the form on screen
      // actually matches the database row above. `loaded` sets that baseline;
      // when the draft just won over that row, the form no longer matches it,
      // so a second dispatch moves off `clean` immediately -- same tick, no
      // render in between showing the wrong thing.
      dispatch({ type: 'loaded' })
      if (differs) dispatch({ type: 'edited' })
    } catch (thrown) {
      // postgrest-js resolves most failures into `error` rather than rejecting,
      // so this is defensive -- and it is here because the failure it guards is
      // invisible. An unobserved rejection leaves `status` on 'loading' for
      // good, and the person sees a spinner with no message and no retry.
      setLoadError(describeError(thrown))
      setStatus('error')
    }
  }, [clientId, period, lastPeriod])

  useEffect(() => {
    void load()
  }, [load])

  // One place that both updates the form and persists it, so no edit path can
  // forget the second half. §5.5: every click and keystroke is written.
  const applyEdit = useCallback(
    (next: Draft) => {
      setDraft(next)
      setDraftPersisted(writeDraft(clientId, period, next))
      dispatch({ type: 'edited' })
      // Once the person has edited, "unsaved changes from an earlier visit" is
      // no longer the interesting fact -- "unsaved changes" is, and the save
      // state carries that. Leaving it up would keep pointing at a visit that
      // is no longer the reason anything is unsaved.
      setUnsavedFromEarlierVisit(false)
    },
    [clientId, period],
  )

  const setPillar = useCallback(
    (pillar: Pillar, value: number | null) => {
      const pillars: PillarScores = { ...draft.pillars }
      // Deleted, not set to null. An unscored pillar is an absent key
      // everywhere else in this code -- draftCache validates on that basis, and
      // scoredCount counts on it.
      if (value === null) delete pillars[pillar]
      else pillars[pillar] = value
      applyEdit({ ...draft, pillars })
    },
    [draft, applyEdit],
  )

  const setNotes = useCallback(
    (notes: string) => applyEdit({ ...draft, notes }),
    [draft, applyEdit],
  )

  const scored = scoredCount(draft.pillars)
  const localTotal = totalScore(draft.pillars)
  const hasContent = !isDraftEmpty(draft)
  const storedSubmitted = stored?.submitted_at != null
  const storedByYou = stored?.submitted_by === profile.id

  const submit = useCallback(() => {
    if (inFlight.current) return
    inFlight.current = true
    dispatch({ type: 'submitted' })

    void (async () => {
      const complete = scoredCount(draft.pillars) === PILLARS.length
      const now = new Date().toISOString()

      // Every pillar column is sent, including the unscored ones as null.
      // Sending only the scored ones would leave a cleared pillar at its old
      // value in the database, so the form and the row would disagree with no
      // sign of it anywhere -- and the total is generated from those columns,
      // so the number on the board would be the one nobody chose.
      const pillars = Object.fromEntries(
        PILLARS.map((pillar) => [pillar, draft.pillars[pillar] ?? null]),
      ) as Record<Pillar, number | null>

      try {
        const { data, error } = await supabase
          .from('checkins')
          .upsert(
            {
              client_id: clientId,
              period,
              ...pillars,
              notes: draft.notes.trim() === '' ? null : draft.notes,
              // Set on a complete five and explicitly cleared otherwise. The
              // board counts submissions as `submitted_at is not null`, so a
              // check-in edited back down to four pillars has to stop counting
              // -- leaving the old timestamp would report a submission that no
              // longer exists.
              submitted_at: complete ? now : null,
              submitted_by: complete ? profile.id : null,
            },
            { onConflict: 'client_id,period' },
          )
          // .select().single() rather than a second read: the row that comes
          // back carries total_score straight from the generated column, which
          // is what §5.3 asks the screen to display after a save, and
          // updated_at, which is the time the confirmation names. One round
          // trip, and no window in which the screen shows a total the database
          // does not hold.
          .select()
          .single()

        if (error) {
          dispatch({ type: 'failed', error: describeError(error) })
          return
        }

        setStored(data)
        // Cleared only now, on a confirmed save. §5.5.
        clearDraft(clientId, period)
        setUnsavedFromEarlierVisit(false)
        setDraftPersisted(true)
        dispatch({
          type: 'succeeded',
          at: data.updated_at,
          by: 'you',
          complete,
        })
      } catch (thrown) {
        dispatch({ type: 'failed', error: describeError(thrown) })
      } finally {
        // finally, not a line after the await: if this ever rejects past the
        // catch, a latched ref would refuse every future press for the life of
        // the screen and nothing would say why.
        inFlight.current = false
      }
    })()
  }, [clientId, period, draft, profile.id])

  return {
    status,
    loadError,
    stored,
    lastMonth,
    lastPeriod,
    draft,
    saveState,
    scored,
    localTotal,
    hasContent,
    storedSubmitted,
    storedByYou,
    draftPersisted,
    unsavedFromEarlierVisit,
    setPillar,
    setNotes,
    reload: () => void load(),
    submit,
  }
}
