import { useEffect, useState } from 'react'
import { formatSavedAt } from '../lib/month'
import { isChurned, reasonLabel, statusLabel } from './clientForm'
import type { AdminClient } from './clientForm'
import { AddClientForm } from './AddClientForm'
import { EditClientForm } from './EditClientForm'
import { useClients } from './useClients'
import type { OwnerOption } from './useClients'
import styles from './ClientsAdmin.module.css'

type Props = { onWritingChange?: (writing: boolean) => void }

// Spec §7: one screen, a list and a form, no modal. The list shows every client
// regardless of status, because this is the screen where a former client has to
// remain visible -- the board reads only active rows, by design.

// Not "Unassigned" when the lookup misses, and not the raw UUID either. The
// picker lists active profiles only, so a client assigned to an account that was
// since deactivated lands here: there IS an owner, so "Unassigned" would be
// false, and a UUID tells the reader nothing they can act on.
function ownerText(client: AdminClient, owners: readonly OwnerOption[]): string {
  if (client.owner_id === null) return 'Unassigned'
  return owners.find((owner) => owner.id === client.owner_id)?.label
    ?? 'Owner is not an active account'
}

export function ClientsAdmin({ onWritingChange }: Props) {
  const admin = useClients()

  // Which row's form is open, by id rather than by row object: the hook replaces
  // the row object after a save (that is how the list shows the new name), and a
  // held object would then be the pre-save copy.
  const [editingId, setEditingId] = useState<number | null>(null)
  const editing = admin.clients.find((client) => client.id === editingId) ?? null

  // True while either write is in flight, for the same reason both forms disable
  // their own controls: leaving unmounts this screen, and the update then lands
  // with nobody left to read its confirmation -- a write that worked looking
  // exactly like one that did not. It disables each row's Edit button, and it is
  // reported upward so the shell can shut the menu bar's exits too. This screen's
  // own Back button was removed on 2026-09-02: it was a third stacked navigation
  // control under a bar that already leaves, and the guard it carried now lives
  // in the effect below, which no button owns.
  const writing = admin.editState.kind === 'saving' || admin.addState.kind === 'saving'

  // Reported upward because this screen no longer owns every exit. Slice 6a put
  // a permanently-enabled menu bar above it, so disabling the Back button below
  // stopped being sufficient: an admin could press Clients in the bar mid-save,
  // unmount this screen, and never see the confirmation or the refusal. The
  // shell disables the bar while this is true. Told from an effect rather than
  // from the call site, so it cannot get out of step with the value it reports.
  useEffect(() => {
    onWritingChange?.(writing)
  }, [onWritingChange, writing])

  const masthead = (
    <div className="masthead">
      <p className="t-eyebrow">Clients</p>
      <h2 className="t-header">Client admin</h2>
    </div>
  )

  // Error before loading, and the error gets the whole screen. A list rendered
  // under a failed read reads as "no clients" -- v1's founding defect, that a
  // broken tool looks like an empty one.
  if (admin.status === 'error') {
    return (
      <section className={styles.screen}>
        {masthead}
        <h3 className="t-header">Cannot reach the database</h3>
        <p className="alert prose" role="alert">
          {admin.loadError}
        </p>
        <p className="t-body prose">
          Nothing has been changed. The client list is still there; it just could not be
          read.
        </p>
        <button className="button" type="button" onClick={admin.reload}>
          Try again
        </button>
      </section>
    )
  }

  if (admin.status === 'loading') {
    return (
      <section className={styles.screen}>
        {masthead}
        <p className="t-body">Loading…</p>
      </section>
    )
  }

  return (
    <section className={styles.screen}>
      {masthead}

      <AddClientForm
        onAdd={admin.addClient}
        onEdited={admin.resetAdd}
        owners={admin.owners}
        state={admin.addState}
      />

      {admin.clients.length === 0 ? (
        <p className="t-body prose">
          No clients yet. Add the first one above and it appears on the board straight
          away.
        </p>
      ) : (
        // role="list" because base.css removes markers globally, and WebKit
        // drops a list's semantics when its markers are removed -- so in Safari
        // with VoiceOver this would otherwise announce as a group of paragraphs
        // with no count and no position. The label is what lets a test address
        // this list and what tells a screen reader which list it is.
        <ul aria-label="Clients" className={styles.list} role="list">
          {admin.clients.map((client) => (
            <li className={styles.row} key={client.id}>
              <div className={styles.rowHead}>
                <p className="t-body" data-testid="client-name">
                  {client.name}
                </p>
                {/* The label is the information; the fill is decoration. A
                    greyscale print or a colour-blind reader gets the word. */}
                <span
                  className={`status-pill ${isChurned(client.status) ? 'status-pill--ended' : ''}`}
                >
                  {statusLabel(client.status)}
                </span>
              </div>

              <p className="t-caption">{ownerText(client, admin.owners)}</p>

              {/* The list is where the owner checks eleven dates at a glance
                  without opening eleven forms, and "no start date" has to be
                  visible rather than blank -- a blank reads as a rendering
                  gap, and it is the reason a whole bucket is unscored.
                  The raw YYYY-MM-DD is deliberate, not a call to
                  formatSavedAt: that helper is for timestamps, and would parse
                  this as UTC midnight and print the day before in a western
                  zone -- the exact class of bug the gate is sensitive to. */}
              <p className="t-caption" data-testid="client-started">
                {client.started_on === null
                  ? 'No start date — Advocacy is not scored'
                  : `Started ${client.started_on}`}
              </p>

              {isChurned(client.status) && (
                <p className="t-caption" data-testid="client-ended">
                  Ended {client.ended_on ?? 'on an unrecorded date'} ·{' '}
                  {reasonLabel(client.end_reason_code)}
                  {client.end_reason_note === null ? '' : ` · ${client.end_reason_note}`}
                </p>
              )}

              {/* The durable half of spec §7's "survives a reload". The status
                  line beside a form says what just happened; this says when this
                  client last changed, and it is still here after a refresh
                  because it comes from updated_at. */}
              <p className="t-caption" data-testid="client-updated">
                Updated {formatSavedAt(client.updated_at)}
              </p>

              {editing?.id === client.id ? (
                // Correct today because this renders only inside the
                // `editing?.id === client.id` branch of one <li> -- opening a
                // different row unmounts this instance regardless of the key.
                // The key stays anyway, cheap belt-and-braces against a future
                // refactor that hoists a single form out of the list, so a
                // hoisted layout does not silently inherit a cross-row draft
                // bug.
                <EditClientForm
                  client={editing}
                  key={editing.id}
                  onCancel={() => {
                    setEditingId(null)
                    admin.resetEdit()
                  }}
                  onEdited={admin.resetEdit}
                  onSave={admin.saveClient}
                  owners={admin.owners}
                  // Only when the state belongs to THIS row. There is one
                  // editState for the whole screen and one form per row, so
                  // passing it unconditionally put Acme's "Changes saved
                  // <time>" beside Test Client's untouched fields the moment
                  // the rows were swapped mid-flight. A confirmation is a claim
                  // about a specific client, and a claim rendered beside a
                  // different one is false -- the defect this feature exists to
                  // eliminate, with the polarity reversed.
                  state={admin.editStateFor === client.id ? admin.editState : { kind: 'idle' }}
                />
              ) : (
                <div className={styles.actions}>
                  <button
                    className="button button--quiet"
                    // Not openable while an edit save is in flight. Two
                    // ordinary clicks inside one network round trip -- Save
                    // here, then Edit there -- swapped the form under a pending
                    // write. EditClientForm already disabled its own Save and
                    // Cancel; these were left out.
                    disabled={admin.editState.kind === 'saving'}
                    onClick={() => {
                      setEditingId(client.id)
                      // A confirmation from the previous row must not appear
                      // beside this one's fields.
                      admin.resetEdit()
                    }}
                    type="button"
                  >
                    {/* The client's name is in the accessible name, not only in
                        the row above it: "Edit" repeated twelve times is
                        unusable in a screen reader's control list. */}
                    Edit {client.name}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
