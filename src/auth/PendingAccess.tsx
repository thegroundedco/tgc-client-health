type Props = {
  email: string
  onSignOut: () => void
}

export function PendingAccess({ email, onSignOut }: Props) {
  return (
    <main>
      <h1>Access pending</h1>
      <p>
        You are signed in as {email}, but your account has not been activated yet.
        An administrator needs to grant you access.
      </p>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </main>
  )
}
