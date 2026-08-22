import { BAND_LABELS, MAX_PILLAR_SCORE, MAX_TOTAL, PILLARS, bandFor } from '../lib/score'
import { PILLAR_DEFINITIONS } from '../lib/pillars'
import { bandClassName } from '../styles/bandClass'
import { cardFooter } from './cardSummary'
import type { CardCheckin } from './cardSummary'
import type { BoardClient } from './useBoard'
import styles from './ClientCard.module.css'

type Props = {
  client: BoardClient
  checkin: CardCheckin | null
  viewerId: string
  onOpen: () => void
}

export function ClientCard({ client, checkin, viewerId, onOpen }: Props) {
  // The total comes from the row, never from recomputing the pillars here:
  // total_score is a generated column, and `npm run verify:score` is what
  // proves it agrees with totalScore() over all 7,776 combinations. Adding a
  // second local calculation would be a second thing to keep in agreement.
  const total = checkin?.total_score ?? null
  const band = bandFor(total)

  return (
    <li className={styles.card}>
      {/* This head block is moved unchanged from Board.tsx -- the h3 around the
          button, and the band beside it. A browser has confirmed the click
          target, the hover and the focus ring on exactly this markup, so it is
          not re-derived here. */}
      <div className={styles.cardHead}>
        <h3 className="t-body">
          <button className={styles.cardOpen} type="button" onClick={onOpen}>
            {client.name}
          </button>
        </h3>
        {/* The band always carries its text label. Colour is never the only
            signal: teal against warm red measures 1.76:1, so any two bands are
            indistinguishable to a colour-blind viewer. Parent spec §9.3. */}
        <span className={bandClassName(band)}>{BAND_LABELS[band]}</span>
      </div>

      <p className={styles.score}>
        {/* An em dash, never a 0. An incomplete check-in has no score, and a
            false "at risk" is as harmful as a false "healthy". */}
        <span className="t-score numeric" data-testid="total">
          {total === null ? '—' : total}
        </span>
        <span className="t-caption numeric">/ {MAX_TOTAL}</span>
      </p>

      {/* One bar per pillar, always five, always in rubric order -- the reader
          compares the same position across eleven cards, so the order cannot
          come from the row's own key order.

          Not a list: these are five small graphics, not five pieces of content,
          so each carries role="img" and its label. The bar's height cannot be
          read aloud, which makes the label the content and the bar the
          decoration. An unscored pillar is a track with no fill; since scores
          run 1 to 5, a zero-height fill unambiguously means unscored. */}
      <div className={styles.bars}>
        {PILLARS.map((pillar) => {
          const value = checkin?.[pillar] ?? null
          return (
            <span
              aria-label={
                value === null
                  ? `${PILLAR_DEFINITIONS[pillar].label}: not scored`
                  : `${PILLAR_DEFINITIONS[pillar].label}: ${value} of ${MAX_PILLAR_SCORE}`
              }
              className={styles.bar}
              data-testid="pillar-bar"
              key={pillar}
              role="img"
            >
              <span
                className={styles.fill}
                style={{ blockSize: `${((value ?? 0) / MAX_PILLAR_SCORE) * 100}%` }}
              />
            </span>
          )
        })}
      </div>

      {/* This line is the save confirmation. §6: better than a toast because it
          survives a reload, which is the check v1 failed. cardFooter guarantees
          it is never empty. */}
      <p className={`t-caption ${styles.footerLine}`}>{cardFooter(checkin ?? null, viewerId)}</p>
    </li>
  )
}
