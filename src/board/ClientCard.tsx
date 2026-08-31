import { BAND_LABELS, MAX_SCORE, bandFor } from '../lib/scoreMath'
import { BUCKETS, BUCKET_DEFINITIONS, GATED_BUCKET } from '../lib/buckets'
import { bandClassName } from '../styles/bandClass'
import { BUCKET_SCORE_KEY, cardFooter } from './cardSummary'
import type { CardCheckin } from './cardSummary'
import type { BoardClient, BoardScore } from './useBoard'
import styles from './ClientCard.module.css'
import { isChurned, statusLabel } from '../clients/clientForm'
import { isOpenable, notOpenableReason } from './boardScope'

type Props = {
  client: BoardClient
  checkin: CardCheckin | null
  score: BoardScore | null
  viewerId: string
  onOpen: () => void
}

export function ClientCard({ client, checkin, score, viewerId, onOpen }: Props) {
  // From the view, never recomputed here. The overall cannot be a generated
  // column (spec §6), so the view is the one place it exists -- and `npm run
  // verify:scoring-view` is what proves that expression is right. A second
  // local calculation would be a second thing to keep in agreement.
  const total = score?.overall_score ?? null
  const band = bandFor(total)
  const openable = isOpenable(client.status)

  // The gate decides how many bars there are, not whether one of them is empty.
  // An empty sixth bar reads as a score of zero, and Advocacy inside 90 days is
  // not a zero -- it is a question nobody was asked. Spec §8.
  const advocacyApplies = score?.advocacy_applies ?? false
  const drawnBuckets = advocacyApplies
    ? BUCKETS
    : BUCKETS.filter((bucket) => bucket !== GATED_BUCKET)

  return (
    <li className={styles.card}>
      {/* This head block is moved unchanged from Board.tsx -- the h3 around the
          button, and the band beside it. A browser has confirmed the click
          target, the hover and the focus ring on exactly this markup, so it is
          not re-derived here. */}
      <div className={styles.cardHead}>
        <h3 className="t-body">
          {openable ? (
            <button className={styles.cardOpen} type="button" onClick={onOpen}>
              {client.name}
            </button>
          ) : (
            // Text, not a disabled button. A disabled control invites the
            // reader to work out why it is disabled; the sentence below says
            // so outright. It stays inside the h3 so the card is still a
            // findable, labelled heading.
            <span className={styles.cardName}>{client.name}</span>
          )}
        </h3>
        {/* The band always carries its text label. Colour is never the only
            signal: teal against warm red measures 1.76:1, so any two bands are
            indistinguishable to a colour-blind viewer. Parent spec §9.3. */}
        <span className={bandClassName(band)}>{BAND_LABELS[band]}</span>
        {/* Only when it is not active. Eleven identical pills reading ACTIVE
            would be noise on the screen whose whole job is the active roster,
            so the default case is the unmarked one. */}
        {!openable && (
          <span
            className={`status-pill ${isChurned(client.status) ? 'status-pill--ended' : ''}`}
            data-testid="card-status"
          >
            {statusLabel(client.status)}
          </span>
        )}
      </div>

      <p className={styles.score}>
        {/* An em dash, never a 0. An incomplete check-in has no score, and a
            false "at risk" is as harmful as a false "healthy". Two decimals,
            matching what the view stores -- 3.5 and 3.50 are the same number
            but only one of them lines up in a column of eleven cards. */}
        <span className="t-score numeric" data-testid="total">
          {total === null ? '—' : total.toFixed(2)}
        </span>
        <span className="t-caption numeric">/ {MAX_SCORE}</span>
      </p>

      {/* One bar per bucket, in rubric order -- the reader compares the same
          position across eleven cards, so the order cannot come from the row's
          own key order. Six bars when Advocacy applies, five when the gate is
          shut: never six with an empty one, which would read as a score of
          zero rather than a question nobody was asked.

          Not a list: these are small graphics, not pieces of content, so each
          carries role="img" and its label. The bar's height cannot be read
          aloud, which makes the label the content and the bar the decoration.
          An unscored bucket is a track with no fill; a bucket score runs 1 to
          5, so a zero-height fill unambiguously means unscored.

          The initial under each bar exists because the first version had only
          the aria-label: a screen reader knew which bar was which and a sighted
          reader got anonymous columns. It is aria-hidden, so the label stays
          the single spoken description rather than gaining a stray letter
          after it. */}
      <div className={styles.bars}>
        {drawnBuckets.map((bucket) => {
          const definition = BUCKET_DEFINITIONS[bucket]
          // CardCheckin's index signature is `number | boolean | string | null
          // | undefined` because it also covers the four boolean Advocacy
          // answers -- but BUCKET_SCORE_KEY only ever names one of the six
          // generated score columns, and every one of those is numeric. The
          // cast says exactly that; the index signature itself cannot.
          const value = (checkin?.[BUCKET_SCORE_KEY[bucket]] ?? null) as number | null
          return (
            <span
              aria-label={
                value === null
                  ? `${definition.label}: not scored`
                  : `${definition.label}: ${value} of ${MAX_SCORE}`
              }
              className={styles.bucket}
              data-testid="bucket-bar"
              key={bucket}
              role="img"
            >
              <span className={styles.track}>
                {/* A bucket score runs 1.00 to 5.00, so a zero-height fill
                    unambiguously means unscored -- there is no real score that
                    draws nothing. */}
                <span
                  className={styles.fill}
                  style={{ blockSize: `${((value ?? 0) / MAX_SCORE) * 100}%` }}
                />
              </span>
              <span aria-hidden="true" className={styles.initial} data-testid="bucket-initial">
                {definition.initial}
              </span>
            </span>
          )
        })}
      </div>

      {/* Said outright rather than implied by a missing bar. Without it the
          card is five bars where its neighbour has six and nothing explains
          the difference. */}
      {!advocacyApplies && (
        <p className="t-caption" data-testid="card-gated">
          Advocacy begins at 90 days.
        </p>
      )}

      {/* This line is the save confirmation. §6: better than a toast because it
          survives a reload, which is the check v1 failed. cardFooter guarantees
          it is never empty. */}
      <p className={`t-caption ${styles.footerLine}`}>
        {cardFooter(checkin ?? null, viewerId, advocacyApplies)}
      </p>

      {/* Why the name is not a link. Without this the card is a dead end that
          looks like a bug -- and the reason is worth stating rather than
          implying, because the database would in fact accept a check-in for
          this client: checkins_insert_edit_scores has no status predicate. */}
      {!openable && (
        <p className="t-caption" data-testid="card-locked">
          {notOpenableReason(client.status)}
        </p>
      )}
    </li>
  )
}
