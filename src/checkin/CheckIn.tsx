import { PILLARS, BAND_LABELS, MAX_TOTAL, bandFor } from '../lib/score'
import { formatPeriod, formatSavedAt } from '../lib/month'
import { bandClassName } from '../styles/bandClass'
import type { Profile } from '../auth/useProfile'
import { useCheckin } from './useCheckin'
import { PillarRow } from './PillarRow'
import { displayedTotal, submitBlock, submitLabel } from './saveState'
import styles from './CheckIn.module.css'

type Props = {
  client: { id: number; name: string }
  period: string
  profile: Profile
  onBack: () => void
}

export function CheckIn({ client, period, profile, onBack }: Props) {
  const checkin = useCheckin(client.id, period, profile)
  const {
    status,
    loadError,
    stored,
    lastMonth,
    lastPeriod,
    draft,
    saveState,
    scored,
    localTotal,
    hasContent,
    storedSubmitted,
    storedByYou,
    draftPersisted,
    unsavedFromEarlierVisit,
  } = checkin

  const readFailed = status === 'error'
  const label = submitLabel(scored)
  const block = submitBlock({
    state: saveState,
    readFailed,
    hasContent,
    storedSubmitted,
  })
  const total = displayedTotal({
    state: saveState,
    localTotal,
    storedTotal: stored?.total_score ?? null,
  })
  const saving = saveState.kind === 'saving'

  const back = (
    <nav className={styles.nav}>
      <button className="button button--quiet" type="button" onClick={onBack}>
        Board
      </button>
    </nav>
  )

  const masthead = (
    <div className="masthead">
      <p className="t-eyebrow">{client.name}</p>
      <h2 className="t-header">{formatPeriod(period)}</h2>
    </div>
  )

  // A failed read gets the whole screen. Rendering the form underneath an error
  // would put an empty set of controls in front of somebody whose real scores
  // are simply unread -- and the one thing they might then do is press save.
  if (readFailed) {
    return (
      <section className={styles.screen}>
        {back}
        {masthead}
        <h3 className="t-header">Cannot reach the database</h3>
        <p className="alert prose" role="alert">
          {loadError}
        </p>
        <p className="t-body prose">
          Nothing has been changed. This client&rsquo;s scores are still there; they just
          could not be read.
        </p>
        <button className="button" type="button" onClick={checkin.reload}>
          Try again
        </button>
      </section>
    )
  }

  if (status === 'loading') {
    return (
      <section className={styles.screen}>
        {back}
        {masthead}
        <p className="t-body">Loading…</p>
      </section>
    )
  }

  return (
    <section className={styles.screen}>
      {back}
      {masthead}

      <div className={styles.totals}>
        <div className={styles.total}>
          <p className="t-label">This month</p>
          <p className={styles.totalLine}>
            {/* An incomplete check-in shows an em dash, never a number. Parent
                spec §6.2: incomplete must not read as "at risk". The words
                beside it are what a screen reader gets, since an em dash on its
                own announces as nothing. */}
            <span className={`t-display ${styles.totalValue} numeric`}>
              {total === null ? '—' : total}
            </span>
            <span className="t-caption">
              {total === null ? `not scored · ${scored} of ${PILLARS.length} pillars` : `of ${MAX_TOTAL}`}
            </span>
          </p>
          <span className={bandClassName(bandFor(total))}>{BAND_LABELS[bandFor(total)]}</span>
        </div>

        {/* §5.2: last month alongside, because a score compared is a judgment
            and a score alone is a guess. */}
        <div className={styles.total}>
          <p className="t-label">{formatPeriod(lastPeriod)}</p>
          <p className={styles.totalLine}>
            <span className={`t-display ${styles.totalValue} numeric`}>
              {lastMonth?.total_score == null ? '—' : lastMonth.total_score}
            </span>
            <span className="t-caption">
              {lastMonth?.total_score == null ? 'not scored' : `of ${MAX_TOTAL}`}
            </span>
          </p>
          <span className={bandClassName(bandFor(lastMonth?.total_score ?? null))}>
            {BAND_LABELS[bandFor(lastMonth?.total_score ?? null)]}
          </span>
        </div>
      </div>

      {unsavedFromEarlierVisit && (
        <p className="alert prose" role="status">
          These scores are from an earlier visit on this device and have not been saved.
          Press {label} to keep them.
        </p>
      )}

      {!draftPersisted && (
        <p className="t-caption prose">
          This browser is not keeping a local copy, so anything you enter here is only
          safe once you press {label}.
        </p>
      )}

      <div className={styles.pillars}>
        {PILLARS.map((pillar) => (
          <PillarRow
            key={pillar}
            pillar={pillar}
            value={draft.pillars[pillar]}
            lastValue={lastMonth?.[pillar] ?? null}
            disabled={saving}
            onChange={(value) => checkin.setPillar(pillar, value)}
            onClear={() => checkin.setPillar(pillar, null)}
          />
        ))}
      </div>

      <div className={styles.notesBlock}>
        <label className="t-label" htmlFor="checkin-notes">
          Notes
        </label>
        <textarea
          className={`field ${styles.notes}`}
          id="checkin-notes"
          rows={4}
          value={draft.notes}
          disabled={saving}
          onChange={(event) => checkin.setNotes(event.target.value)}
        />
      </div>

      <div className={styles.saveBar}>
        <button
          className="button"
          type="button"
          disabled={block.blocked}
          aria-describedby="checkin-save-status"
          onClick={checkin.submit}
        >
          {label}
        </button>

        {/* role="status" so the confirmation is announced rather than only
            drawn. This line is the whole point of the slice: the board gave no
            feedback that a save succeeded, so a save that worked looked exactly
            like one that failed. */}
        <p className={styles.saveStatus} id="checkin-save-status" role="status">
          {saveState.kind === 'saved' && (
            <span className="t-body">
              {saveState.complete ? 'Check-in submitted' : 'Draft saved'}{' '}
              {formatSavedAt(saveState.at)} by {saveState.by}.
              {!saveState.complete && ` ${scored} of ${PILLARS.length} pillars scored.`}
            </span>
          )}

          {saveState.kind === 'failed' && (
            <span className="alert">
              Could not save: {saveState.error}. Nothing was lost — everything you entered
              is still on screen, and pressing {label} again costs nothing.
            </span>
          )}

          {saveState.kind === 'saving' && <span className="t-caption">Saving…</span>}

          {saveState.kind === 'dirty' && (
            <span className="t-caption">Unsaved changes.</span>
          )}

          {/* A disabled control that does not say why is the same failure as a
              silent save, in a smaller box. When the state is `clean` and
              `storedSubmitted` is true, submitBlock always blocks (see
              submitBlock in saveState.ts): there is no `clean` + `storedSubmitted`
              case where the button is left enabled, so this is the only branch
              that combination can reach. The "already submitted" fact itself is
              also carried by the standalone line below the save bar, which names
              the date and who submitted it. */}
          {saveState.kind === 'clean' && block.blocked && (
            <span className="t-caption">{block.reason}</span>
          )}
        </p>
      </div>

      {/* Outside the status region: it describes what is stored, not what just
          happened, and re-announcing it on every keystroke would be noise. */}
      {storedSubmitted && stored?.submitted_at && (
        <p className="t-caption">
          Last submitted {formatSavedAt(stored.submitted_at)} by{' '}
          {storedByYou ? 'you' : 'another account manager'}.
        </p>
      )}
    </section>
  )
}
