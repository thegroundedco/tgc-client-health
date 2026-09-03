import { formatTenure, summarise } from './tenureMath'
import type { CurrentRow } from './tenureMath'
import styles from './Revenue.module.css'

// How long each current client has been with the firm, longest-standing first.
// The order and the arithmetic are the caller's -- this renders what it is
// given, which is what keeps the sort rule (unknowns last, spec §3) testable
// without a DOM.
export function Tenure({ rows }: { rows: readonly CurrentRow[] }) {
  const summary = summarise(rows)

  if (rows.length === 0) {
    // An explicit empty state. A blank region reads as a failed load, which is
    // this project's signature defect wearing a new mask.
    return (
      <section className={styles.section}>
        <h3 className="t-subhead">How long clients stay</h3>
        <p className="t-body prose">
          No clients yet. Add one on the Admin screen and their tenure starts counting from the
          start date you give them.
        </p>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <h3 className="t-subhead">How long clients stay</h3>

      {/* Median rather than mean: with a roster this size one long relationship
          drags a mean somewhere no client actually sits. And the unmeasured are
          counted but not measured -- said out loud, because a summary that
          quietly measured two of three would be a true sentence about a group
          the reader thinks is bigger than it is. Spec §3. */}
      <p className={`t-caption ${styles.summary}`} data-testid="tenure-summary">
        {summary.total} {summary.total === 1 ? 'client' : 'clients'}
        {summary.medianDays !== null && ` · median ${formatTenure(summary.medianDays)}`}
        {summary.longestDays !== null && ` · longest ${formatTenure(summary.longestDays)}`}
        {summary.measured < summary.total &&
          ` · ${summary.total - summary.measured} without a start date`}
      </p>

      {/* role="list" because base.css removes markers globally, and WebKit drops
          a list's semantics when its markers are removed -- so in Safari with
          VoiceOver this would otherwise announce as a group of paragraphs with
          no count and no position. The admin screens do the same. */}
      <ul aria-label="Tenure" className={styles.list} role="list">
        {rows.map((row) => (
          <li className={styles.row} key={row.client.id}>
            <span className={styles.who}>
              <span className="t-body">{row.client.name}</span>
              {row.paused && <span className={`t-caption ${styles.marker}`}>Paused</span>}
            </span>
            <span className={`t-body ${styles.measure}`}>{formatTenure(row.days)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
