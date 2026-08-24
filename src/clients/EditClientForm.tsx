import { useState } from 'react'
import {
  CLIENT_STATUSES,
  END_REASON_CODES,
  END_REASON_LABELS,
  STATUS_HINTS,
  STATUS_LABELS,
  draftFromRow,
  formProblems,
  isChurned,
  reactivationWarning,
  writeStatusLine,
} from './clientForm'
import type { AdminClient, ClientDraft, ClientStatus, WriteState } from './clientForm'
import type { OwnerOption } from './useClients'
import styles from './ClientsAdmin.module.css'

type Props = {
  client: AdminClient
  owners: readonly OwnerOption[]
  state: WriteState
  onSave: (id: number, draft: ClientDraft) => void
  onCancel: () => void
  onEdited: () => void
}

const TONE_CLASS = {
  confirm: 't-body',
  error: 'alert',
  quiet: 't-caption',
} as const

// Spec §7: name, owner and status, with the three lifecycle fields revealed only
// when the status is one that requires them. Every decision below comes out of
// clientForm.ts -- rule 1 is formProblems, rule 2 is reactivationWarning plus
// updatePayload, rule 3 is STATUS_HINTS. Spec §9: "The rules are not ternaries
// in JSX."
export function EditClientForm({ client, owners, state, onSave, onCancel, onEdited }: Props) {
  // Correct today because of the per-row mount, not this key: this component
  // renders only inside the `editing.id === client.id` branch of one <li>, so
  // opening a different row unmounts this instance and mounts a fresh one no
  // matter what key it carries. The key stays anyway -- cheap belt-and-braces
  // against a future refactor that hoists a single form out of the list, which
  // the spec's own "a list and a form" wording invites, so that a hoisted
  // layout does not silently inherit a cross-row draft bug.
  const [draft, setDraft] = useState<ClientDraft>(() => draftFromRow(client))

  const problems = formProblems(draft)
  const saving = state.kind === 'saving'
  const line = writeStatusLine(state, problems)
  // Measured against the STORED status, not the draft's, because the question is
  // what saving would destroy.
  const warning = reactivationWarning(client.status, draft.status)
  const churned = isChurned(draft.status)

  function edit(next: ClientDraft) {
    setDraft(next)
    if (state.kind !== 'idle') onEdited()
  }

  function submit() {
    if (problems.length > 0 || saving) return
    onSave(client.id, draft)
  }

  return (
    <div className={styles.panel}>
      <h4 className="t-label">Editing {client.name}</h4>

      <div className={styles.fieldBlock}>
        <label className="t-label" htmlFor="edit-client-name">
          Client name
        </label>
        <input
          className="field"
          disabled={saving}
          id="edit-client-name"
          onChange={(event) => edit({ ...draft, name: event.target.value })}
          type="text"
          value={draft.name}
        />
      </div>

      <div className={styles.fieldBlock}>
        {/* "Client owner", not "Owner": the add form already uses "Owner" for
            its own owner picker, and both forms can be on screen at once, so
            an identical label would announce as two indistinguishable combo
            boxes and make getByLabelText('Owner') ambiguous with a form open.
            Matches the existing "Client name" / "Name" asymmetry below. */}
        <label className="t-label" htmlFor="edit-client-owner">
          Client owner
        </label>
        <select
          className="field"
          disabled={saving}
          id="edit-client-owner"
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
        <label className="t-label" htmlFor="edit-client-status">
          Status
        </label>
        <select
          className="field"
          disabled={saving}
          id="edit-client-status"
          onChange={(event) => edit({ ...draft, status: event.target.value })}
          value={draft.status}
        >
          {CLIENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {/* Rule 3: cancelled and former differ only in age, so the form says
            which is which instead of making the reader guess. Rendered as
            visible text, not only as a description -- an accessible name and a
            sighted reader are two separate questions. */}
        <p className="t-caption prose" data-testid="status-hint">
          {STATUS_HINTS[draft.status as ClientStatus] ?? ''}
        </p>
      </div>

      {/* Rule 2. A sentence before the press rather than a dialog after it: the
          spec asks the screen to SAY it is clearing the end date and reason,
          because that is a recorded fact being destroyed. */}
      {warning !== null && (
        <p className="alert prose" data-testid="reactivation-warning" role="status">
          {warning}
        </p>
      )}

      {/* Rule 1: revealed, not merely enabled. An always-present date field on
          an active client invites somebody to fill it in, and the constraint
          would then refuse the whole save. */}
      {churned && (
        <>
          <div className={styles.fieldBlock}>
            <label className="t-label" htmlFor="edit-client-ended">
              End date
            </label>
            <input
              className="field"
              disabled={saving}
              id="edit-client-ended"
              onChange={(event) => edit({ ...draft, endedOn: event.target.value })}
              type="date"
              value={draft.endedOn}
            />
          </div>

          <div className={styles.fieldBlock}>
            <label className="t-label" htmlFor="edit-client-reason">
              Reason they left
            </label>
            <select
              className="field"
              disabled={saving}
              id="edit-client-reason"
              onChange={(event) => edit({ ...draft, endReasonCode: event.target.value })}
              value={draft.endReasonCode}
            >
              <option value="">Choose a reason</option>
              {END_REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {END_REASON_LABELS[code]}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.fieldBlock}>
            <label className="t-label" htmlFor="edit-client-note">
              Note (optional)
            </label>
            {/* Optional, and labelled as such. Spec §10 decision 3: only the
                countable half can be made mandatory without inviting a full
                stop typed to get past a form. */}
            <textarea
              className="field"
              disabled={saving}
              id="edit-client-note"
              onChange={(event) => edit({ ...draft, endReasonNote: event.target.value })}
              rows={2}
              value={draft.endReasonNote}
            />
          </div>
        </>
      )}

      <div className={styles.actions}>
        <button
          aria-describedby="edit-client-status-line"
          className="button"
          disabled={problems.length > 0 || saving}
          onClick={submit}
          type="button"
        >
          Save changes
        </button>
        <button
          className="button button--quiet"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>

        <p
          className={TONE_CLASS[line.tone]}
          data-testid="edit-status"
          id="edit-client-status-line"
          role="status"
        >
          {line.text}
        </p>
      </div>

      {/* There is no delete control here, and that is a decision rather than an
          omission. checkins.client_id is `on delete cascade` and this project
          has no backups, so deleting a client would silently destroy its entire
          check-in history. `former` is how a client goes away. Spec §2 and §10
          decision 5. */}
    </div>
  )
}
