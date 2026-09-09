// Spec section 9. The old rule here was "no percentage anywhere on this
// page", enforced by a regex over the rendered output. That was the right
// instinct and the wrong mechanism: a regex cannot tell a true "22% of
// September" from a meaningless "91.2% GRR", so it had to forbid both, and
// concentration needs the first one.
//
// The rule now lives where the number is COMPUTED -- revenueMath.rate()
// returns null below MIN_RATE_PERIODS, and revenueMath.test.ts fails if that
// threshold is relaxed. What remains here is the half a compute-site guard
// cannot cover: that no percentage is written into this page as a literal,
// bypassing the arithmetic entirely.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')

// Every file that renders on the Revenue page EXCEPT Churn.tsx, and the
// exception is named here rather than papered over with a vaguer sentence --
// see the paragraph below it.
//
// Tenure.tsx was missing here entirely until a reviewer proved the gap by
// inserting a literal "Retention is running at 91.2% this year." into it and
// watching the whole suite pass -- this file only ever read Revenue.tsx.
// Retention.tsx joined the same way, from slice 6f-1: it renders real NRR/GRR
// percentages computed by retentionMath, which is exactly what this guard is
// meant to allow -- a fabricated one, typed into its markup instead of
// computed, is what it forbids. Concentration.tsx joined last, in the same
// slice's fix wave, having been left out while the sentence above it was
// widened to "every file" -- the comment claimed a reach the list did not
// have, and unlike Churn.tsx Concentration has no guard of its own. It passes:
// every `%` in it is preceded by `}`, the close of an interpolation, because
// its percentages come from allocatePercentages.
//
// CHURN.TSX CANNOT BE ADDED, and that is a fact about this regex, not a gap
// somebody forgot. Its module comment quotes "9.1%" -- the churn rate off one
// departure, the exact number spec section 6 refuses to compute -- so a file
// whose comment argues against a fabricated percentage would be failed by the
// rule against fabricated percentages. It carries its own argument instead;
// see its module comment.
//
// A list, not a directory scan: a directory scan would catch a stray literal
// in a file that never reaches this page and give a false sense that the rule
// is broader than it is.
const GUARDED_FILES = [
  join(ROOT, 'src', 'shell', 'Revenue.tsx'),
  join(ROOT, 'src', 'revenue', 'Tenure.tsx'),
  join(ROOT, 'src', 'revenue', 'Retention.tsx'),
  join(ROOT, 'src', 'revenue', 'Concentration.tsx'),
]

describe('the Revenue page', () => {
  it('writes no percentage into its own markup', () => {
    for (const path of GUARDED_FILES) {
      const source = readFileSync(path, 'utf8')
      // A non-vacuity check, not a formality: `not.toMatch` on an empty or
      // truncated read (a stubbed file, an unresolved path swallowed by a
      // lenient mock) passes with nothing to say no to. Below this length the
      // absence of a percentage would prove nothing about the file's real
      // content.
      expect(source.length).toBeGreaterThan(200)
      expect(source).not.toMatch(/\d\s*%/)
    }
  })
})
