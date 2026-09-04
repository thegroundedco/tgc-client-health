import { Churn } from '../revenue/Churn'
import { Concentration } from '../revenue/Concentration'
import { Tenure } from '../revenue/Tenure'
import { defaultPeriod } from '../lib/month'
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

      <Concentration month={defaultPeriod()} />

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

      {/* Revenue.tsx no longer has an excuse: the monthly history slice 6c
          built is what retention needs, and it is here. What is left is
          arithmetic waiting on a calendar, not a missing data model --
          revenueMath.rate() refuses to run until it has thirteen months to
          measure across, one period and the twelve behind it, and the
          earliest month that can supply them is April 2027. */}
      <p className="t-body prose">
        Revenue retention is not here yet: it needs thirteen months of entered revenue to measure
        a rate across, and the earliest month that will have them is April 2027.
      </p>
    </section>
  )
}
