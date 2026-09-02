import { useEffect } from 'react'
import { formatSavedAt } from '../lib/month'
import { InviteForm } from './InviteForm'
import { useUsers } from './useUsers'
import { ASSIGNABLE_ROLES, ROLE_LABELS, roleLabel } from './userForm'
import styles from './UsersAdmin.module.css'

type Props = {
  currentUserId: string
  onWritingChange?: (writing: boolean) => void
}

export function UsersAdmin({ currentUserId, onWritingChange }: Props) {
  const admin = useUsers()
  const writing = admin.inviteState.kind === 'saving' || admin.editState.kind === 'saving'

  // Reported upward for the same reason ClientsAdmin reports it: Slice 6a drew a
  // permanently-enabled menu bar above this screen, so the disabled Back button
  // below is no longer the only way out. Changing a role and pressing Clients in
  // the bar while the PATCH is in flight unmounts this screen, and the refusal
  // is never seen. The shell disables the bar while this is true.
  useEffect(() => {
    onWritingChange?.(writing)
  }, [onWritingChange, writing])

  const masthead = (
    <div className="masthead">
      <p className="t-eyebrow">People</p>
      <h2 className="t-header">Access</h2>
    </div>
  )

  if (admin.status === 'loading') {
    return (
      <section className={styles.screen}>
        {masthead}
        <p className="t-body">Loading…</p>
      </section>
    )
  }

  if (admin.status === 'error') {
    return (
      <section className={styles.screen}>
        {masthead}
        <p className="t-body">{admin.loadError}</p>
      </section>
    )
  }

  return (
    <section className={styles.screen}>
      {masthead}

      <section className={styles.section}>
        {/* "With access", not "People": the masthead above already says PEOPLE,
            and a section heading repeating it named nothing. These two headings
            now say what actually separates the lists -- who is in, and who has
            been asked. */}
        <h3 className="t-subhead">With access</h3>
        {/* role="list" because base.css removes markers globally, and WebKit
            drops a list's semantics when its markers are removed -- so in
            Safari with VoiceOver this would otherwise announce as a group of
            paragraphs with no count and no position. Matches ClientsAdmin's
            client list for the same reason. */}
        <ul aria-label="People" className={styles.list} role="list">
          {admin.profiles.map((row) => {
            const isSelf = row.id === currentUserId
            // The same value the row displays as its heading, so a
            // screen-reader user hears who a control acts on rather than a
            // UUID -- the same fix ClientsAdmin makes for its Edit button
            // ("Edit {client.name}"): a bare "Activate" or "Deactivate"
            // repeated down the list is unusable in a screen reader's
            // control list.
            const name = row.full_name?.trim()
            const rowName = name || row.email

            return (
              <li className={styles.row} key={row.id}>
                <div className={styles.identity}>
                  <p className="t-body">{rowName}</p>
                  {/* Only when there is a NAME sitting above it. rowName falls
                      back to the address, so printing both unconditionally
                      rendered the same address on two lines for everybody who
                      has not set a full name -- which, on this roster, was
                      everybody but the owner. Reported from the deployed page
                      2026-09-02. */}
                  {name && <p className={`t-small ${styles.email}`}>{row.email}</p>}
                </div>

                <div className={styles.actions}>
                <select
                  aria-label={`Role for ${row.email}`}
                  value={row.role}
                  disabled={isSelf || writing}
                  onChange={(event) => admin.setRole(row.id, event.target.value)}
                >
                  {/* The stored role is offered even when it is not one of the
                      three, so a row written outside this screen still shows
                      what it holds instead of silently reading as a viewer. */}
                  {(ASSIGNABLE_ROLES.includes(row.role)
                    ? ASSIGNABLE_ROLES
                    : [...ASSIGNABLE_ROLES, row.role]
                  ).map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role] ?? role}</option>
                  ))}
                </select>

                <button
                  aria-label={`${row.is_active ? 'Deactivate' : 'Activate'} ${rowName}`}
                  className="button button--quiet"
                  type="button"
                  disabled={isSelf || writing}
                  onClick={() => admin.setActive(row.id, !row.is_active)}
                >
                  {row.is_active ? 'Deactivate' : 'Activate'}
                </button>
                </div>

                {isSelf && (
                  <p className={`t-small ${styles.rowNote}`}>
                    You cannot change your own access. That is what makes it
                    impossible to lock every admin out. Another admin can.
                  </p>
                )}

                {/* role="status" so the confirmation or refusal is announced
                    rather than only drawn -- the same fix AddClientForm makes
                    for its own confirmation line, and the whole reason Slice 1
                    was rewritten: a write that worked looked exactly like one
                    that failed.

                    `admin.editStateFor === row.id` is this list's whole
                    staleness defence, and it is sufficient here where
                    ClientsAdmin needed resetEdit as well. The difference is that
                    ClientsAdmin holds a DRAFT: its edit form keeps fields the
                    person can change after a save, so its confirmation can come
                    to describe something the form no longer says. These rows
                    hold no draft -- the select and the button read straight off
                    `row`, every interaction with them IS a write, and each write
                    re-points editStateFor at the row it belongs to before it
                    reports anything. So there is no sequence in which this line
                    outlives the change it describes; that is why
                    `admin.resetEdit` has no caller on this screen, and it is
                    deliberate rather than an omission. */}
                {admin.editStateFor === row.id && admin.editState.kind === 'failed' && (
                  <p className={`t-small ${styles.rowNote}`} role="status">
                    {admin.editState.message}
                  </p>
                )}
                {admin.editStateFor === row.id && admin.editState.kind === 'saved' && (
                  <p className={`t-small ${styles.rowNote}`} role="status">
                    {admin.editState.what} {formatSavedAt(admin.editState.at)}.
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className={styles.section}>
        <h3 className="t-subhead">Invited — not yet signed in</h3>

        {/* An explicit empty state. A blank region reads as a failed load, which
            is this project's signature defect wearing a new mask. */}
        {admin.invitations.length === 0 ? (
          <p className="t-body prose">
            Nobody is waiting. Invite someone below and they will have access the
            first time they sign in.
          </p>
        ) : (
          // role="list" for the same reason as the People list above: base.css
          // strips markers globally, and Safari/VoiceOver drops list semantics
          // along with them.
          <ul aria-label="Invitations" className={styles.list} role="list">
            {admin.invitations.map((row) => (
              <li className={styles.row} key={row.email}>
                <div className={styles.identity}>
                  <p className="t-body">{row.email}</p>
                  <p className={`t-small ${styles.email}`}>
                    {roleLabel(row.role)} · invited {formatSavedAt(row.created_at)}
                  </p>
                </div>

                <div className={styles.actions}>
                <button
                  aria-label={`Revoke invitation for ${row.email}`}
                  className="button button--quiet"
                  type="button"
                  disabled={writing}
                  onClick={() => admin.revokeInvite(row.email)}
                >
                  Revoke
                </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* onEdited is what keeps the confirmation below honest. Without it the
            sequence is: invite A, read "a@x invited", the form clears, type B,
            and the screen still says A was invited beside a form that now holds
            B. ClientsAdmin wires resetAdd/resetEdit for exactly this, and
            AddClientForm states the rule: a confirmation left standing beside a
            form somebody has since changed is the same class of lie as no
            confirmation at all. It clears the REVOKE confirmation too -- both
            share inviteState, and "invitation for c@x revoked" is just as stale
            once the admin is typing a fresh address. */}
        <InviteForm
          profiles={admin.profiles}
          state={admin.inviteState}
          onInvite={admin.invite}
          onEdited={admin.resetInvite}
        />

        {admin.inviteState.kind === 'failed' && (
          <p className="t-small" role="status">{admin.inviteState.message}</p>
        )}
        {admin.inviteState.kind === 'saved' && (
          <p className="t-small" role="status">
            {admin.inviteState.what} {formatSavedAt(admin.inviteState.at)}.
          </p>
        )}
      </section>
    </section>
  )
}
