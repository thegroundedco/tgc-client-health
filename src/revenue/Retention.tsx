import { useState } from 'react'
import { formatPeriod } from '../lib/month'
import { formatMoney } from './money'
import { latestPeriod, retention, retentionBasis } from './retentionMath'
import type { RetentionClient, RetentionReport, RetentionRow } from './retentionMath'
import { RetentionChart } from './RetentionChart'
import {
  EXCLUDED_END_REASONS,
  RETENTION_WINDOWS,
  baseForWindow,
  excludeUncontested,
  isShortWindow,
} from './retentionControls'
import type { UseRetention } from './useRetention'
import styles from './Revenue.module.css'

// How many movers are named before the rest collapse into one row. The shape
// Concentration already uses, for the same reason: a list of every client is
// a roster ranking, and this section is meant to answer "why did it move".
const NAMED_MOVERS = 4

// Whole percentages. The underlying ratio is exact; the display is rounded
// once, here, and never summed afterwards -- Concentration learned that lesson
// the hard way when independently rounded rows added up to 101.
function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

// The per-client movement, signed. formatMoney already carries a minus on a
// negative, so only a rise needs a mark -- and it needs one: without a sign a
// rise and a fall look alike until the reader compares the two figures beside
// it and subtracts. Spec section 5 point 4 puts the delta on the row, and the
// list's ordering depends on it being there: the rows are sorted by ABSOLUTE
// delta, which spec section 4 calls "the answer to why did it move", and eleven
// before/after pairs in an order with no visible basis read as arbitrary.
function formatDelta(cents: number): string {
  return cents > 0 ? `+${formatMoney(cents)}` : formatMoney(cents)
}

// What happened to the money we already had. NRR leads and GRR sits beside it,
// which is the owner's ruling verbatim: "Net is most important, but we still
// want visibility into gross."
// Takes the read rather than making it, as of slice 6d. Billing needs the same
// whole-table rows, and two components each calling useRetention would issue two
// identical reads -- and, worse, could resolve either side of a save and anchor
// to DIFFERENT latest months while both looked authoritative. Revenue.tsx owns
// the call and hands it down. Concentration keeps its own useRevenue read: that
// one reads a single month through a different filter and shares nothing here.
export function Retention({ read }: { read: UseRetention }) {

  return (
    <section className={styles.section}>
      <h3 className="t-subhead">Retention</h3>

      {read.status === 'loading' && <p className="t-body">Loading…</p>}

      {read.status === 'error' && (
        <p className="alert prose" role="alert">
          {read.loadError}
        </p>
      )}

      {read.status === 'ready' && <RetentionReady clients={read.clients} rows={read.rows} />}
    </section>
  )
}

function RetentionReady({
  clients,
  rows,
}: {
  clients: readonly RetentionClient[]
  rows: readonly RetentionRow[]
}) {
  // Slice 6f-2's three controls. All page state -- none of them refetches,
  // because useRetention already holds the whole table.
  const [months, setMonths] = useState(12)
  const [headline, setHeadline] = useState<'net' | 'gross'>('net')
  const [excluding, setExcluding] = useState(false)
  // The contributions list is the bulk of the section and the only part that
  // folds. The rate, the movement and the BASIS SENTENCE stay visible: slice
  // 6e §3.1 established the sentence is what makes the rate defensible and
  // has to travel with it, so hiding it here would contradict that.
  const [showMovers, setShowMovers] = useState(false)
  const [showAll, setShowAll] = useState(false)

  // Rendered above every branch below, including the refusals: a reader who
  // has picked a window that cannot produce a rate must be able to pick a
  // different one without reloading the page.
  const controls = (
    <div className={styles.controls}>
      <div aria-label="Retention window" className={styles.buttonRow} role="group">
        {RETENTION_WINDOWS.map((option) => (
          <button
            aria-pressed={months === option}
            className="button button--quiet"
            key={option}
            onClick={() => setMonths(option)}
            type="button"
          >
            {option} mo
          </button>
        ))}
      </div>

      <div aria-label="Headline rate" className={styles.buttonRow} role="group">
        {(['net', 'gross'] as const).map((option) => (
          <button
            aria-pressed={headline === option}
            className="button button--quiet"
            key={option}
            onClick={() => setHeadline(option)}
            type="button"
          >
            {option === 'net' ? 'Net' : 'Gross'}
          </button>
        ))}
      </div>

      <button
        aria-pressed={excluding}
        className="button button--quiet"
        onClick={() => setExcluding((on) => !on)}
        title={`Leaves out departures coded ${EXCLUDED_END_REASONS.join(' or ')}`}
        type="button"
      >
        Ignore ended by us
      </button>
    </div>
  )
  // Ordered deliberately: latestPeriod returns null for an empty table, and
  // retention() cannot be called with it. Computing the report first and
  // checking afterwards would be a type error at best and a crash at worst.
  const period = latestPeriod(rows)
  if (period === null) {
    return (
      <p className="t-body prose">
        No retention yet: no revenue has been entered, so there is no history to measure across.
      </p>
    )
  }

  // NO CLIENTS AT ALL, which is not the same fact as a base month nobody
  // entered and must not borrow the sentence below. Both leave baseCents at 0
  // and both rates null, so this branch has to come first -- Concentration.tsx
  // hit the identical trap and its comment says the sentence "must not be
  // borrowed".
  //
  // The distinction is an instruction, not a nicety: "September 2025 has no
  // entered revenue" tells a reader to go and enter September 2025, which is
  // right when clients are waiting and wrong when the roster is empty -- there
  // is nobody to enter it for, and the entry grid would be blank too. And an
  // empty roster is exactly what a broken eligibility filter produces
  // (useRetention losing its roster arm returns no clients whatsoever), so the
  // entry sentence would send somebody hunting for missing data entry instead
  // of for the bug.
  //
  // Keyed on the ROSTER, not on the arithmetic, for the same reason
  // Concentration keys its version on roster length: the claim the sentence
  // makes is about the roster, so it has to read the roster.
  const roster = excluding ? excludeUncontested(clients) : clients
  const excluded = clients.length - roster.length

  if (clients.length === 0) {
    return (
      <p className="t-body prose">
        No clients were on the books, so there is nothing to measure retention across.
      </p>
    )
  }

  const report = retention(roster, rows, period, baseForWindow(period, months))

  // Both rates are null together -- they share a denominator. Rendering a
  // percentage here would be inventing one, which is the whole thing spec
  // section 9 refuses.
  if (report.nrr === null || report.grr === null) {
    return (
      <>
        {controls}
        <p className="t-body prose">
          Not enough history for a retention rate yet: {formatPeriod(report.basePeriod)} has no
          entered revenue to measure {formatPeriod(report.currentPeriod)} against.
        </p>
      </>
    )
  }

  const headlineRate = headline === 'net' ? report.nrr : report.grr
  const secondaryRate = headline === 'net' ? report.grr : report.nrr
  const secondaryName = headline === 'net' ? 'gross' : 'net'

  return (
    <>
      {controls}

      <p className="t-caption" data-testid="retention-window">
        {formatPeriod(report.currentPeriod)} against {formatPeriod(report.basePeriod)}
      </p>

      <RetentionChart clients={roster} months={months} rows={rows} />

      {/* The chosen rate large, the other beside it small. Neither is ever
          hidden: the owner's boss wants net to lead AND gross to stay
          visible, and a control that lets the section be screenshotted with
          no net figure anywhere defeats that. */}
      <p
        className="t-score"
        data-testid={headline === 'net' ? 'retention-nrr' : 'retention-headline'}
        id="retention-headline"
      >
        <span data-testid="retention-headline-inner">
          {formatRate(headlineRate)} {headline}
        </span>
      </p>
      <p
        className={`t-body ${styles.measure}`}
        data-testid={headline === 'net' ? 'retention-grr' : 'retention-secondary'}
      >
        {formatRate(secondaryRate)} {secondaryName}
      </p>

      {isShortWindow(months) && (
        /* 6f-1 trap 1, answered with a caution rather than a refusal. Slice
           6e's month panel already prints a one-month rate on the owner's
           approval, so refusing the same figure here would be two rules for
           one number. The sentence names the reason instead of scolding. */
        <p className={`t-caption ${styles.caution}`} data-testid="retention-caution">
          A {months}-month window on {report.included} clients moves sharply on one client&rsquo;s
          invoice timing. Read it as a direction, not a figure to report.
        </p>
      )}

      {excluding && (
        /* 6f-1 trap 2. The number is a DIFFERENT number when departures are
           left out, and it has to say so on its face rather than presenting
           itself as plain retention. */
        <p className={`t-caption ${styles.caution}`} data-testid="retention-excluding">
          Excluding {excluded} {excluded === 1 ? 'departure' : 'departures'} we ended ourselves or
          that simply finished. Not a retention rate: it asks how we did among clients we could
          have kept.
        </p>
      )}

      {/* The three movements as a diverging bar AND in words. Gains one side
          of the baseline, losses the other, so the sign is carried by
          position and never by colour alone.

          Contraction and churn stay separate marks -- 6f-1 keeps them apart
          because "a client shrank" and "a client left" are different events
          that a single number would blend -- but they share a colour and are
          split by TEXTURE. That is not a shortcut: the validator refused
          every third hue against this page's existing two (see tokens.css),
          so four is the ceiling and texture is the sanctioned answer. */}
      <MovementBar report={report} />

      <p className={`t-caption ${styles.summary}`} data-testid="retention-movement">
        {formatMoney(report.expansionCents)} expansion ·{' '}
        {formatMoney(Math.abs(report.contractionCents))} contraction ·{' '}
        {formatMoney(Math.abs(report.churnedCents))} churn
      </p>

      {/* The disclosure travels WITH the number, not as a footnote, and does
          NOT fold with the list below it -- slice 6e §3.1, and spec 6f-2
          §6.1 records why "fold the detail away" stops here. An unentered
          client silently shrinking the denominator is exactly the kind of
          quiet wrongness this page exists to avoid. */}
      <p className={`t-caption ${styles.summary}`} data-testid="retention-basis">
        {retentionBasis(report, formatPeriod)}
      </p>

      {/* The bulk of the section, folded. Closed by default because the two
          rates and their basis are what the section is FOR; the per-client
          movement is what you open when you want to know why. */}
      <button
        aria-expanded={showMovers}
        className="button button--quiet"
        onClick={() => setShowMovers((open) => !open)}
        type="button"
      >
        {showMovers ? 'Hide' : 'Show'} what moved ({report.contributions.length})
      </button>

      {showMovers && (
        /* role="list" because base.css removes markers globally, and WebKit
           drops a list's semantics when its markers are removed -- so in
           Safari with VoiceOver this would announce as unrelated paragraphs.
           Tenure and the admin screens do the same. */
        <ul aria-label="Retention contributions" className={styles.list} role="list">
          {(showAll ? report.contributions : report.contributions.slice(0, NAMED_MOVERS)).map(
            (entry) => (
              <li className={styles.row} key={entry.clientId}>
                <span className={styles.who}>
                  <span className="t-body" data-testid="retention-contribution-name">
                    {entry.name}
                  </span>
                  {entry.kind === 'churned' && (
                    <span className={`t-caption ${styles.marker}`}>Left</span>
                  )}
                </span>
                <span className={`t-body ${styles.measure}`}>
                  {formatMoney(entry.baseCents)} → {formatMoney(entry.currentCents)} ·{' '}
                  {formatDelta(entry.deltaCents)}
                </span>
              </li>
            ),
          )}

          {/* Expands rather than truncates. Nothing is removed, only staged --
              which is what reconciles "collapse the list" with "don't take
              anything away", both of which the owner asked for. */}
          {!showAll && report.contributions.length > NAMED_MOVERS && (
            <li className={styles.row}>
              <button
                className="button button--quiet"
                onClick={() => setShowAll(true)}
                type="button"
              >
                {report.contributions.length - NAMED_MOVERS} others
              </button>
            </li>
          )}
        </ul>
      )}
    </>
  )
}

// The three movements, as a shape rather than as three more numbers. The
// owner's complaint about this section was "too many numbers at once", and
// the movement line was three of them.
//
// Diverging around a baseline: expansion to one side, contraction and churn
// to the other, each segment sized against the largest of the three so the
// bar is a comparison rather than a scale nobody stated. Position carries
// the sign, so the colours reinforce rather than encode it -- which is what
// lets the two loss segments share a colour and differ by texture.
//
// aria-hidden and a plain <p> of the same figures beside it: "expansion
// twelve, contraction twenty-five" read aloud is worse than the sentence
// already under it.
function MovementBar({ report }: { report: RetentionReport }) {
  const expansion = Math.abs(report.expansionCents)
  const contraction = Math.abs(report.contractionCents)
  const churn = Math.abs(report.churnedCents)
  const largest = Math.max(expansion, contraction, churn)

  // Nothing moved at all. A bar of three zero-width segments is an empty box
  // that reads as a rendering fault; the sentence below already says $0.
  if (largest === 0) return null

  function width(cents: number): string {
    return `${(cents / largest) * 100}%`
  }

  return (
    <p aria-hidden="true" className={styles.movement} data-testid="retention-movement-bar">
      <span className={styles.movementSide}>
        <span className={styles.movementGain} style={{ inlineSize: width(expansion) }} />
      </span>
      <span className={styles.movementSide}>
        <span className={styles.movementContraction} style={{ inlineSize: width(contraction) }} />
        <span className={styles.movementChurn} style={{ inlineSize: width(churn) }} />
      </span>
    </p>
  )
}
