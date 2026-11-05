import { BUCKET_DEFINITIONS } from '../lib/buckets'
import type { Bucket } from '../lib/buckets'
import { BUCKET_NOTE_MAX } from './bucketNotes'
import type { BucketNote, BucketNoteField } from './bucketNotes'
import styles from './BucketNotesPanel.module.css'

type Props = {
  bucket: Bucket
  note: BucketNote | undefined
  // Last month's action items for this bucket, for the meeting to ask whether
  // they happened. Absent (or empty) draws no line.
  lastActions?: string
  disabled: boolean
  onChange: (field: BucketNoteField, text: string) => void
}

// Spec 2026-11-04 §2: beside each open bucket, why it scored what it did and
// what we will do about it. The text is shown as typed; trimming and the DB
// caps happen on save (bucketNotes.ts). maxLength is the first line of that
// defence. Notes never count: nothing here touches an answer.
//
// The ids are derived from the bucket, so six panels on one screen never share
// one and every label stays linked to its own box.
export function BucketNotesPanel({ bucket, note, lastActions, disabled, onChange }: Props) {
  const whyId = `bucket-notes-${bucket}-why`
  const actionsId = `bucket-notes-${bucket}-actions`
  const lastId = `bucket-notes-${bucket}-last-actions`
  const hasLast = lastActions !== undefined && lastActions !== ''

  return (
    // A group named after its bucket: six "Why this score" boxes on one page
    // are told apart by the group a screen reader announces on entry.
    <div
      aria-label={`${BUCKET_DEFINITIONS[bucket].label} notes`}
      className={styles.panel}
      data-testid={`bucket-notes-${bucket}`}
      role="group"
    >
      <div className={styles.field}>
        <label className="t-label" htmlFor={whyId}>
          Why this score
        </label>
        <textarea
          className={`field ${styles.box}`}
          disabled={disabled}
          id={whyId}
          maxLength={BUCKET_NOTE_MAX}
          onChange={(event) => onChange('why', event.target.value)}
          rows={3}
          value={note?.why ?? ''}
        />
      </div>
      <div className={styles.field}>
        <label className="t-label" htmlFor={actionsId}>
          Action items
        </label>
        <textarea
          aria-describedby={hasLast ? lastId : undefined}
          className={`field ${styles.box}`}
          disabled={disabled}
          id={actionsId}
          maxLength={BUCKET_NOTE_MAX}
          onChange={(event) => onChange('actions', event.target.value)}
          rows={3}
          value={note?.actions ?? ''}
        />
        {/* Faint by type role (caption, secondary ink), and said in words, so
            it never relies on its colour to read as last month's. */}
        {hasLast && (
          <p className={`t-caption prose ${styles.last}`} id={lastId}>
            {`Last month's actions: ${lastActions}`}
          </p>
        )}
      </div>
    </div>
  )
}
