import { useEffect, useState } from 'react'
import { EMPTY_DRAFT, formProblems, writeStatusLine } from './clientForm'
import type { ClientDraft, WriteState } from './clientForm'
import type { OwnerOption } from './useClients'
import styles from './ClientsAdmin.module.css'

type Props = {
  owners: readonly OwnerOption[]
  state: WriteState
  onAdd: (draft: ClientDraft) => void
  onEdited: () => void
}

// The class each status tone renders as. Kept beside the component that consumes
// it rather than in clientForm.ts: clientForm.ts decides what the screen should
// SAY, and which CSS role that becomes is presentation. Same division
// CheckIn.tsx documents for its own TONE_CLASS.
const TONE_CLASS = {
  confirm: 't-body',
  error: 'alert',
  quiet: 't-caption',
} as const

// Spec §7: "Adding takes a name and an optional owner. Status is active; the
// form does not offer a churned status on creation." There is deliberately no
// status control here -- the absence is the feature.
export function AddClientForm({ owners, state, onAdd, onEdited }: Props) {
  const [draft, setDraft] = useState<ClientDraft>(EMPTY_DRAFT)

  const problems = formProblems(draft)
  const saving = state.kind === 'saving'
  const line = writeStatusLine(state, problems)

  // One place that both updates the form and clears a stale confirmation, so no
  // edit path can forget the second half. A confirmation left standing beside a
  // form somebody has since changed is the same class of lie as no confirmation
  // at all.
  function edit(next: ClientDraft) {
    setDraft(next)
    if (state.kind !== 'idle') onEdited()
  }

  // Cleared on a CONFIRMED add, never on the press. Spec §7: "A failed write
  // keeps the form populated and says retrying is safe." Clearing in submit()
  // below would lose the typed name the instant the write was refused -- and the
  // most likely refusal this form will ever see is the unique index on
  // lower(name), which is precisely the case where the person wants to look at
  // what they typed and change one word of it.
  //
  // Safe against re-firing: once this runs, `state` is unchanged, so the effect
  // does not re-run. The next keystroke calls edit(), which resets the state to
  // idle and moves the dependency off 'saved' for good.
  useEffect(() => {
    if (state.kind === 'saved') setDraft(EMPTY_DRAFT)
  }, [state])

  function submit() {
    if (problems.length > 0 || saving) return
    onAdd(draft)
  }

  return (
    <div className={styles.panel}>
      <h3 className="t-header">Add a client</h3>

      <div className={styles.fieldBlock}>
        <label className="t-label" htmlFor="add-client-name">
          Name
        </label>
        <input
          className="field"
          disabled={saving}
          id="add-client-name"
          onChange={(event) => edit({ ...draft, name: event.target.value })}
          type="text"
          value={draft.name}
        />
      </div>

      <div className={styles.fieldBlock}>
        <label className="t-label" htmlFor="add-client-owner">
          Owner
        </label>
        <select
          className="field"
          disabled={saving}
          id="add-client-owner"
          onChange={(event) =>
            edit({ ...draft, ownerId: event.target.value === '' ? null : event.target.value })
          }
          value={draft.ownerId ?? ''}
        >
          <option value="">Unassigned</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.fieldBlock}>
        <label className="t-label" htmlFor="add-client-started">
          Start date
        </label>
        <input
          className="field"
          disabled={saving}
          id="add-client-started"
          onChange={(event) => edit({ ...draft, startedOn: event.target.value })}
          type="date"
          value={draft.startedOn}
        />
        {/* Optional, and the consequence of leaving it blank is stated here
            rather than discovered two screens away on a check-in whose
            Advocacy section is shut with no explanation the person who added
            the client would recognise. */}
        <p className="t-caption prose">
          Optional. Advocacy is not scored until a client has a start date.
        </p>
      </div>

      <div className={styles.actions}>
        <button
          aria-describedby="add-client-status"
          className="button"
          disabled={problems.length > 0 || saving}
          onClick={submit}
          type="button"
        >
          Add client
        </button>

        {/* role="status" so the confirmation is announced rather than only
            drawn. The whole reason Slice 1 was rewritten is that a write which
            worked looked exactly like one that failed. */}
        <p
          className={TONE_CLASS[line.tone]}
          data-testid="add-status"
          id="add-client-status"
          role="status"
        >
          {line.text}
        </p>
      </div>
    </div>
  )
}
