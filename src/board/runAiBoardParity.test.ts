import { describe, expect, it } from 'vitest'
import { isOnBoardFor as appRule } from './boardScope'
import { CLIENT_STATUSES } from '../clients/clientForm'
import { lastDayOf as appLastDayOf } from '../lib/month'
import {
  KNOWN_STATUSES,
  isOnBoardFor as functionRule,
  lastDayOf as functionLastDayOf,
} from '../../supabase/functions/run-ai-suggestions/logic.ts'

// The Edge Function cannot import from src/ (Deno bundles only its own
// folder), so it carries a copy of the board's membership rule. This file is
// what keeps the copy honest: both run over the same table and must agree.
//
// It lives in src/ rather than tests/ because tests/ is type-checked with
// nodenext resolution, which cannot follow boardScope.ts's extensionless
// imports; src/ tests use the app's bundler resolution.

type Case = [string, { status: string; started_on: string | null; ended_on: string | null }, boolean]

const cases: Case[] = [
  ['active, no dates', { status: 'active', started_on: null, ended_on: null }, false],
  ['active, no dates, has check-in', { status: 'active', started_on: null, ended_on: null }, true],
  ['paused', { status: 'paused', started_on: null, ended_on: null }, false],
  ['paused, has check-in', { status: 'paused', started_on: null, ended_on: null }, true],
  ['future start', { status: 'active', started_on: '2026-11-01', ended_on: null }, false],
  ['starts on the last day', { status: 'active', started_on: '2026-10-31', ended_on: null }, false],
  ['started before the month', { status: 'active', started_on: '2026-01-15', ended_on: null }, false],
  ['ended before month', { status: 'cancelled', started_on: null, ended_on: '2026-09-30' }, false],
  ['ended before month, has check-in', { status: 'cancelled', started_on: null, ended_on: '2026-09-30' }, true],
  ['ended on the first', { status: 'cancelled', started_on: null, ended_on: '2026-10-01' }, false],
  ['ended mid-month', { status: 'former', started_on: '2025-01-01', ended_on: '2026-10-15' }, false],
  ['unknown status', { status: 'archived', started_on: null, ended_on: null }, false],
  ['unknown status, has check-in', { status: 'archived', started_on: null, ended_on: null }, true],
  ['empty status', { status: '', started_on: null, ended_on: null }, false],
]

const periods = ['2026-10-01', '2026-02-01', '2024-02-01', '2026-12-01']

describe('the Edge Function and the board agree on who is on the board', () => {
  for (const period of periods) {
    it.each(cases)(`${period}: %s`, (_label, dates, hasCheckin) => {
      const client = { id: 1, name: 'Synthetic Client', ...dates }
      expect(functionRule(client, period, hasCheckin)).toBe(appRule(client, period, hasCheckin))
    })
  }

  it('the table exercises both answers', () => {
    const answers = new Set(
      cases.map(([, dates, hasCheckin]) => appRule({ id: 1, name: 'x', ...dates }, '2026-10-01', hasCheckin)),
    )
    expect(answers).toEqual(new Set([true, false]))
  })

  it('knows the same statuses as the client form', () => {
    expect([...KNOWN_STATUSES].sort()).toEqual([...CLIENT_STATUSES].sort())
  })

  it.each(['2026-01-01', '2026-02-01', '2024-02-01', '2026-04-01', '2026-12-01'])('lastDayOf(%s) agrees', (period) => {
    expect(functionLastDayOf(period)).toBe(appLastDayOf(period))
  })
})
