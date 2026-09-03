import { Churn } from '../revenue/Churn'
import { Tenure } from '../revenue/Tenure'
import { currentRows, departedRows, todayISO } from '../revenue/tenureMath'
import { useTenure } from '../revenue/useTenure'
import styles from './Page.module.css'

// Spec §7. The report sits above the note about what is still missing, so the
// page reads: what we can tell you, then what we cannot and why. It stopped
// being a page that only apologises on 2026-09-03.
export function Revenue() {
  const report = useTenure()

  // Read once per render rather than per row, so every tenure on the screen is
  // measured against the same day. Two rows computed either side of midnight
  // would otherwise disagree by one day for no reason a reader could see.
  const asOf = todayISO()

  return (
    <section className={styles.page}>
      <h2 className="t-header">Revenue</h2>

      {report.status === 'loading' && <p className="t-body">Loading…</p>}

      {report.status === 'error' && (
        <p className="alert prose" role="alert">
          {report.loadError}
        </p>
      )}

      {report.status === 'ready' && (
        <>
          <Tenure rows={currentRows(report.clients, asOf)} />
          <Churn rows={departedRows(report.clients)} />
        </>
      )}

      {/* Still true, and still the reminder the owner asked for. */}
      <p className="t-body prose">
        Revenue retention is not here yet: it needs a data model that does not exist, and the hard
        part is that retention needs a history of monthly amounts — which a single editable
        retainer field cannot produce.
      </p>
    </section>
  )
}
