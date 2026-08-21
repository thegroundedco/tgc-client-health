import { useState } from 'react'
import { supabase } from '../lib/supabase'
import styles from './SignIn.module.css'

export function SignIn() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setState('sending')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) {
      setState('error')
      setMessage(error.message)
      return
    }
    setState('sent')
  }

  if (state === 'sent') {
    return (
      <main className={styles.screen}>
        <div className={styles.sent}>
          <h1 className="t-header">Check your email</h1>
          <p className="t-body prose">
            We sent a sign-in link to {email}. Open it on this device.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.screen}>
      <div className={styles.masthead}>
        <p className="t-eyebrow">The Grounded Company</p>
        <h1 className="t-display">Client Health</h1>
      </div>
      <form className={styles.form} onSubmit={submit}>
        <label className="t-label" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          className="field"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button className="button" type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
        </button>
      </form>
      {state === 'error' && (
        <p className="alert prose" role="alert">
          Could not send the link: {message}
        </p>
      )}
    </main>
  )
}
