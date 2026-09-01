import { BUCKETS, BUCKET_DEFINITIONS, GATED_BUCKET } from '../lib/buckets'
import { formatPeriod } from '../lib/month'
import { BAND_LABELS, bandFor } from '../lib/scoreMath'
import { isOpenable } from './boardScope'
import type { CardCheckin } from './cardSummary'
import {
  advocacyContext,
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
          {/* The six bucket columns must be equal to each other -- owner's call,
              2026-09-01: unequal ones are hard to scan across. Under
              `table-layout: fixed` a column with no width of its own takes an
              equal share of what is left, so naming only Client and Overall is
              what makes the six in between identical. Naming all eight would
              work too and would be eight numbers to keep in agreement. */}
          <colgroup>
            <col className={styles.colClient} />
            {columns.map(({ bucket }) => (
              <col key={bucket} />
            ))}
            <col className={styles.colContext} />
            <col className={styles.colOverall} />
          </colgroup>
          {/* Names what the table is and which month it covers, so it is
              self-describing when read out of the page's context. */}
          <caption className={`t-caption ${styles.caption}`}>
            Client health by bucket, {formatPeriod(period)}
          </caption>
          {/* Two header rows, because Advocacy is the only bucket with
              sub-columns -- its score and the things that score is made of.
              Every other column spans both rows with rowSpan, which is what
              keeps the header one block rather than a row of labels above a row
              of blanks.

              scope="colgroup" on Advocacy and scope="col" on its two children is
              what tells a screen reader that Score and Context sit UNDER
              Advocacy rather than beside it. */}
          <thead>
            <tr>
              <th className={`t-label ${styles.headName}`} rowSpan={2} scope="col">
                Client
              </th>
              {columns.map(({ bucket, definition }) =>
                bucket === GATED_BUCKET ? (
                  <th
                    className={`t-label ${styles.head} ${styles.headGroup}`}
                    colSpan={2}
                    key={bucket}
                    scope="colgroup"
                  >
                    {definition.label}
                  </th>
                ) : (
                  // The full bucket name, not the initial. The card's bars use
                  // the initial because six letters have to fit under six bars
                  // in a 15rem card; a table has a whole column and a scroller,
                  // so the word costs width the grid can afford and saves the
                  // reader knowing the rubric by heart. Owner's call,
                  // 2026-09-01.
                  <th className={`t-label ${styles.head}`} key={bucket} rowSpan={2} scope="col">
                    {definition.label}
                  </th>
                ),
              )}
              <th className={`t-label ${styles.head}`} rowSpan={2} scope="col">
                Overall
              </th>
            </tr>
            <tr>
              <th className={`t-label ${styles.head}`} scope="col">
                Score
              </th>
              <th className={`t-label ${styles.head} ${styles.divider}`} scope="col">
                Context
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const band = bandFor(row.overall)
              // The rule between the clients and the agency's own row. It is the
              // LAST CLIENT ROW's bottom edge rather than the footer's top edge,
              // because that edge has one owner and this is it. See "ONE EDGE,
              // ONE OWNER" in the stylesheet.
              const floor = rowIndex === rows.length - 1 ? styles.footRule : ''
              const context = advocacyContext(row)
              return (
                <tr data-testid="matrix-row" key={row.client.id}>
                  <th className={`${styles.name} ${floor}`} data-band={band} scope="row">
                    {/* The flex lives on this span, NOT on the <th>. A table
                        cell given `display: flex` leaves the table formatting
                        context, stops collapsing its borders with its
                        neighbours', and draws every line touching the client
                        column at 2px while the rest of the grid is 1px. See
                        .name in the stylesheet. */}
                    <span className={styles.nameRow}>
                      {/* isOpenable is applied rather than assumed. The matrix
                          only ever shows active clients, so it never refuses
                          here -- but the reason the rule exists is that
                          checkins_insert_edit_scores carries no status predicate
                          of its own, and a view that assumes instead of asking
                          is how that gap gets reopened. */}
                      {isOpenable(row.client.status) ? (
                        <button
                          className={styles.open}
                          onClick={() => onOpen(row.client)}
                          type="button"
                        >
                          <span data-testid="matrix-name">{row.client.name}</span>
                        </button>
                      ) : (
                        <span data-testid="matrix-name">{row.client.name}</span>
                      )}
                      {/* The band reads beside the name rather than in a column
                          of its own -- owner's call, 2026-09-01. It stays
                          OUTSIDE the button so the control's accessible name is
                          the client, not "Babaloo Watch", and so the band is not
                          something you appear to be able to click.

                          No " - " between them any more: the separator existed
                          to join two words on one line, and .nameRow's
                          space-between does that job now. A dash floating in the
                          gap between a left-aligned name and a right-aligned
                          band belongs to neither. */}
                      <span className={styles.bandWord} data-testid="matrix-band">
                        {BAND_LABELS[band]}
                      </span>
                    </span>
                  </th>
                  {columns.map(({ bucket }) => {
                    const value = cellValue(row, bucket)
                    return (
                      <td
                        className={`${styles.cell} ${floor} numeric`}
                        data-band={bandFor(value)}
                        data-testid="matrix-cell"
                        key={bucket}
                      >
                        <Score value={value} />
                      </td>
                    )
                  })}
                  {/* Advocacy's second cell. Deliberately NOT banded: it is not
                      a score, and colouring it would imply "Review and Case
                      study" sits somewhere on a 1-5 scale. The band beside it
                      already says how the bucket is doing. */}
                  <td
                    className={`${styles.cell} ${styles.context} ${styles.divider} ${floor}`}
                    data-testid="matrix-context"
                  >
                    {context === null ? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className={styles.hidden}>Not scored</span>
                      </>
                    ) : (
                      context
                    )}
                  </td>
                  <td
                    className={`${styles.cell} ${floor} numeric`}
                    data-band={band}
                    data-testid="matrix-overall"
                  >
                    <Score value={row.overall} />
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
              {/* Nothing under Context: there is no average of a sentence.
                  The Advocacy SCORE above still averages, which is the whole
                  reason the column was split rather than replaced. */}
              <td className={`${styles.blank} ${styles.divider}`} />
              <td className={styles.blank} />
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
