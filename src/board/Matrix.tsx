import { BUCKETS, BUCKET_DEFINITIONS } from '../lib/buckets'
import { formatPeriod } from '../lib/month'
import { BAND_LABELS, bandFor } from '../lib/scoreMath'
import { isOpenable } from './boardScope'
import type { CardCheckin } from './cardSummary'
import {
  averageDescription,
  cellValue,
  columnAverage,
  matrixRows,
  needsAsterisk,
} from './matrixMath'
import type { BoardClient, BoardScore } from './useBoard'
import styles from './Matrix.module.css'

type Props = {
  clients: readonly BoardClient[]
  checkins: ReadonlyMap<number, CardCheckin>
  scores: ReadonlyMap<number, BoardScore>
  period: string
  onOpen: (client: BoardClient) => void
}

// One number, or the absence of one. An em dash and never a 0: an incomplete
// check-in has no score, and a false "at risk" is as harmful as a false
// "healthy". The dash is aria-hidden with a word beside it, because a screen
// reader announcing "em dash" in a grid of sixty cells says nothing.
//
// Two decimals everywhere, matching the card's total and what the view stores.
// 3.5 and 3.50 are the same number, but only one of them lines up in a column.
function Score({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className={styles.hidden}>Not scored</span>
      </>
    )
  }
  return <>{value.toFixed(2)}</>
}

// The board's second view: every active client down the rows, the six buckets
// across, and what the agency averages in each. Spec §4.
//
// It holds no arithmetic. Every number here comes from matrix.ts, and every
// bucket cell is the Postgres-generated column the card's bar already reads --
// so the two views cannot disagree about a bucket by construction rather than
// by test.
//
// The band is carried as `data-band` rather than through bandClassName(),
// which produces the `.band` PILL from base.css: inline-flex, pill radius,
// uppercase, caption face. That is right for a chip beside a name and wrong for
// a table cell full of digits. The attribute gives the stylesheet a selector and
// keeps the four band values from being spelled out a second time here.
export function Matrix({ clients, checkins, scores, period, onOpen }: Props) {
  const rows = matrixRows(clients, checkins, scores)

  // Reachable with the archive toggle on and every client archived: Board's
  // empty-roster branch does not fire in that case, because what it measures is
  // the list the CARDS are showing. Said outright rather than left as an empty
  // table, which reads as a failed load.
  if (rows.length === 0) {
    return <p className="t-body prose">No active clients to show.</p>
  }

  // Computed once: the footer cells need them, and so does the decision about
  // whether the footnote is drawn at all.
  const columns = BUCKETS.map((bucket) => ({
    bucket,
    definition: BUCKET_DEFINITIONS[bucket],
    average: columnAverage(rows, bucket, period),
  }))
  const anyAsterisk = columns.some((column) => needsAsterisk(column.average))

  return (
    <div className={styles.matrix}>
      <div className={styles.scroller}>
        <table className={styles.table} data-testid="matrix-table">
          {/* Names what the table is and which month it covers, so it is
              self-describing when read out of the page's context. */}
          <caption className={`t-caption ${styles.caption}`}>
            Client health by bucket, {formatPeriod(period)}
          </caption>
          <thead>
            <tr>
              <th className={`t-label ${styles.headName}`} scope="col">
                Client
              </th>
              {columns.map(({ bucket, definition }) => (
                // The letter for the eye, the word for the ear: without the
                // hidden label a screen reader announces "C" and the reader has
                // to know the rubric by heart to place the column.
                <th className={`t-label ${styles.head}`} key={bucket} scope="col">
                  <span aria-hidden="true">{definition.initial}</span>
                  <span className={styles.hidden}>{definition.label}</span>
                </th>
              ))}
              <th className={`t-label ${styles.head}`} scope="col">
                Overall
              </th>
              <th className={`t-label ${styles.head}`} scope="col">
                Band
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const band = bandFor(row.overall)
              return (
                <tr data-testid="matrix-row" key={row.client.id}>
                  <th className={styles.name} data-band={band} scope="row">
                    {/* isOpenable is applied rather than assumed. The matrix
                        only ever shows active clients, so it never refuses
                        here -- but the reason the rule exists is that
                        checkins_insert_edit_scores carries no status predicate
                        of its own, and a view that assumes instead of asking is
                        how that gap gets reopened. */}
                    {isOpenable(row.client.status) ? (
                      <button
                        className={styles.open}
                        onClick={() => onOpen(row.client)}
                        type="button"
                      >
                        {row.client.name}
                      </button>
                    ) : (
                      row.client.name
                    )}
                  </th>
                  {columns.map(({ bucket }) => {
                    const value = cellValue(row, bucket)
                    return (
                      <td
                        className={`${styles.cell} numeric`}
                        data-band={bandFor(value)}
                        data-testid="matrix-cell"
                        key={bucket}
                      >
                        <Score value={value} />
                      </td>
                    )
                  })}
                  <td
                    className={`${styles.cell} numeric`}
                    data-band={band}
                    data-testid="matrix-overall"
                  >
                    <Score value={row.overall} />
                  </td>
                  {/* The band always carries its text label. Colour is never
                      the only signal: teal against warm red measures 1.76:1.
                      Parent spec §9.3. */}
                  <td className={styles.cell} data-band={band} data-testid="matrix-band">
                    {BAND_LABELS[band]}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className={styles.name} scope="row">
                Average
              </th>
              {columns.map(({ bucket, average }) => (
                <td
                  className={`${styles.cell} numeric`}
                  data-band={bandFor(average.mean)}
                  data-testid="matrix-average"
                  key={bucket}
                >
                  <Score value={average.mean} />
                  {needsAsterisk(average) && (
                    <>
                      <span aria-hidden="true">*</span>
                      <span className={styles.hidden}>{averageDescription(average)}</span>
                    </>
                  )}
                </td>
              ))}
              {/* The Average row stops before Overall. An agency-wide "overall
                  of overalls" would average numbers built on different
                  divisors, and nobody has asked for one. */}
              <td className={styles.blank} colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      {/* The asterisk's meaning, stated once rather than left to be guessed --
          and only when there is an asterisk to explain. */}
      {anyAsterisk && (
        <p className="t-caption" data-testid="matrix-footnote">
          * Averaged from the clients scored for that bucket. Not every client who could be scored
          has been.
        </p>
      )}
    </div>
  )
}
