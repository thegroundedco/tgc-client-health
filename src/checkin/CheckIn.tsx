import { Fragment, useEffect, useRef, useState } from 'react'
import { BUCKETS, BUCKET_DEFINITIONS, GATED_BUCKET, HOURS_QUESTION, PAYMENTS_BUCKET, questionsFor } from '../lib/buckets'
import { BAND_LABELS, MAX_SCORE, bandFor, bucketScore } from '../lib/scoreV2'
import { advocacyGate } from '../lib/gate'
import { formatPeriod, formatSavedAt, monthName } from '../lib/month'
import { describeChange, scoreChange } from '../lib/scoreChange'
import { BUCKET_SCORE_KEY } from '../board/cardSummary'
import { ChangeText } from '../board/ChangeMark'
import { bandClassName } from '../styles/bandClass'
import type { Profile } from '../auth/useProfile'
import { can } from '../lib/capabilities'
import { useCheckin } from './useCheckin'
import { useFinanceSuggestion } from './useFinanceSuggestion'
import { useMonthPayment } from '../revenue/useMonthPayment'
import { PaymentsBox } from './PaymentsBox'
import { useMonthHours } from './useMonthHours'
import { HoursBox } from './HoursBox'
import { BucketNotesPanel } from './BucketNotesPanel'
import { FocusBox } from './FocusBox'
import type { CheckinRow } from './useCheckin'
import { QuestionRow } from './QuestionRow'
import { ChoiceRow } from './ChoiceRow'
import { EndClientPanel } from './EndClientPanel'
import { SuggestionBanner } from './SuggestionBanner'
import { RevertButton } from './RevertButton'
import { RunClientButton } from '../ai/RunClientButton'
import { parseAiSuggestion } from './aiSuggestion'
import { clearDraft } from './draftCache'
import type { Answers } from '../lib/scoreV2'
import { displayedOverall, saveStatus, submitBlock, submitLabel } from './saveState'
import type { SaveStatusTone } from './saveState'
import styles from './CheckIn.module.css'

type Props = {
  client: { id: number; name: string; status: string; started_on: string | null }
  period: string
  profile: Profile
  onBack: () => void
  // REQUIRED, not optional. Board is this screen's only caller and always
  // passes it, so optionality bought nothing and cost the compile error: a
  // future caller who forgot it would get a check-in screen with the Edit
  // client button silently missing for every admin, and nothing would say so.
  // Whether the button is DRAWN is still a capability question, below, and
  // that is the only question it should be.
  onEditClient: () => void
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

// Two decimals, always. numeric(3,2) is what the view stores and what
// scoreMath.meanTo2dp produces, so 3.6 and 3.60 are the same number -- but a
// column of scores where some show one decimal and some show two reads as
// noise, and the trailing zero is the difference between "3.6 out of 5" and a
// number somebody has to look twice at.
function formatOverall(overall: number): string {
  return overall.toFixed(2)
}

// §7's legend, once per bucket that uses the 1-5 scale rather than once for the
// screen. It was a single sticky line at the top until 2026-09-01; the owner had
// it pinned and still could not see it -- a caption-weight strip against the
// page background reads as chrome, and chrome is what the eye skips. Repeating
// it inside each section puts it where the eye already is: heading, then what
// the numbers mean, then the first prompt.
//
// A definition list because that is what it is: two scores and what each one
// means, with 2, 3 and 4 reading as between them.
function ScaleLegend() {
  return (
    <dl className={styles.legend} data-testid="scale-legend">
      <div className={styles.legendPair}>
        <dt className={`t-label ${styles.legendTerm} numeric`}>1</dt>
        <dd className="t-caption">strongly disagree</dd>
      </div>
      <div className={styles.legendPair}>
        <dt className={`t-label ${styles.legendTerm} numeric`}>5</dt>
        <dd className="t-caption">strongly agree</dd>
      </div>
    </dl>
  )
}

export function CheckIn({ client, period, profile, onBack, onEditClient }: Props) {
  // Spec 2026-11-04 §7: the month's Productive hours. Read first, and needing
  // nothing from useCheckin, so whether the hours question applies can be
  // handed to it. Gated at the read like the payment: without view_revenue no
  // fetch is made, the result is null, and useCheckin falls back to the stored
  // fin_hours_applies. Try again bumps the version.
  const [hoursVersion, setHoursVersion] = useState(0)
  const hours = useMonthHours(client.id, period, can(profile.role, 'view_revenue'), hoursVersion)
  const checkin = useCheckin(client, period, profile, hours === null ? null : hours.applies)
  const {
    status,
    loadError,
    stored,
    lastMonth,
    lastPeriod,
    lastMonthBucketNotes,
    lastMonthFocus,
    draft,
    saveState,
    advocacyApplies,
    hoursApplies,
    required,
    scored,
    localOverall,
    storedOverall,
    lastOverall,
    hasContent,
    storedSubmitted,
    storedByYou,
    draftPersisted,
    unsavedFromEarlierVisit,
  } = checkin

  // Spec 2026-11-02 §3. Gated at the read: without view_revenue the hook is
  // 'off', issues no query, and the box draws nothing.
  const payment = useMonthPayment(client.id, period, can(profile.role, 'view_revenue'))

  // Bumped after a payment save, so the finance suggestion is read again from
  // revenue as it now stands (spec 2026-11-02 §5).
  const [financeVersion, setFinanceVersion] = useState(0)

  const finance = useFinanceSuggestion(
    client.id,
    period,
    can(profile.role, 'view_revenue'),
    can(profile.role, 'manage_clients'),
    financeVersion,
  )

  // Spec 2026-10-29: fill the two finance answers from revenue once per visit,
  // and only where neither the database nor the form holds an answer. Once,
  // because a person who clears a filled answer has decided -- refilling it on
  // the next render would overrule them.
  //
  // Spec 2026-11-04 §7: the hours answer is filled by the same rule, in the
  // same effect and the same setAnswers call -- two calls in one tick would
  // each start from the same draft and the second would drop the first. It has
  // its own once-per-visit marker because it can arrive later than the revenue
  // answers (or only after Try again), and it is marked only once there is an
  // answer to fill: a "couldn't reach" or "month not finished" result has none,
  // and must not use up the visit's one fill.
  //
  // Spec §7, the AI's placeholder: the routine writes 3 with "hours pending –
  // month not finished" when it scores a month that has not ended, and "a
  // later run, or opening the check-in after month end, replaces it". So the
  // hours answer is also filled over a stored value while the row is still an
  // AI suggestion (suggested_at set) -- never over a row a person saved. The
  // form opens holding the stored value (draftFromRow), so "the form has no
  // answer of its own" means undefined OR still exactly the stored AI value;
  // setAnswers' `replacing` names that value, so a person's own change in the
  // form is never overwritten. It lands as an ordinary unsaved fill.
  const prefilled = useRef<string | null>(null)
  const hoursPrefilled = useRef<string | null>(null)
  useEffect(() => {
    // Edit rights too: a viewer's form is read-only, so a fill would only mark
    // it unsaved with no way to save. (canEdit is declared below this effect.)
    if (status !== 'ready' || !can(profile.role, 'edit_scores')) return
    const visit = `${client.id}:${period}`
    const values: Record<string, number> = {}
    const replacing: Record<string, number> = {}
    if (finance !== null && prefilled.current !== visit) {
      prefilled.current = visit
      for (const key of ['fin_rack_rate', 'fin_rate_increased'] as const) {
        const answer = finance[key]
        const storedValue = stored?.[key] ?? null
        if (answer && storedValue === null && draft.answers[key] === undefined) values[key] = answer.value
      }
    }
    if (hours !== null && hours.applies && hours.answer && hoursPrefilled.current !== visit) {
      hoursPrefilled.current = visit
      const storedValue = stored?.fin_hours_in_budget ?? null
      const formValue = draft.answers[HOURS_QUESTION]
      const aiSuggested = stored != null && stored.suggested_at != null
      if (storedValue === null && formValue === undefined) {
        values[HOURS_QUESTION] = hours.answer.value
      } else if (aiSuggested && storedValue !== null && (formValue === undefined || formValue === storedValue)) {
        values[HOURS_QUESTION] = hours.answer.value
        replacing[HOURS_QUESTION] = storedValue
      }
    }
    if (Object.keys(replacing).length > 0) checkin.setAnswers(values, { replacing })
    else if (Object.keys(values).length > 0) checkin.setAnswers(values)
  }, [status, finance, hours, client.id, period, stored, draft.answers, checkin, profile.role])

  // Spec 2026-11-02 §5, separate from the once-per-visit prefill above: after a
  // payment save, the two finance answers take the newly computed values, OVER
  // a stored one too (the AI's "pending revenue" placeholder 3 is the case this
  // exists for). Only the finance keys the data now answers are passed, and
  // setAnswers changes only the keys it is given, so a person's unsaved score
  // edits survive; a key the data still cannot answer is left alone. It lands
  // as an ordinary unsaved change (no local draft, the same reasoning as the
  // fill), which the person then saves with the rest of the check-in.
  //
  // `refreshFor` names the visit the save happened on, so a suggestion for
  // some other client or month can never be applied. useFinanceSuggestion
  // gives null until the read for the bumped version lands, so a non-null
  // `finance` here is the post-save answer, never the one from before the save.
  //
  // Edit rights, as the prefill: a read-only form must not be marked unsaved.
  // Hours are not touched here: a payment changes revenue, not hours.
  const refreshFor = useRef<string | null>(null)
  useEffect(() => {
    if (refreshFor.current !== `${client.id}:${period}`) return
    if (status !== 'ready' || finance === null) return
    refreshFor.current = null
    if (!can(profile.role, 'edit_scores')) return
    const values: Record<string, number> = {}
    for (const key of ['fin_rack_rate', 'fin_rate_increased'] as const) {
      const answer = finance[key]
      if (answer) values[key] = answer.value
    }
    if (Object.keys(values).length > 0) checkin.setAnswers(values, { overwrite: true })
  }, [status, finance, client.id, period, checkin, profile.role])

  const onPaymentSaved = () => {
    refreshFor.current = `${client.id}:${period}`
    setFinanceVersion((version) => version + 1)
  }

  const readFailed = status === 'error'

  const hoursBox = hours !== null && (
    <HoursBox onRetry={() => setHoursVersion((version) => version + 1)} result={hours} />
  )
  const label = submitLabel(scored, required)
  // "vs Sep": the month this screen compares against, short (brief 2026-11-04 B).
  const since = monthName(lastPeriod, 'short')
  // The spoken form names the month in full: "up 0.33 from September".
  const sinceLong = monthName(lastPeriod, 'long')
  const gate = advocacyGate(client.started_on, period)
  // Last month's own gate. A stored adv_score from a month Advocacy was not
  // asked is not a score to compare against, so it reads as null.
  const lastGateOpen = advocacyGate(client.started_on, lastPeriod).open

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
  const overall = displayedOverall({
    state: saveState,
    localOverall,
    storedOverall,
  })
  // Against the number the summary actually shows (the stored overall while
  // the form is clean, the draft's while it differs), so the arrow can never
  // describe a different number from the one beside it.
  const overallChange = scoreChange(overall, lastOverall)
  const statusLines = saveStatus({
    state: saveState,
    block,
    scored,
    required,
    storedUpdatedAt: stored?.updated_at ?? null,
  })
  const saving = saveState.kind === 'saving'
  // "The form differs from the stored row": the same set of save states
  // displayedOverall treats as formDiffers (dirty, saving, failed), OR a local
  // draft restored from an earlier visit (the draft wins over the stored row).
  // Confirm clears suggested_at on the stored row, so it must not be offered
  // while the screen shows anything else.
  const hasUnsavedChanges =
    saveState.kind === 'dirty' ||
    saveState.kind === 'saving' ||
    saveState.kind === 'failed' ||
    unsavedFromEarlierVisit

  // A run or revert rewrites the stored row. A local draft that matched the OLD
  // row (edited and edited back) would otherwise win on reload and show the old
  // scores as "unsaved from an earlier visit", hiding the suggestion banner.
  const reloadFresh = () => {
    clearDraft(client.id, period)
    checkin.reload()
  }
  // A run that finishes while the person has unsaved edits must not reload over
  // them; the run line still shows the summary.
  const onRunFinished = () => {
    if (hasUnsavedChanges) return
    reloadFresh()
  }

  const back = (
    <nav className={styles.nav}>
      <button className="button button--quiet" type="button" onClick={onBack}>
        Board
      </button>
      {can(profile.role, 'manage_clients') && (
        // The owner: "when I click into a card, I'd love for there to be an
        // option to hit edit client and it takes you into the client roster's
        // edit panel". Same capability the board checks before offering Add
        // client -- reused rather than a second rule about who may edit.
        <button className="button button--quiet" onClick={onEditClient} type="button">
          Edit client
        </button>
      )}
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
        <h3 className="t-subhead">Cannot reach the database</h3>
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
      {can(profile.role, 'manage_clients') && (
        // Spec §3: pausing or cancelling for this month, beside Edit client
        // rather than a trip to the roster. Ready branch only -- an action that
        // changes who is scored has no business beside an unread check-in.
        <EndClientPanel client={client} hasCheckin={stored != null} onPaused={onBack} period={period} />
      )}
      {stored?.suggested_at != null && (
        <SuggestionBanner
          canConfirm={can(profile.role, 'edit_scores')}
          clientId={client.id}
          hasUnsavedChanges={hasUnsavedChanges}
          period={period}
          suggestedAt={stored.suggested_at}
        />
      )}
      {canEdit && (
        // Spec 2026-10-30 §5.2: run the AI for this one client. "Manual" is a
        // stored row nobody has flagged as a suggestion.
        <RunClientButton
          clientId={client.id}
          hasUnsavedChanges={hasUnsavedChanges}
          manual={stored != null && stored.suggested_at == null}
          onFinished={onRunFinished}
          period={period}
        />
      )}
      <RevertButton
        advocacyApplies={advocacyApplies}
        hoursApplies={hoursApplies}
        ai={parseAiSuggestion(stored?.ai_suggestion)}
        canEdit={canEdit}
        clientId={client.id}
        current={(stored ?? {}) as Answers}
        hasUnsavedChanges={hasUnsavedChanges}
        onReverted={reloadFresh}
        period={period}
        profileId={profile.id}
        suggestedAt={stored ? stored.suggested_at : null}
      />

      <div className={styles.totals}>
        <div className={styles.total}>
          <p className="t-label">This month</p>
          <p className={styles.totalLine}>
            {/* An incomplete check-in shows an em dash, never a number. §3.3:
                incomplete must not read as "at risk". The words beside it are
                what a screen reader gets, since an em dash on its own
                announces as nothing. */}
            <span className={`t-display ${styles.totalValue} numeric`} data-testid="overall-value">
              {overall === null ? '—' : formatOverall(overall)}
            </span>
            <span className="t-caption" data-testid="overall-caption">
              {overall === null
                ? `not scored · ${scored} of ${required} answered`
                : `of ${MAX_SCORE}`}
            </span>
          </p>
          <span className={bandClassName(bandFor(overall))} data-testid="overall-band">
            {BAND_LABELS[bandFor(overall)]}
          </span>
          {/* Brief 2026-11-04 B: the draft's overall against last month's
              stored one. Nothing when either is missing -- an arrow against a
              month with no score would invent a rise or a fall. */}
          {overallChange !== null && (
            <p className={`t-caption ${styles.change}`} data-testid="overall-change">
              <ChangeText change={overallChange} label={describeChange('Overall', overallChange, sinceLong)} />{' '}
              <span aria-hidden="true">vs {since}</span>
            </p>
          )}
        </div>

        {/* §5.2: last month alongside, because a score compared is a judgment
            and a score alone is a guess. */}
        <div className={styles.total}>
          <p className="t-label">{formatPeriod(lastPeriod)}</p>
          <p className={styles.totalLine}>
            <span className={`t-display ${styles.totalValue} numeric`}>
              {lastOverall === null ? '—' : formatOverall(lastOverall)}
            </span>
            <span className="t-caption">
              {lastOverall === null ? 'not scored' : `of ${MAX_SCORE}`}
            </span>
          </p>
          <span className={bandClassName(bandFor(lastOverall))}>
            {BAND_LABELS[bandFor(lastOverall)]}
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
            These changes are from an earlier visit on this device and have not
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

      <div className={styles.buckets}>
        {/* Spec 2026-11-04 §2: above the first bucket, so the meeting opens on
            what this month is for. Disabled exactly as the general notes are.
            Inside the bucket list so it shares the list's wider measure. */}
        <FocusBox
          disabled={saving || !canEdit}
          lastFocus={lastMonthFocus}
          onChange={checkin.setFocus}
          value={draft.focus}
        />
        {BUCKETS.map((bucket) => {
          const definition = BUCKET_DEFINITIONS[bucket]
          const questions = questionsFor(bucket, hoursApplies)
          // Finances and Advocacy answer No/Unsure/Yes, so a 1-5 agreement
          // legend above them would explain a scale their rows do not have.
          // Derived from the questions rather than from a list of bucket names,
          // so a bucket that changes kind cannot leave the wrong legend behind.
          const hasScale = questions.some((question) => question.kind === 'scale')
          // Only Advocacy is gated, and it is named rather than compared to a
          // string so the gate has one definition (buckets.ts).
          const shut = bucket === GATED_BUCKET && !advocacyApplies
          // Brief 2026-11-04 B: this month's bucket score from the live draft,
          // beside last month's stored column. Only a finished bucket has a
          // score (bucketScore is null until every question is answered), and
          // a shut Advocacy bucket has neither score nor change.
          const now = shut ? null : bucketScore(draft.answers, bucket, hoursApplies)
          const lastScore =
            bucket === GATED_BUCKET && !lastGateOpen ? null : (lastMonth?.[BUCKET_SCORE_KEY[bucket]] ?? null)
          const change = scoreChange(now, lastScore)
          return (
            // Spec 2026-11-04 §2: questions on the left, a notes panel on the
            // right (a grid, CheckIn.module.css; one column on a narrow
            // screen). A shut Advocacy bucket draws no panel and keeps the
            // single-column shape -- its stored notes stay in the draft and
            // are saved untouched (Review Focus 5).
            <section
              className={shut ? styles.bucket : `${styles.bucket} ${styles.bucketWithNotes}`}
              data-testid={`bucket-${bucket}`}
              key={bucket}
            >
              <div className={styles.bucketQuestions}>
                <div className={styles.bucketHead}>
                  <h3 className="t-subhead" data-testid="bucket-heading">
                    {definition.label}
                  </h3>
                  {now !== null && (
                    <p className={`t-caption ${styles.change}`} data-testid={`bucket-score-${bucket}`}>
                      <span className="t-label numeric">{formatOverall(now)}</span>
                      {change !== null && (
                        <>
                          {' '}
                          <ChangeText change={change} label={describeChange(definition.label, change, sinceLong)} />{' '}
                          <span aria-hidden="true">vs {since}</span>
                        </>
                      )}
                    </p>
                  )}
                </div>

                {hasScale && <ScaleLegend />}

                {/* Spec 2026-11-02 §3, moved by the owner the same day: inside
                    Finances, above its questions, so the payment is confirmed
                    right where the two answers it fills are read. The box draws
                    nothing for a role without view_revenue. */}
                {bucket === PAYMENTS_BUCKET && (
                  <PaymentsBox
                    canEdit={can(profile.role, 'edit_revenue')}
                    clientId={client.id}
                    clientName={client.name}
                    onSaved={onPaymentSaved}
                    payment={payment}
                    period={period}
                  />
                )}

                {/* Shown, not hidden -- §7, "so the scorer learns the bucket
                    exists". A hidden section is a screen that silently asks for
                    17 questions one month and 21 the next with nothing to
                    explain the change. The reason distinguishes the two shut
                    cases, because one is a missing fact somebody can go and
                    enter and the other is a client who is simply new. */}
                {shut && !gate.open && (
                  <p className="alert prose" data-testid="advocacy-gate" role="status">
                    {gate.reason}
                  </p>
                )}

                {questions.map((question) =>
                  question.kind === 'choice' ? (
                    <Fragment key={question.key}>
                      {/* Spec 2026-11-04 §7: the hours lines sit beside the
                          question they answer, directly above it. */}
                      {question.key === HOURS_QUESTION && hoursBox}
                      <ChoiceRow
                        question={question}
                        value={draft.answers[question.key] as number | undefined}
                        lastValue={
                          (lastMonth?.[question.key as keyof CheckinRow] as number | null) ?? null
                        }
                        hint={
                          question.key === 'fin_rack_rate' || question.key === 'fin_rate_increased'
                            ? finance?.[question.key]?.reason
                            : question.key === HOURS_QUESTION && hours?.applies
                              ? hours.answer?.reason
                              : undefined
                        }
                        disabled={saving || !canEdit || shut}
                        onChange={(value) => checkin.setAnswer(question.key, value)}
                        onClear={() => checkin.setAnswer(question.key, null)}
                      />
                    </Fragment>
                  ) : (
                    <QuestionRow
                      key={question.key}
                      question={question}
                      value={draft.answers[question.key] as number | undefined}
                      lastValue={
                        (lastMonth?.[question.key as keyof CheckinRow] as number | null) ?? null
                      }
                      disabled={saving || !canEdit || shut}
                      onChange={(value) => checkin.setAnswer(question.key, value)}
                      onClear={() => checkin.setAnswer(question.key, null)}
                    />
                  ),
                )}

                {/* No hours question this month: the box still says why (no
                    budget, not linked), in the place the question would be. */}
                {bucket === PAYMENTS_BUCKET &&
                  !questions.some((question) => question.key === HOURS_QUESTION) &&
                  hoursBox}
              </div>

              {!shut && (
                <BucketNotesPanel
                  bucket={bucket}
                  disabled={saving || !canEdit}
                  lastActions={lastMonthBucketNotes[bucket]?.actions}
                  note={draft.bucketNotes[bucket]}
                  onChange={(field, text) => checkin.setBucketNote(bucket, field, text)}
                />
              )}
            </section>
          )
        })}
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
