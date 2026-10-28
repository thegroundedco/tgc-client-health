import { EMPTY_DRAFT, formProblems } from './clientForm'
import type { ClientDraft } from './clientForm'
import { formatDay, lastDayOf } from '../lib/month'

// What the check-in screen can do to a client's status (spec §3). Two changes,
// no more: settling `cancelled` to `former`, or anything else, stays on the
// roster, where Edit client already goes.
export type CancelChange = { kind: 'cancel'; endedOn: string; endReasonCode: string; endReasonNote: string }
export type StatusChange = { kind: 'pause' } | CancelChange

export type DateBounds = { min: string; max: string }

// The month being scored, but never before the client started: an end date
// earlier than the start is a client who left before they arrived.
export function cancelDateBounds(period: string, startedOn: string | null): DateBounds {
  const min = startedOn !== null && startedOn > period ? startedOn : period
  return { min, max: lastDayOf(period) }
}

// Only the four lifecycle fields move. Name, owner, start date, note and type
// are carried across untouched, because updatePayload sends every column on
// every write and a change here must not rewrite what the roster holds.
export function draftWithChange(draft: ClientDraft, change: StatusChange): ClientDraft {
  if (change.kind === 'pause') {
    return { ...draft, status: 'paused', endedOn: '', endReasonCode: '', endReasonNote: '' }
  }
  return {
    ...draft,
    status: 'cancelled',
    endedOn: change.endedOn,
    endReasonCode: change.endReasonCode,
    endReasonNote: change.endReasonNote,
  }
}

// What the panel refuses before anything is sent. The lifecycle sentences come
// from formProblems itself, run on a stand-in draft, so the panel and the
// roster can never word the same rule two ways. The bounds are this screen's
// own rule (spec §3), added after.
export function cancelProblems(change: CancelChange, bounds: DateBounds): string[] {
  const lifecycle = formProblems(draftWithChange({ ...EMPTY_DRAFT, name: 'stand-in' }, change))
    .filter((problem) => problem.field === 'endedOn' || problem.field === 'endReasonCode')
    .map((problem) => problem.text)
  const outside = change.endedOn !== '' && (change.endedOn < bounds.min || change.endedOn > bounds.max)
  return outside
    ? [...lifecycle, `The end date has to fall between ${formatDay(bounds.min)} and ${formatDay(bounds.max)}.`]
    : lifecycle
}
