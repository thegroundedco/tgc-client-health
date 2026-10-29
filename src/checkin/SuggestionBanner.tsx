import { formatSavedAt } from '../lib/month'
import { useConfirmSuggestion } from './useConfirmSuggestion'

type Props = { clientId: number; period: string; suggestedAt: string; canConfirm: boolean }

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
export function SuggestionBanner({ clientId, period, suggestedAt, canConfirm }: Props) {
  const { state, confirm } = useConfirmSuggestion(clientId, period)

  if (state.kind === 'confirmed') {
    return (
      <p className="t-body prose" role="status">
        Confirmed {formatSavedAt(state.at)}.
      </p>
    )
  }

  return (
    <div className="prose">
      <p className="t-body" data-testid="suggestion-line">
        Suggested by AI on {shortDay(suggestedAt)}. Check the answers, then Confirm — or change anything and save.
      </p>
      {canConfirm && (
        <button className="button" disabled={state.kind === 'saving'} onClick={() => void confirm()} type="button">
          Confirm
        </button>
      )}
      {state.kind === 'failed' && (
        <p className="alert prose" role="alert">
          {state.message}
        </p>
      )}
    </div>
  )
}
