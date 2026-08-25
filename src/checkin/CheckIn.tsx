import { PILLARS, BAND_LABELS, MAX_TOTAL, bandFor } from '../lib/score'
import { formatPeriod, formatSavedAt } from '../lib/month'
import { bandClassName } from '../styles/bandClass'
import type { Profile } from '../auth/useProfile'
import { can } from '../lib/capabilities'
import { useCheckin } from './useCheckin'
import { PillarRow } from './PillarRow'
import { displayedTotal, saveStatus, submitBlock, submitLabel } from './saveState'
import type { SaveStatusTone } from './saveState'
import styles from './CheckIn.module.css'

type Props = {
  client: { id: number; name: string }
  period: string
  profile: Profile
  onBack: () => void
}

// The class each saveStatus tone renders as. Kept beside the component that
// consumes it, not in saveState.ts: saveState.ts is domain logic (what the
// screen should say), and which CSS role that becomes is presentation, the
// same division bandClass.ts documents for Band vs BAND_CLASSES.
const TONE_CLASS: Record<SaveStatusTone, string> = {
  confirm: 't-body',
  error: 'alert',
  quiet: 't-caption',
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

  // The third caller of can() in the application, after the two in
  // src/board/Board.tsx. Convenience, not security, same as those two: a
  // viewer who somehow forced a write through anyway would still have it
  // refused by checkins_insert_edit_scores and checkins_update_edit_scores,
  // which is exactly what happened before this fix existed -- a viewer
  // pressed submit and only then met the database's refusal. What is new
  // here is not the check itself but what it is used for: Board.tsx's two
  // calls only decide whether to draw a link to another screen. This one
  // decides whether to draw working controls on THIS screen, which is the
  // finding this fix exists for -- a control that is drawn and then fails
  // when pressed is worse than one never drawn. A viewer still holds
  // view_scores and is meant to see the scores; canEdit below only gates
  // whether the controls that change them are offered.
  const canEdit = can(profile.role, 'edit_scores')

  const block = submitBlock({
    state: saveState,
    readFailed,
    canEdit,
    hasContent,
    storedSubmitted,
  })
  const total = displayedTotal({
    state: saveState,
    localTotal,
    storedTotal: stored?.total_score ?? null,
  })
  const statusLines = saveStatus({
    state: saveState,
    block,
    scored,
    storedUpdatedAt: stored?.updated_at ?? null,
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

      {/* Fix round 1: mounted unconditionally, once the screen is ready,
          with the condition moved onto the contents -- matching the shape of
          the save-status region below, rather than appearing and
          disappearing with `unsavedFromEarlierVisit` itself. As this screen
          is wired today that value is fixed in the same commit that first
          renders this branch (see useCheckin.ts's load()), so it can only go
          true to false after mount, never false to true; there is no
          post-mount announcement this specific change makes happen. Empty
          most of the time (no earlier-visit draft), so :empty collapses it
          out of the flex flow in CheckIn.module.css rather than through
          .screen's gap, which would otherwise add a blank var(--space-5) gap
          in the common case. */}
      <p className={`alert prose ${styles.earlierVisit}`} role="status">
        {unsavedFromEarlierVisit && (
          <>
            These scores are from an earlier visit on this device and have not
            been saved. Press {label} to keep them.
          </>
        )}
      </p>

      {!draftPersisted && (
        <p className="t-caption prose">
          This browser is not keeping a local copy, so anything you enter here is only
          safe once you press {label}.
        </p>
      )}

      {/* States the reason the controls below are disabled, near those
          controls -- not only on the submit button, whose own disabled
          state and status-region reason (from submitBlock, via block below)
          a person would only meet after already trying to change a score.
          A control that is dead for an unstated reason is this project's
          recurring defect (see saveState.ts's own comment on this same
          check), and that applies to a whole disabled section as much as to
          one button. Written for whoever is reading it, not for a
          developer: no mention of roles, presets, or how the check works --
          just what they can do here and who to ask if it should be
          different. */}
      {!canEdit && (
        <p className="t-body prose" id="checkin-readonly-notice">
          You can view this client&rsquo;s scores, but you can&rsquo;t score them. An
          admin can change that if this should be different.
        </p>
      )}

      <div className={styles.pillars}>
        {PILLARS.map((pillar) => (
          <PillarRow
            key={pillar}
            pillar={pillar}
            value={draft.pillars[pillar]}
            lastValue={lastMonth?.[pillar] ?? null}
            disabled={saving || !canEdit}
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
          disabled={saving || !canEdit}
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
            like one that failed.

            Fix round 1: the per-kind JSX chain this used to be had a real
            gap in `clean` + not blocked (no branch at all -- a routine saved
            draft, reopened, said nothing) and an incomplete branch in `dirty`
            + blocked (it rendered "Unsaved changes." but never the reason).
            saveStatus() in saveState.ts is the same decision made exhaustive
            (a `never` check catches an unhandled kind at compile time) and
            tested both as a value (saveState.test.ts sweeps every kind
            against every shape `block` can take) and as rendered markup
            (CheckIn.test.tsx renders this component with useCheckin mocked
            and asserts the #checkin-save-status text), so this is now a map
            over its result rather than a chain of conditions nothing
            checked for completeness. */}
        <p className={styles.saveStatus} id="checkin-save-status" role="status">
          {statusLines.map((line, index) => (
            <span key={line.tone + index} className={TONE_CLASS[line.tone]}>
              {index > 0 ? ' ' : ''}
              {line.text}
            </span>
          ))}
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
