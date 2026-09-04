import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { defaultPeriod, formatPeriod, periodOptions } from '../lib/month'
import { formatMoney, parseMoney, MAX_CENTS } from './money'
import { concentration } from './revenueMath'
import type { EligibleClient, RevenueRow } from './revenueMath'
import { useRevenue } from './useRevenue'
import styles from './RevenueAdmin.module.css'

type Props = { onWritingChange?: (writing: boolean) => void }

// One client's two fields, held as the STRING a person is typing rather than
// as cents. Parsing happens once, at Save, via money.ts's parseMoney -- not
// here on every keystroke -- so a field can hold "four thousand" or "" for as
// long as somebody is looking at it without the grid throwing it away.
type Entry = { retainer: string; project: string }

// The whole reason this file exists, expressed as a pure function so it can be
// re-run from two places without drifting: once when a fetch lands (a fresh
// month, or the reload after a save), and once from the Back button, which
// discards whatever a person has typed and returns every field to what the
// server last held.
//
// A client with NO row gets '', never '0'. Money.ts's own header says an empty
// field IS zero to parseMoney -- that is what makes leaving nine of ten fields
// blank and saving still write nine real zeros. But this function runs before
// any of that: its job is to tell a client who has never been billed apart
// from a client billed exactly nothing, and '0' would erase that distinction
// the moment the screen opened, before anyone had typed a thing. Spec section
// 3.3.
function buildEntries(
  clients: readonly EligibleClient[],
  rows: readonly RevenueRow[],
): Record<number, Entry> {
  const byClient = new Map(rows.map((row) => [row.client_id, row]))
  const next: Record<number, Entry> = {}
  for (const client of clients) {
    const row = byClient.get(client.id)
    next[client.id] = row
      ? { retainer: String(row.retainer_cents / 100), project: String(row.project_cents / 100) }
      : { retainer: '', project: '' }
  }
  return next
}

export function RevenueAdmin({ onWritingChange }: Props) {
  const [period, setPeriod] = useState(defaultPeriod())
  const revenue = useRevenue(period)

  const [entries, setEntries] = useState<Record<number, Entry>>({})

  // Re-derived whenever a fresh fetch lands -- a new month chosen, or the
  // reload this screen fires after a successful save -- and NOT on every
  // render, because `clients`/`rows` only get new array identities when
  // useRevenue actually replaces them. If this ran unconditionally it would
  // overwrite whatever somebody is mid-way through typing on every keystroke;
  // gated on the fetched data instead, it fires exactly when the fields ought
  // to be replaced and never while someone is using them.
  useEffect(() => {
    setEntries(buildEntries(revenue.clients, revenue.rows))
  }, [revenue.clients, revenue.rows])

  // Cleared validation refusal, and cleared start-of-Save so a second attempt
  // after fixing the field does not leave the first refusal on screen beside a
  // field that is now fine.
  const [validationError, setValidationError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function setField(clientId: number, field: keyof Entry, value: string) {
    setEntries((current) => ({
      ...current,
      [clientId]: { ...(current[clientId] ?? { retainer: '', project: '' }), [field]: value },
    }))
  }

  // Discards whatever has been typed and returns every field to what the last
  // fetch actually holds. Disabled while saving for the same reason Save is:
  // resetting the fields out from under a write already in flight would leave
  // the person staring at numbers that no longer describe what was sent.
  function handleBack() {
    setValidationError(null)
    setSaveError(null)
    setEntries(buildEntries(revenue.clients, revenue.rows))
  }

  // Requirement 6: every field is parsed before anything is written. The loop
  // returns on the FIRST failure rather than collecting every bad field,
  // because the message names one client and the person fixes it, tries
  // again, and (if there is a second bad field) is told about that one next --
  // simpler than a list, and no test asks for more.
  async function handleSave() {
    setValidationError(null)
    setSaveError(null)
    setSavedAt(null)

    type PendingRow = {
      client_id: number
      period: string
      retainer_cents: number
      project_cents: number
    }
    const pending: PendingRow[] = []

    // Rows already on file, so the skip below can tell "nobody has touched
    // this yet" apart from "this was entered and is being corrected back to
    // nothing".
    const existingRowIds = new Set(revenue.rows.map((row) => row.client_id))

    for (const client of revenue.clients) {
      const entry = entries[client.id] ?? { retainer: '', project: '' }

      // A client with BOTH fields blank and no row already on file is
      // untouched, not billed zero -- writing it anyway is the exact false
      // zero spec section 3.3 forbids, and it is what the review round 1 probe
      // caught: editing only one client's field and saving wrote real 0/0 rows
      // for every OTHER eligible client, because parseMoney('') legitimately
      // returns 0 and nothing upstream of it knew the difference between "this
      // field is blank because nobody has entered anything" and "this field is
      // blank because the person just cleared it".
      //
      // No touch-tracking needed to fix it: one field filled and the other
      // left blank still writes, with the blank read as parseMoney's zero --
      // that is its documented contract. A typed `0` is not blank, so it still
      // writes too, which is what stops this from overshooting into "never
      // write a zero": a client billed nothing this month has to be able to
      // SAY so. And an existing row cleared back to blank on both fields still
      // writes 0/0 rather than being skipped, because clearing an entered row
      // is how "actually billed nothing" gets recorded on a table with no
      // delete policy -- skipping it here would silently leave the OLD figure
      // standing under a field that now reads empty.
      if (
        entry.retainer.trim() === '' &&
        entry.project.trim() === '' &&
        !existingRowIds.has(client.id)
      ) {
        continue
      }

      const retainerCents = parseMoney(entry.retainer)
      if (retainerCents === null) {
        setValidationError(
          `${client.name}'s retainer is not a dollar amount up to ${formatMoney(MAX_CENTS)}. Nothing was saved.`,
        )
        return
      }

      const projectCents = parseMoney(entry.project)
      if (projectCents === null) {
        setValidationError(
          `${client.name}'s project work is not a dollar amount up to ${formatMoney(MAX_CENTS)}. Nothing was saved.`,
        )
        return
      }

      pending.push({
        client_id: client.id,
        period,
        retainer_cents: retainerCents,
        project_cents: projectCents,
      })
    }

    // Requirement 8: set before the write and cleared in a `finally`, so a
    // thrown error -- a dropped connection, not merely a rejected write -- does
    // not leave the menu bar disabled for the rest of the session with no
    // screen left able to re-enable it.
    setSaving(true)
    onWritingChange?.(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const enteredBy = userData.user?.id ?? null
      const rows = pending.map((row) => ({ ...row, entered_by: enteredBy }))

      // Requirement 7: ONE upsert, the whole month at once. A loop of one
      // upsert per client can succeed for the first six rows and fail on the
      // seventh, and a half-saved month is worse than an unsaved one -- the
      // absence of a row is meaningful here, so a month that is half-written
      // reads as some clients having genuinely not been entered yet, which is
      // false.
      const { error } = await supabase
        .from('client_month_revenue')
        .upsert(rows, { onConflict: 'client_id,period' })

      if (error) {
        setSaveError(describeError(error))
        return
      }

      setSavedAt(new Date().toISOString())
      revenue.reload()
    } catch (thrown: unknown) {
      setSaveError(describeError(thrown))
    } finally {
      setSaving(false)
      onWritingChange?.(false)
    }
  }

  const masthead = (
    <div className="masthead">
      <p className="t-eyebrow">Revenue</p>
      <h2 className="t-header">Revenue entry</h2>
    </div>
  )

  // The Back button. UsersAdmin and ClientsAdmin no longer render one of their
  // own -- the 2026-09-02 shell rewrite gave the menu bar a permanent presence
  // above every admin screen, so a screen-local exit stopped being the only
  // way out and both dropped theirs in favour of reporting `onWritingChange`
  // upward for the bar to guard instead. This screen keeps one anyway, because
  // the task-6 brief and its test both require one and neither hands this
  // component an onBack destination to leave to (its whole prop surface is
  // `onWritingChange`) -- so "Back" here means back to what the server holds,
  // discarding a draft rather than leaving the page. Disabled while saving for
  // the same reason the field inputs are.
  const backButton = (
    <button
      className="button button--quiet"
      disabled={saving}
      onClick={handleBack}
      type="button"
    >
      Back
    </button>
  )

  if (revenue.status === 'loading') {
    return (
      <section className={styles.screen}>
        {masthead}
        <p className="t-body">Loading…</p>
        {backButton}
      </section>
    )
  }

  if (revenue.status === 'error') {
    return (
      <section className={styles.screen}>
        {masthead}
        <p className="alert prose" role="alert">
          {revenue.loadError}
        </p>
        {backButton}
      </section>
    )
  }

  const report = concentration(revenue.clients, revenue.rows)

  return (
    <section className={styles.screen}>
      {masthead}

      <div className={styles.monthRow}>
        <label className={styles.monthLabel} htmlFor="revenue-period">
          <span className="t-body">Month</span>
          <select
            aria-label="Month"
            className={styles.monthSelect}
            id="revenue-period"
            onChange={(event) => setPeriod(event.target.value)}
            value={period}
          >
            {periodOptions().map((option) => (
              <option key={option} value={option}>
                {formatPeriod(option)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Requirement 5, spec §3.3, said out loud on the screen where it can be
          fixed rather than only inferred from a blank field somewhere in a
          list of ten. Matches Concentration's own "N of M" wording so the two
          screens never disagree about which number the phrase names. */}
      <p className="t-caption">
        {report.missing} of {revenue.clients.length} clients have no entry for{' '}
        {formatPeriod(period)} yet.
      </p>

      {revenue.clients.length === 0 ? (
        <p className="t-body prose">No eligible clients this month.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Retainer</th>
                <th scope="col">Project work</th>
              </tr>
            </thead>
            <tbody>
              {revenue.clients.map((client) => {
                const entry = entries[client.id] ?? { retainer: '', project: '' }
                return (
                  <tr key={client.id}>
                    <th scope="row">
                      <span className="t-body">{client.name}</span>
                    </th>
                    <td>
                      <input
                        aria-label={`${client.name} retainer`}
                        className={styles.moneyInput}
                        disabled={saving}
                        inputMode="decimal"
                        onChange={(event) => setField(client.id, 'retainer', event.target.value)}
                        type="text"
                        value={entry.retainer}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${client.name} project work`}
                        className={styles.moneyInput}
                        disabled={saving}
                        inputMode="decimal"
                        onChange={(event) => setField(client.id, 'project', event.target.value)}
                        type="text"
                        value={entry.project}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {validationError && (
        <p className="alert" role="alert">
          {validationError}
        </p>
      )}

      {saveError && (
        <p className="t-caption" role="status">
          {saveError}
        </p>
      )}

      {savedAt && !saveError && (
        <p className="t-caption" role="status">
          Saved.
        </p>
      )}

      <div className={styles.actions}>
        <button className="button" disabled={saving} onClick={() => void handleSave()} type="button">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {backButton}
      </div>
    </section>
  )
}
