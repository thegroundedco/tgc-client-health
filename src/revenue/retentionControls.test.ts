import { describe, expect, it } from 'vitest'
import {
  EXCLUDED_END_REASONS,
  RETENTION_WINDOWS,
  SHORT_WINDOW_MONTHS,
  baseForWindow,
  excludeUncontested,
  isShortWindow,
} from './retentionControls'
import type { RetentionClient } from './retentionMath'

function client(id: number, over: Partial<RetentionClient> = {}): RetentionClient {
  return {
    id,
    name: `Client ${id}`,
    started_on: '2020-01-01',
    ended_on: null,
    end_reason_code: null,
    ...over,
  }
}

describe('the windows on offer', () => {
  it('are the four the owner chose, longest last', () => {
    expect(RETENTION_WINDOWS).toEqual([1, 3, 6, 12])
  })

  it('counts back from the anchor by whole months', () => {
    expect(baseForWindow('2026-09-01', 12)).toBe('2025-09-01')
    expect(baseForWindow('2026-09-01', 1)).toBe('2026-08-01')
    expect(baseForWindow('2026-09-01', 6)).toBe('2026-03-01')
  })

  it('crosses a year boundary without losing a month', () => {
    // The off-by-one that string arithmetic invites. January's three-month
    // base is October of the year before, not October of the same year.
    expect(baseForWindow('2026-01-01', 3)).toBe('2025-10-01')
    expect(baseForWindow('2026-02-01', 12)).toBe('2025-02-01')
  })

  it('agrees with retentionMath about the twelve-month base', () => {
    // The default the whole app has used since 6f-1. If these two ever
    // disagree the section silently changes the number it reports upward.
    expect(baseForWindow('2026-09-01', 12)).toBe('2025-09-01')
    expect(baseForWindow('2026-01-01', 12)).toBe('2025-01-01')
  })
})

describe('the short-window caution — 6f-1 trap 1', () => {
  it('cautions anything under six months', () => {
    expect(SHORT_WINDOW_MONTHS).toBe(6)
    expect(isShortWindow(1)).toBe(true)
    expect(isShortWindow(3)).toBe(true)
  })

  it('does not caution six or twelve', () => {
    expect(isShortWindow(6)).toBe(false)
    expect(isShortWindow(12)).toBe(false)
  })
})

describe('excludeUncontested — 6f-1 trap 2', () => {
  // Excluding EVERY departure would park NRR at or above 100% permanently,
  // because the only clients left would be the ones who stayed. These two
  // codes are the ones that were not retention failures.
  it('names only the two reasons the owner chose', () => {
    expect([...EXCLUDED_END_REASONS].sort()).toEqual(['agency_initiated', 'project_completed'])
  })

  it('drops a client we ended ourselves', () => {
    const kept = excludeUncontested([
      client(1),
      client(2, { ended_on: '2026-05-01', end_reason_code: 'agency_initiated' }),
    ])

    expect(kept.map((entry) => entry.id)).toEqual([1])
  })

  it('drops a client whose project simply finished', () => {
    const kept = excludeUncontested([
      client(1),
      client(2, { ended_on: '2026-05-01', end_reason_code: 'project_completed' }),
    ])

    expect(kept.map((entry) => entry.id)).toEqual([1])
  })

  // The whole point of the control being narrow. A version that dropped these
  // would be the flattering number 6f-1 refused.
  it('KEEPS every departure that was a loss', () => {
    const losses = ['price', 'scope_fit', 'went_quiet', 'in_housed', 'other']
    const kept = excludeUncontested([
      client(1),
      ...losses.map((code, index) =>
        client(index + 2, { ended_on: '2026-05-01', end_reason_code: code }),
      ),
    ])

    expect(kept).toHaveLength(losses.length + 1)
  })

  it('keeps in-housing, which the owner was offered and declined', () => {
    const kept = excludeUncontested([
      client(1, { ended_on: '2026-05-01', end_reason_code: 'in_housed' }),
    ])

    expect(kept).toHaveLength(1)
  })

  it('keeps a departure with no reason recorded, because we cannot say', () => {
    // The honest bucket, the same ruling retention §3.1a makes. Dropping an
    // unexplained departure would let a data-entry gap flatter the figure.
    const kept = excludeUncontested([
      client(1, { ended_on: '2026-05-01', end_reason_code: null }),
    ])

    expect(kept).toHaveLength(1)
  })

  it('keeps an ACTIVE client that somehow carries a reason code', () => {
    // ended_on is what makes someone a departure. A stale reason code on a
    // live client must not remove them from their own retention figure.
    const kept = excludeUncontested([
      client(1, { ended_on: null, end_reason_code: 'agency_initiated' }),
    ])

    expect(kept).toHaveLength(1)
  })

  it('returns everyone untouched when nobody qualifies', () => {
    const roster = [client(1), client(2)]

    expect(excludeUncontested(roster)).toHaveLength(2)
  })
})
