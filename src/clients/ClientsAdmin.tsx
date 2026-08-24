import { useState } from 'react'
import { formatSavedAt } from '../lib/month'
import { isChurned, reasonLabel, statusLabel } from './clientForm'
import type { AdminClient } from './clientForm'
import { AddClientForm } from './AddClientForm'
import { EditClientForm } from './EditClientForm'
import { useClients } from './useClients'
import type { OwnerOption } from './useClients'
import styles from './ClientsAdmin.module.css'

type Props = { onBack: () => void }

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

export function ClientsAdmin({ onBack }: Props) {
  const admin = useClients()

  // Which row's form is open, by id rather than by row object: the hook replaces
  // the row object after a save (that is how the list shows the new name), and a
  // held object would then be the pre-save copy.
  const [editingId, setEditingId] = useState<number | null>(null)
  const editing = admin.clients.find((client) => client.id === editingId) ?? null

  const back = (
    <nav className={styles.nav}>
      <button className="button button--quiet" type="button" onClick={onBack}>
        Board
      </button>
    </nav>
  )

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
        {back}
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
        {back}
        {masthead}
        <p className="t-body">Loading…</p>
      </section>
    )
  }

  return (
    <section className={styles.screen}>
      {back}
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
                  className={`${styles.statusPill} ${isChurned(client.status) ? styles.statusPillEnded : ''}`}
                >
                  {statusLabel(client.status)}
                </span>
              </div>

              <p className="t-caption">{ownerText(client, admin.owners)}</p>

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
                // Keyed by id so opening a different row remounts the form with
                // that row's values rather than keeping the first row's draft.
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
                  state={admin.editState}
                />
              ) : (
                <div className={styles.actions}>
                  <button
                    className="button button--quiet"
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
