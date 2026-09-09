import { Churn } from '../revenue/Churn'
import { Concentration } from '../revenue/Concentration'
import { Retention } from '../revenue/Retention'
import { Tenure } from '../revenue/Tenure'
import { defaultPeriod } from '../lib/month'
import { currentRows, departedRows, todayISO } from '../revenue/tenureMath'
import { useTenure } from '../revenue/useTenure'
import styles from './Page.module.css'

// Spec §7. As of slice 6f-1 every section here reports something rather than
// apologising for its absence: the paragraph that used to close this page,
// naming a date by which retention would become possible, is retired -- it
// went stale once already (the backfill landed before the date it named), and
// Retention below now renders the real thing instead of a promise about it.
export function Revenue() {
  const report = useTenure()

  // Read once per render rather than per row, so every tenure on the screen is
  // measured against the same day. Two rows computed either side of midnight
  // would otherwise disagree by one day for no reason a reader could see.
  const asOf = todayISO()

  return (
    <section className={styles.page}>
      <h2 className="t-header">Revenue</h2>

      <Concentration month={defaultPeriod()} />

      <Retention />

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
    </section>
  )
}
