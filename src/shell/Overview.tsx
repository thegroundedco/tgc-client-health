import styles from './Page.module.css'

// Spec §6.1. Deliberately empty of CONTENT, not of explanation.
//
// This page has a history worth knowing before adding anything to it: six stat
// lines were once proposed for exactly this screen, the owner did not recognise
// them when asked, and they were retired as never-sourced. Its contents are a
// conversation with him, not a guess. Do not fill this in without one.
export function Overview() {
  return (
    <section className={styles.page}>
      <h2 className="t-header">Overview</h2>
      <p className="t-body prose">
        This will be the snapshot — the few things worth seeing the moment you open the tool.
        What belongs here has not been decided yet, so it is empty on purpose rather than
        filled with a guess.
      </p>
      <p className="t-body prose">
        In the meantime, Clients has this month&rsquo;s scores and the matrix.
      </p>
    </section>
  )
}
