import { useState } from 'react'
import { ASSIGNABLE_ROLES, ROLE_HINTS, ROLE_LABELS, inviteProblems } from './userForm'
import type { AdminProfile, InviteDraft, WriteState } from './userForm'

type Props = {
  profiles: readonly AdminProfile[]
  state: WriteState
  onInvite: (draft: InviteDraft) => void
}

const EMPTY: InviteDraft = { email: '', role: 'viewer' }

export function InviteForm({ profiles, state, onInvite }: Props) {
  const [draft, setDraft] = useState<InviteDraft>(EMPTY)
  const problems = inviteProblems(draft, profiles)
  const saving = state.kind === 'saving'

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        // Checked here as well as on the disabled button: a form submits on
        // Enter in a text field, which does not consult the button.
        if (saving || problems.length > 0) return
        onInvite(draft)
        setDraft(EMPTY)
      }}
    >
      <label htmlFor="invite-email" className="t-label">Email address</label>
      <input
        id="invite-email"
        type="email"
        value={draft.email}
        disabled={saving}
        onChange={(event) => setDraft({ ...draft, email: event.target.value })}
      />

      <label htmlFor="invite-role" className="t-label">Role</label>
      <select
        id="invite-role"
        value={draft.role}
        disabled={saving}
        onChange={(event) => setDraft({ ...draft, role: event.target.value })}
      >
        {ASSIGNABLE_ROLES.map((role) => (
          <option key={role} value={role}>{ROLE_LABELS[role] ?? role}</option>
        ))}
      </select>
      <p className="t-small">{ROLE_HINTS[draft.role] ?? ''}</p>

      {/* Shown, not merely used to disable the button. A control that is dead
          for a reason nobody states is the defect this project keeps finding. */}
      {problems.map((problem) => (
        <p key={problem.field} className="t-small">{problem.text}</p>
      ))}

      <button className="button" type="submit" disabled={saving || problems.length > 0}>
        {saving ? 'Inviting…' : 'Invite'}
      </button>
    </form>
  )
}
