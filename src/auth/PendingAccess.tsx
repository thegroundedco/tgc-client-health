import styles from './PendingAccess.module.css'

type Props = {
  email: string
  onSignOut: () => void
}

export function PendingAccess({ email, onSignOut }: Props) {
  return (
    <main className={styles.screen}>
      <div>
        <p className="t-eyebrow">Client Health</p>
        <h1 className="t-header">Access pending</h1>
      </div>
      <p className="t-body prose">
        You are signed in as {email}, but your account has not been activated yet.
        An administrator needs to grant you access.
      </p>
      <div className={styles.actions}>
        <button className="button button--quiet" type="button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </main>
  )
}
