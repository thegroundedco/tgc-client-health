import { formatSavedAt } from '../lib/month'
import { useConfirmSuggestion } from './useConfirmSuggestion'

type Props = {
  clientId: number
  period: string
  suggestedAt: string
  canConfirm: boolean
  // The form on screen differs from the stored row (CheckIn.tsx names the
  // condition). Confirm clears suggested_at on the STORED row, so offering it
  // while the person is looking at different answers would accept answers they
  // are not looking at.
  hasUnsavedChanges: boolean
}

function shortDay(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Spec 2026-10-29: an AI suggestion that no person has reviewed. Confirm
// accepts it as it stands; saving the form below also counts as review (the
// save clears suggested_at), so this line is gone either way once a person has
// looked. The line hides on a successful Confirm without a reload, because the
// stored row this screen holds still carries the old suggested_at.
export function SuggestionBanner({ clientId, period, suggestedAt, canConfirm, hasUnsavedChanges }: Props) {
  const { state, confirm } = useConfirmSuggestion(clientId, period)

  // One wrapper and one status element in a fixed position, whatever the
  // state: many screen readers do not announce a live region that mounts with
  // its text already in it, so the element must outlive the Confirm press and
  // only its text changes. The suggestion line and button go once confirmed.
  const confirmed = state.kind === 'confirmed'

  return (
    <div className="prose">
      <p className="t-body prose" role="status">
        {state.kind === 'confirmed' ? `Confirmed ${formatSavedAt(state.at)}.` : ''}
      </p>
      {!confirmed && (
        <>
          <p className="t-body" data-testid="suggestion-line">
            {canConfirm
              ? `Suggested by AI on ${shortDay(suggestedAt)}. Check the answers, then Confirm — or change anything and save.`
              : `Suggested by AI on ${shortDay(suggestedAt)}; not yet reviewed.`}
          </p>
          {canConfirm && (
            <>
              <button
                className="button"
                disabled={state.kind === 'saving' || hasUnsavedChanges}
                onClick={() => void confirm()}
                type="button"
              >
                Confirm
              </button>
              {hasUnsavedChanges && (
                <p className="t-caption">
                  You have unsaved changes. Save them instead — saving also clears the suggestion.
                </p>
              )}
            </>
          )}
          {state.kind === 'failed' && (
            <p className="alert prose" role="alert">
              {state.message}
            </p>
          )}
        </>
      )}
    </div>
  )
}
