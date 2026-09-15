import { useState } from 'react'
import { Billing } from '../revenue/Billing'
import { Mix } from '../revenue/Mix'
import { RangeControl } from '../revenue/RangeControl'
import { resolveRange } from '../revenue/rangeMath'
import type { CompareMode, RangePreset } from '../revenue/rangeMath'
import { Churn } from '../revenue/Churn'
import { Concentration } from '../revenue/Concentration'
import { Retention } from '../revenue/Retention'
import { Tenure } from '../revenue/Tenure'
import { defaultPeriod } from '../lib/month'
import { latestPeriod } from '../revenue/retentionMath'
import { currentRows, departedRows, todayISO } from '../revenue/tenureMath'
import { useRetention } from '../revenue/useRetention'
import { useTenure } from '../revenue/useTenure'
import styles from './Revenue.module.css'

// Spec §7, reordered by slice 6d. The owner saw this page with data in it and
// said it was confusing to read; asked which part, he said all four sections.
//
// The order is now an argument rather than an accident: what we are billing and
// whether it is moving, then how much of last year we kept, then who we are most
// exposed to, then how long clients stay and who left. Aggregate to individual.
// Billing leads because a chart is the most legible thing on the page and gives
// the eye somewhere to land; Retention is second because it is the figure the
// owner reports upward, and it used to be at the bottom.
//
// On a wide viewport the four sections after Billing PAIR into two columns --
// Retention beside Concentration, Tenure beside Churn -- by grid
// auto-placement, so the order above is still the order of the DOM and the
// order a screen reader and a narrow viewport both get. Revenue.module.css
// explains why the page is not simply made wide instead.
export function Revenue() {
  const report = useTenure()

  // ONE read, shared by Billing and Retention. Both want the whole revenue
  // table; two hooks would fetch it twice and could anchor to different months.
  const revenue = useRetention()

  // Read once per render rather than per row, so every tenure on the screen is
  // measured against the same day. Two rows computed either side of midnight
  // would otherwise disagree by one day for no reason a reader could see.
  const asOf = todayISO()

  // The chart anchors on the latest month holding an entry, exactly as
  // retention does -- the same function, so the two cannot disagree about which
  // month is current.
  const anchor = latestPeriod(revenue.rows)

  // The page's date range, slice 6h. Owned here rather than by Billing because
  // it governs Concentration as well, and state that two siblings share has to
  // live above both of them.
  const [preset, setPreset] = useState<RangePreset>('last12')
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [compare, setCompare] = useState<CompareMode>('none')

  const months = [...new Set(revenue.rows.map((row) => row.period))].sort()
  const extent = {
    anchor: months.length > 0 ? months[months.length - 1] : null,
    earliest: months.length > 0 ? months[0] : null,
  }
  const fallback = custom ?? {
    from: extent.earliest ?? defaultPeriod(),
    to: extent.anchor ?? defaultPeriod(),
  }
  const range = preset === 'custom' ? fallback : resolveRange(preset, extent)

  return (
    <section className={styles.page}>
      <h2 className={`t-header ${styles.wide}`}>Revenue</h2>

      {revenue.status === 'loading' && (
        <p className={`t-body ${styles.wide}`}>Loading…</p>
      )}

      {revenue.status === 'error' && (
        <p className={`alert prose ${styles.wide}`} role="alert">
          {revenue.loadError}
        </p>
      )}

      {/* Wrapped rather than given the class directly, so Billing keeps taking
          no layout props and stays mountable somewhere that is not this grid. */}
      {revenue.status === 'ready' && (
        <div className={styles.wide}>
          <RangeControl
            compare={compare}
            custom={fallback}
            extent={extent}
            months={months}
            onCompare={setCompare}
            onCustom={setCustom}
            onPreset={setPreset}
            preset={preset}
          />
        </div>
      )}

      {revenue.status === 'ready' && (
        <div className={styles.wide}>
          <Billing
            clients={revenue.clients}
            compare={compare}
            currentPeriod={anchor ?? defaultPeriod()}
            range={range}
            rows={revenue.rows}
          />
        </div>
      )}

      <Retention read={revenue} />

      <Concentration
        clients={revenue.clients}
        from={range?.from ?? null}
        loadError={revenue.loadError}
        rows={revenue.rows}
        status={revenue.status}
        to={range?.to ?? null}
      />

      {report.status === 'loading' && (
        <p className={`t-body ${styles.wide}`}>Loading…</p>
      )}

      {report.status === 'error' && (
        <p className={`alert prose ${styles.wide}`} role="alert">
          {report.loadError}
        </p>
      )}

      {report.status === 'ready' && (
        <>
          <Tenure rows={currentRows(report.clients, asOf)} />
          <Churn asOf={asOf} rows={departedRows(report.clients)} />
        </>
      )}

      {/* Last, and outside the range control's reach: it answers a question
          about relationships rather than about months. */}
      <Mix
        asOf={asOf}
        clients={revenue.clients}
        loadError={revenue.loadError}
        rows={revenue.rows}
        status={revenue.status}
      />
    </section>
  )
}
