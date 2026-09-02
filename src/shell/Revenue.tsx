import styles from './Page.module.css'

// Spec §6.2. The blocker below is the reminder the owner asked for, not an
// apology for the page being empty.
export function Revenue() {
  return (
    <section className={styles.page}>
      <h2 className="t-header">Revenue</h2>
      <p className="t-body prose">
        This will hold revenue retention, churn and how long clients stay.
      </p>
      <p className="t-body prose">
        Churn and tenure are ready to build. Revenue retention is not: it needs a data model
        that does not exist yet, and the hard part is that retention needs a history of monthly
        amounts — which a single editable retainer field cannot produce.
      </p>
    </section>
  )
}
