import { useEffect, useState } from 'react'
import {
  EMPTY_STINT,
  PACKAGE_CODES,
  currentStint,
  packageLabel,
  sortStints,
  stintProblems,
} from './clientPackages'
import type { PackageStint, StintDraft } from './clientPackages'
import {
  CLIENT_STATUSES,
  CLIENT_TYPE_CODES,
  END_REASON_CODES,
  END_REASON_LABELS,
  STATUS_HINTS,
  STATUS_LABELS,
  draftFromRow,
  formProblems,
  isChurned,
  reactivationWarning,
  typeLabel,
  writeStatusLine,
} from './clientForm'
import type { AdminClient, ClientDraft, ClientStatus, WriteState } from './clientForm'
import type { OwnerOption } from './useClients'
import styles from './ClientsAdmin.module.css'

type Props = {
  client: AdminClient
  owners: readonly OwnerOption[]
  stints: readonly PackageStint[]
  state: WriteState
  onSave: (id: number, draft: ClientDraft) => void
  onCancel: () => void
  onEdited: () => void
  onRecordPackage: (clientId: number, draft: StintDraft) => void
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
export function EditClientForm({
  client,
  owners,
  state,
  stints,
  onSave,
  onCancel,
  onEdited,
  onRecordPackage,
}: Props) {
  const [stint, setStint] = useState<StintDraft>(EMPTY_STINT)
  const stintFaults = stintProblems(stint, stints)
  const onNow = currentStint(stints)
  // Correct today because of the per-row mount, not this key: this component
  // renders only inside the `editing?.id === client.id` branch of one <li>, so
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

  // Re-read from the row on a CONFIRMED save, never on the press -- the same
  // shape, and the same reason, as AddClientForm clearing its field only on
  // confirmation. Holding the draft across a save is right for a rename; it was
  // wrong after a reactivation, which nulls all three lifecycle columns in the
  // database while the draft still held the old end date and reason. Selecting
  // `former` again in the same still-open form revealed those destroyed values
  // and saving wrote them back as if they were today's departure -- a false fact
  // recorded in a database with no backups.
  //
  // Cannot fire on a failure: a failed save must keep the typed values, because
  // that is the one moment somebody most wants to look at them, and this runs
  // only for 'saved'. Cannot discard later typing either: a keystroke goes
  // through edit(), which calls onEdited and moves the state off 'saved', so the
  // dependency changes to something this branch ignores. `client` is a
  // dependency because it is what is being read -- the hook replaces that row
  // object in the same render the state becomes 'saved'.
  useEffect(() => {
    if (state.kind === 'saved') setDraft(draftFromRow(client))
  }, [state, client])

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
        {/* "Client start date", not "Start date": the add form uses "Start
            date" and both forms can be on screen at once, so an identical
            label would announce as two indistinguishable date fields and make
            getByLabelText('Start date') ambiguous. Matches the existing
            "Client name" / "Name" and "Client owner" / "Owner" asymmetry. */}
        <label className="t-label" htmlFor="edit-client-started">
          Client start date
        </label>
        <input
          className="field"
          disabled={saving}
          id="edit-client-started"
          onChange={(event) => edit({ ...draft, startedOn: event.target.value })}
          type="date"
          value={draft.startedOn}
        />
        <p className="t-caption prose">
          Advocacy is not scored until a client has a start date, and then only
          from the first check-in month beginning 90 days after it.
        </p>
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

      {/* The package history and the way to add to it. Append-only: a stint is
          a fact about a date, and the screen offers no way to unsay one -- the
          table has no delete policy for the same reason revenue does not.

          Outside the churned block, like the two fields below it: a client's
          journey up the ladder is most interesting once they have left, which
          is exactly when a departure-gated field would hide it. */}
      <div className={styles.field}>
        <p className="t-caption">Package</p>
        <p className="t-body" data-testid="edit-client-package-now">
          {packageLabel(onNow?.package_code ?? null)}
        </p>

        {stints.length > 0 && (
          <ul aria-label="Package history" className={styles.list} role="list">
            {sortStints(stints).map((entry) => (
              <li className="t-caption" key={entry.id}>
                {packageLabel(entry.package_code)} from {entry.started_on}
                {entry.note === null ? '' : ` — ${entry.note}`}
              </li>
            ))}
          </ul>
        )}

        <label className="t-caption" htmlFor="edit-client-package">
          Move to
        </label>
        <select
          className="field"
          disabled={saving}
          id="edit-client-package"
          onChange={(event) => setStint({ ...stint, packageCode: event.target.value })}
          value={stint.packageCode}
        >
          <option value="">Choose a package</option>
          {PACKAGE_CODES.map((code: string) => (
            <option key={code} value={code}>
              {packageLabel(code)}
            </option>
          ))}
        </select>

        <label className="t-caption" htmlFor="edit-client-package-date">
          On
        </label>
        <input
          className="field"
          disabled={saving}
          id="edit-client-package-date"
          onChange={(event) => setStint({ ...stint, startedOn: event.target.value })}
          type="date"
          value={stint.startedOn}
        />

        <label className="t-caption" htmlFor="edit-client-package-note">
          Why (optional)
        </label>
        <input
          className="field"
          disabled={saving}
          id="edit-client-package-note"
          onChange={(event) => setStint({ ...stint, note: event.target.value })}
          value={stint.note}
        />

        {/* The faults are shown rather than the button merely disabled: a
            disabled button with no reason is a dead end. */}
        {stint.packageCode !== '' && stint.startedOn !== '' && stintFaults.length > 0 && (
          <p className="alert" data-testid="edit-client-package-problem" role="alert">
            {stintFaults.map((fault) => fault.text).join(' ')}
          </p>
        )}

        <button
          className="button button--quiet"
          disabled={saving || stintFaults.length > 0}
          onClick={() => {
            onRecordPackage(client.id, stint)
            setStint(EMPTY_STINT)
          }}
          type="button"
        >
          Record package
        </button>
      </div>

      {/* Both live OUTSIDE the churned block above, deliberately. Those three
          fields appear only for a client who has left, because they describe a
          departure. These two describe the client itself -- a paused client is
          still an e-commerce brand, and a departed one still had whatever
          arrangement the note explains -- so they are always on the form. */}
      <div className={styles.field}>
        <label className="t-caption" htmlFor="edit-client-type">
          Type of business
        </label>
        <select
          className="field"
          disabled={saving}
          id="edit-client-type"
          onChange={(event) => edit({ ...draft, typeCode: event.target.value })}
          value={draft.typeCode}
        >
          {/* Empty is "nobody has said yet", which is not the same as Other.
              Offering only Other would force a wrong answer to get past the
              form. */}
          <option value="">Not recorded</option>
          {CLIENT_TYPE_CODES.map((code: string) => (
            <option key={code} value={code}>
              {typeLabel(code)}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className="t-caption" htmlFor="edit-client-about">
          Note
        </label>
        <p className="t-caption" id="edit-client-about-hint">
          What this client is, if it is not obvious from the name &mdash; an unusual billing
          arrangement, or a relationship that is not what it looks like.
        </p>
        <textarea
          aria-describedby="edit-client-about-hint"
          className="field"
          disabled={saving}
          id="edit-client-about"
          onChange={(event) => edit({ ...draft, note: event.target.value })}
          rows={2}
          value={draft.note}
        />
      </div>

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
