import { formatSavedAt } from '../lib/month'
import { InviteForm } from './InviteForm'
import { useUsers } from './useUsers'
import { ASSIGNABLE_ROLES, ROLE_LABELS, roleLabel } from './userForm'
import styles from './UsersAdmin.module.css'

type Props = { onBack: () => void; currentUserId: string }

export function UsersAdmin({ onBack, currentUserId }: Props) {
  const admin = useUsers()
  const writing = admin.inviteState.kind === 'saving' || admin.editState.kind === 'saving'

  // Disabled while either write is in flight, matching ClientsAdmin: leaving
  // unmounts this screen and the write then lands with nobody left to read its
  // confirmation -- a write that worked looking exactly like one that did not.
  const back = (
    <nav className={styles.nav}>
      <button className="button button--quiet" disabled={writing} type="button" onClick={onBack}>
        Board
      </button>
    </nav>
  )

  const masthead = (
    <div className="masthead">
      <p className="t-eyebrow">Admin</p>
      <h2 className="t-header">People</h2>
    </div>
  )

  if (admin.status === 'loading') {
    return (
      <section className={styles.screen}>
        {back}
        {masthead}
        <p className="t-body">Loading…</p>
      </section>
    )
  }

  if (admin.status === 'error') {
    return (
      <section className={styles.screen}>
        {back}
        {masthead}
        <p className="t-body">{admin.loadError}</p>
      </section>
    )
  }

  return (
    <section className={styles.screen}>
      {back}
      {masthead}

      <section className={styles.block}>
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
            const rowName = row.full_name?.trim() || row.email

            return (
              <li className={styles.row} key={row.id}>
                <div className={styles.rowHead}>
                  <div className={styles.rowWho}>
                    <p className="t-body">{rowName}</p>
                    {/* Only when the heading is not ALREADY the address. rowName
                        falls back to row.email for an account with no name, and
                        printing both unconditionally showed the same address
                        twice -- which is every account that signed in by magic
                        link and never set a name, so it was the common case,
                        not the edge one. Pinned by UsersAdmin.dom.test.tsx in
                        both directions. */}
                    {rowName !== row.email && <p className="t-small">{row.email}</p>}
                  </div>

                  <div className={styles.actions}>
                    {/* Wrapped so .field's width:100% resolves against a bounded
                        box rather than the flex line -- see .rolePicker. */}
                    <div className={styles.rolePicker}>
                      <select
                        aria-label={`Role for ${row.email}`}
                        className="field"
                        value={row.role}
                        disabled={isSelf || writing}
                        onChange={(event) => admin.setRole(row.id, event.target.value)}
                      >
                        {/* The stored role is offered even when it is not one of
                            the three, so a row written outside this screen still
                            shows what it holds instead of reading as a viewer. */}
                        {(ASSIGNABLE_ROLES.includes(row.role)
                          ? ASSIGNABLE_ROLES
                          : [...ASSIGNABLE_ROLES, row.role]
                        ).map((role) => (
                          <option key={role} value={role}>{ROLE_LABELS[role] ?? role}</option>
                        ))}
                      </select>
                    </div>

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
                </div>

                {isSelf && (
                  <p className="t-small">
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
                  <p className="t-small" role="status">{admin.editState.message}</p>
                )}
                {admin.editStateFor === row.id && admin.editState.kind === 'saved' && (
                  <p className="t-small" role="status">
                    {admin.editState.what} {formatSavedAt(admin.editState.at)}.
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className={styles.block}>
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
                <div className={styles.rowHead}>
                  <div className={styles.rowWho}>
                    <p className="t-body">{row.email}</p>
                    <p className="t-small">
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
