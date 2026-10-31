import { useEffect, useId, useRef, useState } from 'react'
import { DialogShell } from '../ai/DialogShell'
import styles from '../ai/RunMonthDialog.module.css'
import type { Answers } from '../lib/scoreV2'
import type { AiSuggestion } from './aiSuggestion'
import { useRevertSuggestion } from './useRevertSuggestion'

type Props = {
  clientId: number
  period: string
  profileId: string
  canEdit: boolean
  /** The stored row's suggested_at: null means a person has reviewed it. */
  suggestedAt: string | null
  /** parseAiSuggestion(stored.ai_suggestion). */
  ai: AiSuggestion | null
  /** The stored answers: revert keeps their finance answers. */
  current: Answers
  advocacyApplies: boolean
  /** Unsaved edits also offer the button, and Revert discards them. */
  hasUnsavedChanges: boolean
  onReverted: () => void
}

function shortDay(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// "Revert to AI suggested scores" on a check-in a person has reviewed, or is
// editing, and whose AI copy is still on file (spec 2026-10-30 §5.3). Confirmed first: it replaces saved scores and note.
export function RevertButton({
  clientId, period, profileId, canEdit, suggestedAt, ai, current, advocacyApplies, hasUnsavedChanges, onReverted,
}: Props) {
  const headingId = useId()
  const [open, setOpen] = useState(false)
  const { state, revert } = useRevertSuggestion(clientId, period, profileId)

  const onRevertedRef = useRef(onReverted)
  useEffect(() => {
    onRevertedRef.current = onReverted
  })
  useEffect(() => {
    if (state.kind === 'reverted') onRevertedRef.current()
  }, [state.kind])

  if (!canEdit || ai === null || (suggestedAt !== null && !hasUnsavedChanges)) return null

  return (
    <div className="prose">
      <button
        className="button button--quiet"
        disabled={state.kind === 'saving'}
        onClick={() => setOpen(true)}
        type="button"
      >
        Revert to AI suggested scores
      </button>
      {state.kind === 'failed' && (
        <p className="alert prose" role="alert">
          {state.message}
        </p>
      )}
      {open && (
        <DialogShell headingId={headingId} onCancel={() => setOpen(false)}>
          <h2 className="t-header" id={headingId}>
            {`Replace the saved scores and note with the AI's from ${shortDay(ai.suggested_at)}?`}
          </h2>
          <div className={styles.actions}>
            <button
              className="button"
              onClick={() => {
                setOpen(false)
                void revert({ current, ai, advocacyApplies })
              }}
              type="button"
            >
              Revert
            </button>
            <button className="button button--quiet" onClick={() => setOpen(false)} type="button">
              Cancel
            </button>
          </div>
        </DialogShell>
      )}
    </div>
  )
}
