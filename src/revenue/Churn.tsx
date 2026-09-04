import { reasonLabel } from '../clients/clientForm'
import { formatDay, formatTenure } from './tenureMath'
import type { DepartedRow } from './tenureMath'
import styles from './Revenue.module.css'

// Who left, when, why, and how long they had been with you.
//
// A LEDGER, not an analysis, and spec §6 is the reason. A churn rate computed
// on one departure is 9.1% -- a number that reads as a fact, carries a decimal
// place, and means nothing -- and a tenure-at-churn breakdown cannot sort a
// departure that has no start date. Both would be machinery that looks like
// analysis while having nothing to analyse.
//
// THE CAPTION IS COMPUTED FROM THE ROWS, and the reason is that the previous
// one was written as prose and went false on the deployed site. It said "a rate
// needs more than one departure" and "the breakdown needs the clients who left
// to have a recorded start date" at a point when production held TWO
// departures, one of them WITH a start date -- so both stated reasons were
// wrong, in the one place on this page whose argument is that a number you
// cannot stand behind should not be shown. Its own comment predicted this
// ("stops being true on its own the day the data supports the real thing") and
// nothing made it stop, because nothing could: no test can fail on prose.
//
// STILL THE OWNER'S CALL, and deliberately not decided here: the number of
// departures at which a churn rate becomes defensible. §6 ruled it out at n=1
// and the owner reaffirmed the rate stays withheld at n=2. The caption below
// therefore states the count and calls it too few, which stays FACTUALLY true
// as the count grows even if it becomes editorially stale -- a strictly better
// failure than the one it replaces. Do not invent a threshold constant here.
export function Churn({ rows }: { rows: readonly DepartedRow[] }) {
  const departures = rows.length

  // started_on, NOT `days`. `days` is null for a missing start date AND for a
  // missing end date -- the list beside this renders 'unknown' for the second
  // case -- so a count taken from `days` would report a client who has a
  // perfectly good start date as lacking one.
  const noStartDate = rows.filter((row) => row.client.started_on === null).length

  const rateClause =
    departures === 1
      ? '1 departure is too few for a rate to mean anything.'
      : `${departures} departures are too few for a rate to mean anything.`

  // When the missing-start-date reason evaporates, the clause has to go with
  // it. It says a breakdown is POSSIBLE rather than claiming it exists: whether
  // to build one is the owner's decision, and this is where they will see that
  // the data now permits it.
  const breakdownClause =
    noStartDate === 0
      ? 'Every client who left has a recorded start date, so a tenure-at-churn breakdown is now possible.'
      : `${noStartDate} of them ${noStartDate === 1 ? 'has' : 'have'} no recorded start date, so a tenure-at-churn breakdown would leave ${noStartDate === 1 ? 'that one' : 'those'} out.`

  return (
    <section className={styles.section}>
      <h3 className="t-subhead">Who has left</h3>

      {rows.length === 0 ? (
        // An explicit empty state rather than a blank region, which reads as a
        // failed load.
        <p className="t-body prose">
          No churn yet: nobody has left. When a client is marked cancelled or former on the Admin
          screen, they appear here with the reason recorded at the time.
        </p>
      ) : (
        <>
          <ul aria-label="Departures" className={styles.list} role="list">
            {rows.map((row) => (
              <li className={styles.row} key={row.client.id}>
                <span className={styles.who}>
                  <span className="t-body">{row.client.name}</span>
                  <span className={`t-caption ${styles.marker}`}>
                    {reasonLabel(row.client.end_reason_code)}
                  </span>
                </span>
                <span className={`t-body ${styles.measure}`}>
                  {row.client.ended_on === null ? 'unknown' : formatDay(row.client.ended_on)}{' '}
                  · {formatTenure(row.days)}
                </span>
                {/* Both halves of the reason, because the parent spec says a
                    coded reason alone loses the story and free text alone
                    cannot be counted. */}
                {row.client.end_reason_note !== null && (
                  <p className={`t-caption ${styles.detail}`} data-testid="churn-note">
                    {row.client.end_reason_note}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <p className="t-caption prose">
            No churn rate: {rateClause} {breakdownClause}
          </p>
        </>
      )}
    </section>
  )
}
