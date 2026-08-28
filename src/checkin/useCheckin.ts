import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { previousPeriod } from '../lib/month'
import { ALL_QUESTIONS } from '../lib/buckets'
import { advocacyApplies as gateApplies } from '../lib/gate'
import { answeredCount, overallScore, requiredQuestions } from '../lib/scoreV2'
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
import type { Draft, QuestionScores } from './draftCache'

export type CheckinRow = Database['public']['Tables']['checkins']['Row']
export type ScoreRow = Database['public']['Views']['checkin_scores']['Row']

export type UseCheckin = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  stored: CheckinRow | null
  lastMonth: CheckinRow | null
  lastPeriod: string
  draft: Draft
  saveState: SaveState
  // The gate, and the count that follows from it. §4.4: every count on screen is
  // against this number, never a hardcoded 22.
  advocacyApplies: boolean
  required: number
  scored: number
  localOverall: number | null
  storedOverall: number | null
  lastOverall: number | null
  hasContent: boolean
  storedSubmitted: boolean
  storedByYou: boolean
  draftPersisted: boolean
  unsavedFromEarlierVisit: boolean
  setAnswer: (key: string, value: number | null) => void
  setNotes: (notes: string) => void
  reload: () => void
  submit: () => void
}

// The form's shape, from a stored row. Kept here rather than in draftCache
// because this is the only place a row is turned into a draft -- the reverse
// mapping, a draft into the row's columns, lives in submit() below.
//
// Iterates the rubric rather than the row's own keys: a row carries the retired
// pillar columns too, and they are not answers.
function draftFromRow(row: CheckinRow | null): Draft {
  if (!row) return EMPTY_DRAFT
  const answers: QuestionScores = {}
  for (const key of ALL_QUESTIONS) {
    const value = row[key as keyof CheckinRow]
    if (typeof value === 'number') answers[key] = value
  }
  return { answers, notes: row.notes ?? '' }
}

export function useCheckin(
  client: { id: number; started_on: string | null },
  period: string,
  profile: Profile,
): UseCheckin {
  const clientId = client.id
  const lastPeriod = previousPeriod(period)

  // Computed, not fetched. public.checkin_scores.advocacy_applies answers this
  // for a check-in that HAS a row, and this screen must answer it for one that
  // does not -- which is every check-in, the first time somebody opens it.
  // tests/gateParity.test.ts is what keeps the two answers the same.
  const applies = gateApplies(client.started_on, period)
  const required = requiredQuestions(applies).length

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stored, setStored] = useState<CheckinRow | null>(null)
  const [lastMonth, setLastMonth] = useState<CheckinRow | null>(null)
  const [scores, setScores] = useState<ScoreRow[]>([])
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

  // `isCancelled` guards every write below, once the request resolves --
  // the same pattern src/auth/useProfile.ts uses (a `cancelled` flag set in
  // an effect's cleanup). Defensive rather than reachable today: CheckIn is
  // only ever rendered via `if (selected) return <CheckIn ... />`, so a
  // changed client fully unmounts this hook instead of re-running `load` on
  // a live instance, and there is no in-screen period switcher to change
  // `period` under a mounted CheckIn either. But this callback's own
  // dependency array below -- [clientId, period, lastPeriod] -- is written
  // as though those can change while the effect stays mounted, and if that
  // ever became true, a slow response for the *previous* client or period
  // resolving after a newer request had already started would silently
  // overwrite the screen with another client's scores and draft, with
  // nothing on screen saying so. One check, right after the await: every
  // line below it is synchronous, so it guards every write that follows.
  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setStatus('loading')
    try {
      // Two reads, resolved together and treated as one outcome. The base table
      // carries the answers, the notes and the submitted marker; the view
      // carries the overall, which is the only place the gated divisor is
      // applied and therefore the only honest source for a saved score (§6).
      // Promise.all rather than two sequential awaits so this stays one round
      // trip's worth of latency, and one failure branch rather than two -- a
      // partial failure is not a state this screen has an answer for.
      const [rows, views] = await Promise.all([
        supabase
          .from('checkins')
          .select('*')
          .eq('client_id', clientId)
          .in('period', [lastPeriod, period]),
        supabase
          .from('checkin_scores')
          .select('*')
          .eq('client_id', clientId)
          .in('period', [lastPeriod, period]),
      ])

      if (isCancelled()) return

      // Written as `rows.error || views.error` rather than through an
      // intermediate `failure` variable: postgrest-js types each result's
      // `data` as non-null only when that same result's own `error` is
      // narrowed falsy, and a derived variable breaks that link -- TypeScript
      // would no longer know `rows.data` is safe to read below. This still
      // reads as one branch and one outcome for either query's failure, which
      // is the point: a partial failure -- this month readable, the view not
      // -- is not a state this screen has an answer for.
      if (rows.error || views.error) {
        // describeError, not error.message: an empty message is falsy, and the
        // `loadError &&` guard on the screen would miss it and render a form
        // over a failed read. See src/lib/errorText.ts.
        setLoadError(describeError(rows.error ?? views.error))
        setStatus('error')
        return
      }

      const thisMonth = rows.data.find((row) => row.period === period) ?? null
      const previous = rows.data.find((row) => row.period === lastPeriod) ?? null

      // Never write after a failed read: everything below runs only because
      // both of the above succeeded.
      setLoadError(null)
      setStored(thisMonth)
      setLastMonth(previous)
      setScores(views.data)

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
      if (isCancelled()) return
      // postgrest-js resolves most failures into `error` rather than rejecting,
      // so this is defensive -- and it is here because the failure it guards is
      // invisible. An unobserved rejection leaves `status` on 'loading' for
      // good, and the person sees a spinner with no message and no retry.
      setLoadError(describeError(thrown))
      setStatus('error')
    }
  }, [clientId, period, lastPeriod])

  useEffect(() => {
    // A fresh flag per run, exactly as in useProfile: if `load`'s identity
    // changes (clientId, period or lastPeriod changed) while this effect is
    // still mounted, the cleanup below marks the old run's flag cancelled
    // before the new run's effect body executes, and the same flag is
    // marked cancelled on unmount.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
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

  const setAnswer = useCallback(
    (key: string, value: number | null) => {
      const answers: QuestionScores = { ...draft.answers }
      // Deleted, not set to null. An unanswered question is an absent key
      // everywhere else in this code -- draftCache validates on that basis, and
      // answeredCount counts on it.
      if (value === null) delete answers[key]
      else answers[key] = value
      applyEdit({ ...draft, answers })
    },
    [draft, applyEdit],
  )

  const setNotes = useCallback(
    (notes: string) => applyEdit({ ...draft, notes }),
    [draft, applyEdit],
  )

  const scored = answeredCount(draft.answers, applies)
  const localOverall = overallScore(draft.answers, applies)
  const storedOverall = scores.find((row) => row.period === period)?.overall_score ?? null
  const lastOverall = scores.find((row) => row.period === lastPeriod)?.overall_score ?? null
  const hasContent = !isDraftEmpty(draft)
  const storedSubmitted = stored?.submitted_at != null
  const storedByYou = stored?.submitted_by === profile.id

  const submit = useCallback(() => {
    if (inFlight.current) return
    inFlight.current = true
    dispatch({ type: 'submitted' })

    void (async () => {
      // Against the REQUIRED count, not 22. A gated-out check-in is complete at
      // 18, and marking it submitted only at 22 would make a complete check-in
      // permanently unsubmittable for every client inside their first 90 days.
      const complete = answeredCount(draft.answers, applies) === required
      const now = new Date().toISOString()

      // Every answer column is sent, including the unanswered ones as null, and
      // including the four Advocacy columns when the gate is shut. Sending only
      // the answered ones would leave a cleared answer at its old value in the
      // database, so the form and the row would disagree with no sign of it
      // anywhere -- and the six bucket columns are generated from these columns,
      // so the bar on the board would be the one nobody chose.
      const answers = Object.fromEntries(
        ALL_QUESTIONS.map((key) => [key, draft.answers[key] ?? null]),
      )

      try {
        const { data, error } = await supabase
          .from('checkins')
          .upsert(
            {
              client_id: clientId,
              period,
              ...answers,
              notes: draft.notes.trim() === '' ? null : draft.notes,
              // Set on a complete check-in and explicitly cleared otherwise. The
              // board counts submissions as `submitted_at is not null`, so a
              // check-in edited back down below the required count has to stop
              // counting -- leaving the old timestamp would report a submission
              // that no longer exists.
              submitted_at: complete ? now : null,
              submitted_by: complete ? profile.id : null,
            },
            { onConflict: 'client_id,period' },
          )
          // .select().single() rather than a second read: the row that comes
          // back carries the six generated bucket columns and updated_at, which
          // is the time the confirmation names. One round trip.
          //
          // What it does NOT carry is the overall -- that lives in
          // public.checkin_scores, which an upsert cannot return. reload()
          // below is what refreshes it, and until it lands displayedOverall
          // shows the local mean, which is the same value unless scoreV2 and
          // the view disagree. Surfacing that disagreement is the point of the
          // local/stored split, so this is the intended behaviour rather than a
          // gap.
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

        // The view is a separate relation, so the upsert could not return the
        // overall. It is re-read here, and AWAITED BEFORE the confirmation is
        // dispatched, for two reasons that pull the same way.
        //
        // Not load(): load() dispatches { type: 'loaded' }, which resets the
        // reducer to `clean` -- wiping the `succeeded` confirmation that is
        // about to be dispatched below. The confirmation IS this slice; the
        // whole rewrite exists because a save that worked looked exactly like
        // one that failed, and refreshing a number by erasing the sentence that
        // says the save happened would reintroduce that defect from the other
        // side.
        //
        // And awaited, not fired off: displayedOverall shows the STORED overall
        // once the state is `saved`, so dispatching the confirmation before this
        // lands would print an em dash beside "Check-in submitted" -- a complete
        // check-in reading as not scored, for one round trip.
        const refreshed = await supabase
          .from('checkin_scores')
          .select('*')
          .eq('client_id', clientId)
          .in('period', [lastPeriod, period])

        // A failed refresh is not a failed save. The write succeeded and the
        // person is told so; the overall stays at its pre-save value until the
        // next load. Reporting a save failure here would be the more harmful
        // lie of the two.
        if (!refreshed.error) setScores(refreshed.data)

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
    // `load` is deliberately not a dependency: submit() no longer calls it, and
    // adding it would rebuild submit on every load rather than only when the
    // things it actually reads -- clientId, period, lastPeriod (read by the
    // post-save score refresh above), the draft, applies, required and the
    // account -- change.
  }, [clientId, period, lastPeriod, draft, profile.id, applies, required])

  return {
    status,
    loadError,
    stored,
    lastMonth,
    lastPeriod,
    draft,
    saveState,
    advocacyApplies: applies,
    required,
    scored,
    localOverall,
    storedOverall,
    lastOverall,
    hasContent,
    storedSubmitted,
    storedByYou,
    draftPersisted,
    unsavedFromEarlierVisit,
    setAnswer,
    setNotes,
    reload: () => void load(),
    submit,
  }
}
