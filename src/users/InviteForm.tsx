import { useEffect, useRef, useState } from 'react'
import { ASSIGNABLE_ROLES, ROLE_HINTS, ROLE_LABELS, inviteProblems } from './userForm'
import type { AdminProfile, InviteDraft, WriteState } from './userForm'
import styles from './InviteForm.module.css'

type Props = {
  profiles: readonly AdminProfile[]
  state: WriteState
  onInvite: (draft: InviteDraft) => void
  // Called whenever the draft changes while a confirmation or refusal is on
  // screen. The parent uses it to clear that line -- see edit() below.
  onEdited: () => void
}

const EMPTY: InviteDraft = { email: '', role: 'viewer' }

export function InviteForm({ profiles, state, onInvite, onEdited }: Props) {
  const [draft, setDraft] = useState<InviteDraft>(EMPTY)
  const problems = inviteProblems(draft, profiles)
  const saving = state.kind === 'saving'

  // One place that both updates the form and clears a stale confirmation, so no
  // edit path can forget the second half. AddClientForm.tsx says why, and it is
  // worth repeating here rather than pointing at it: a confirmation left
  // standing beside a form somebody has since changed is the same class of lie
  // as no confirmation at all. The sequence this closes is ordinary -- invite A,
  // read "a@x invited", type B, and the screen still says A was invited beside
  // an address that is now B's.
  function edit(next: InviteDraft) {
    setDraft(next)
    if (state.kind !== 'idle') onEdited()
  }

  // `state` is admin.inviteState from useUsers, and that single state is
  // shared between invite() AND revokeInvite() -- deliberately, so the screen
  // has one invite-level message region rather than two. Which means a 'saved'
  // here does not mean THIS form's write landed; it means the most recent
  // write to EITHER control did. Pressing Revoke on some other pending
  // invitation produces exactly the same { kind: 'saved' } shape this effect
  // used to key off of, so it would clear a draft nobody submitted -- reachable
  // by the ordinary sequence of typing a corrected address and then revoking
  // the address it replaces.
  //
  // submitted is this form's own record of having been the one that called
  // onInvite, so the clear only fires for a save this form actually caused.
  const submitted = useRef(false)

  // Cleared on a CONFIRMED invite from THIS form, never on the press. This used
  // to run inside onSubmit, which loses the typed address the instant the write
  // is refused -- and the likeliest refusal this form will ever see is
  // allowed_emails_pkey (the address is already invited) or a dropped
  // connection, which are precisely the cases where somebody wants to look at
  // what they typed and change one word of it. Same reasoning, and the same
  // fix, as AddClientForm.tsx: a failed write keeps the form populated.
  //
  // Safe against re-firing: once this runs, `state` is unchanged, so the effect
  // does not re-run. The next keystroke calls edit(), which resets the state to
  // idle and moves the dependency off 'saved' for good. submitted is reset on
  // every terminal state (saved or failed), not only on the branch that used
  // it, so a stale true left over from an earlier submit can never latch onto a
  // later, unrelated 'saved' produced by a revoke.
  useEffect(() => {
    if (state.kind === 'saved' && submitted.current) setDraft(EMPTY)
    if (state.kind === 'saved' || state.kind === 'failed') submitted.current = false
  }, [state])

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        // Checked here as well as on the disabled button: a form submits on
        // Enter in a text field, which does not consult the button.
        if (saving || problems.length > 0) return
        submitted.current = true
        onInvite(draft)
      }}
    >
      {/* One label above one control. Bare, these were inline siblings and
          rendered as a single run -- "EMAIL ADDRESS[input]ROLE[select]" -- with
          each label jammed against the field it names. */}
      <div className={styles.fieldBlock}>
        <label htmlFor="invite-email" className="t-label">Email address</label>
        <input
          id="invite-email"
          type="email"
          value={draft.email}
          disabled={saving}
          onChange={(event) => edit({ ...draft, email: event.target.value })}
        />
      </div>

      <div className={styles.fieldBlock}>
        <label htmlFor="invite-role" className="t-label">Role</label>
        <select
          id="invite-role"
          value={draft.role}
          disabled={saving}
          onChange={(event) => edit({ ...draft, role: event.target.value })}
        >
          {ASSIGNABLE_ROLES.map((role) => (
            <option key={role} value={role}>{ROLE_LABELS[role] ?? role}</option>
          ))}
        </select>
        {/* Inside the field block, so it reads as a caption for the select it
            describes rather than as a stray sentence after the form. */}
        <p className={`t-small ${styles.hint}`}>{ROLE_HINTS[draft.role] ?? ''}</p>
      </div>

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
