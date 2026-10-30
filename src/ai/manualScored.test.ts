import { describe, expect, it } from 'vitest'
import type { CardCheckin } from '../board/cardSummary'
import { manualScored } from './manualScored'

const row = (client_id: number, suggested_at: string | null): CardCheckin => ({
  client_id, submitted_at: '2026-10-01T00:00:00Z', submitted_by: 'u',
  comm_score: 3, growth_score: 3, fin_score: 3, rel_score: 3, del_score: 3, adv_score: 3,
  suggested_at,
})

describe('manualScored', () => {
  it('keeps members whose check-in has no suggested_at', () => {
    const checkins = new Map([[1, row(1, null)]])
    expect([...manualScored(new Set([1]), checkins)]).toEqual([1])
  })
  it('excludes a member whose check-in is AI-suggested', () => {
    const checkins = new Map([[1, row(1, '2026-10-02T00:00:00Z')]])
    expect(manualScored(new Set([1]), checkins).size).toBe(0)
  })
  it('excludes a member with no check-in', () => {
    expect(manualScored(new Set([1]), new Map()).size).toBe(0)
  })
  it('excludes a non-member even with a manual check-in', () => {
    const checkins = new Map([[2, row(2, null)]])
    expect(manualScored(new Set([1]), checkins).size).toBe(0)
  })
})
