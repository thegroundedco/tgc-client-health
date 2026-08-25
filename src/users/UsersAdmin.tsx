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
      <p className="t-eyebrow">People</p>
      <h2 className="t-header">Access</h2>
    </div>
  )

  if (admin.status === 'loading') {
    return <>{back}{masthead}<p className="t-body">Loading…</p></>
  }

  if (admin.status === 'error') {
    return <>{back}{masthead}<p className="t-body">{admin.loadError}</p></>
  }

  return (
    <>
      {back}
      {masthead}

      <section>
        <h3 className="t-subhead">People</h3>
        <ul>
          {admin.profiles.map((row) => {
            const isSelf = row.id === currentUserId
            return (
              <li key={row.id}>
                <p className="t-body">{row.full_name?.trim() || row.email}</p>
                <p className="t-small">{row.email}</p>

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
                  className="button button--quiet"
                  type="button"
                  disabled={isSelf || writing}
                  onClick={() => admin.setActive(row.id, !row.is_active)}
                >
                  {row.is_active ? 'Deactivate' : 'Activate'}
                </button>

                {isSelf && (
                  <p className="t-small">
                    You cannot change your own access. That is what makes it
                    impossible to lock every admin out. Another admin can.
                  </p>
                )}

                {admin.editStateFor === row.id && admin.editState.kind === 'failed' && (
                  <p className="t-small">{admin.editState.message}</p>
                )}
                {admin.editStateFor === row.id && admin.editState.kind === 'saved' && (
                  <p className="t-small">
                    {admin.editState.what} {formatSavedAt(admin.editState.at)}.
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h3 className="t-subhead">Invited — not yet signed in</h3>

        {/* An explicit empty state. A blank region reads as a failed load, which
            is this project's signature defect wearing a new mask. */}
        {admin.invitations.length === 0 ? (
          <p className="t-body prose">
            Nobody is waiting. Invite someone below and they will have access the
            first time they sign in.
          </p>
        ) : (
          <ul>
            {admin.invitations.map((row) => (
              <li key={row.email}>
                <p className="t-body">{row.email}</p>
                <p className="t-small">
                  {roleLabel(row.role)} · invited {formatSavedAt(row.created_at)}
                </p>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={writing}
                  onClick={() => admin.revokeInvite(row.email)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}

        <InviteForm
          profiles={admin.profiles}
          state={admin.inviteState}
          onInvite={admin.invite}
        />

        {admin.inviteState.kind === 'failed' && (
          <p className="t-small">{admin.inviteState.message}</p>
        )}
        {admin.inviteState.kind === 'saved' && (
          <p className="t-small">
            {admin.inviteState.what} {formatSavedAt(admin.inviteState.at)}.
          </p>
        )}
      </section>
    </>
  )
}
