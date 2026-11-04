import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { isComplete } from '../lib/scoreV2'
import type { Answers } from '../lib/scoreV2'
import { UPDATE_MATCHED_NOTHING_TEXT } from '../clients/clientForm'
import { AI_ANSWER_KEYS, revertedAnswers } from './aiSuggestion'
import { bucketNotesForSave, focusForSave } from './bucketNotes'
import type { AiSuggestion } from './aiSuggestion'

export type RevertState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'reverted' }
  | { kind: 'failed'; message: string }

// Replace the saved scores and note with the AI's copy (spec 2026-10-30 §5.3).
// The update names the 19 AI answer columns, notes and the review fields and
// NOTHING else: not the two finance answers (revertedAnswers keeps the person's
// own, so they are not written) and never ai_suggestion, which the database
// refuses from the app. suggested_at is set, so the row reads as an unreviewed
// suggestion again. Filtered on client AND month; .maybeSingle() with null as a
// failure, for the reason useConfirmSuggestion documents.
//
// bucket_notes and focus (spec 2026-11-04 §2) are written ONLY when the
// suggestion carries them. Every suggestion on file predates them; naming
// the columns for one of those would wipe what the person wrote with nothing
// the AI ever said (Review Focus 2). Carried values go through the same
// cleaning as a save, so the CHECKs cannot refuse them.
export function useRevertSuggestion(clientId: number, period: string, profileId: string) {
  const [state, setState] = useState<RevertState>({ kind: 'idle' })
  const inFlight = useRef(false)

  const revert = useCallback(
    async (args: { current: Answers; ai: AiSuggestion; advocacyApplies: boolean; hoursApplies: boolean }): Promise<void> => {
      if (inFlight.current) return
      inFlight.current = true
      setState({ kind: 'saving' })
      try {
        const merged = revertedAnswers(args.current, args.ai)
        const answers = Object.fromEntries(AI_ANSWER_KEYS.map((key) => [key, merged[key] ?? null]))
        const now = new Date().toISOString()
        const complete = isComplete(merged, args.advocacyApplies, args.hoursApplies)
        const notesFromAi = {
          ...(args.ai.bucket_notes !== undefined ? { bucket_notes: bucketNotesForSave(args.ai.bucket_notes) } : {}),
          ...(args.ai.focus !== undefined ? { focus: focusForSave(args.ai.focus ?? '') } : {}),
        }
        const { data, error } = await supabase
          .from('checkins')
          .update({
            ...answers,
            notes: args.ai.notes,
            ...notesFromAi,
            suggested_at: now,
            submitted_at: complete ? now : null,
            submitted_by: complete ? profileId : null,
          })
          .eq('client_id', clientId)
          .eq('period', period)
          .select('updated_at')
          .maybeSingle()
        if (error) {
          setState({ kind: 'failed', message: `${describeError(error)} Nothing was changed.` })
        } else if (data === null) {
          setState({ kind: 'failed', message: UPDATE_MATCHED_NOTHING_TEXT })
        } else {
          setState({ kind: 'reverted' })
        }
      } catch (thrown) {
        setState({ kind: 'failed', message: `${describeError(thrown)} Nothing was changed.` })
      } finally {
        inFlight.current = false
      }
    },
    [clientId, period, profileId],
  )

  return { state, revert }
}
