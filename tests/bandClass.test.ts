import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bandClassName } from '../src/styles/bandClass.ts'
import type { Band } from '../src/lib/scoreMath.ts'

// bandClassName assembles its class string at runtime by string interpolation,
// so a typo in any of the five names it can produce ("band", "band--healthy",
// "band--watch", "band--risk", "band--none") is invisible to tsc, invisible to
// tests/tokens.test.ts, and invisible in a code review that only reads the
// mapping and trusts it. The failure it guards against is quiet, not loud: a
// misspelled class means the chip renders with no background colour while its
// text label still shows correctly, so the screen looks slightly plain rather
// than broken, and nothing else in the suite would catch it. This project's
// whole premise is that a check which cannot fail is worth nothing, so this
// test reads the actual stylesheet and checks the actual strings produced.

const ROOT = join(import.meta.dirname, '..')

// Every member of Band, derived from a Record rather than typed out by hand,
// so that adding a Band to src/lib/scoreMath.ts is a compile error here too and
// this test cannot silently go on covering only some of the bands.
const ALL_BANDS: Record<Band, true> = {
  healthy: true,
  watch: true,
  at_risk: true,
  incomplete: true,
}

// A rule exists for a class name only if that exact name appears, not merely
// as a prefix of a longer one: "band" is a substring of "band--healthy", so
// `css.includes('.' + name)` would stay true even if the standalone `.band`
// rule — the one carrying the chip's shape, padding and uppercase treatment —
// were deleted entirely, as long as a modifier rule like `.band--healthy`
// survived. That is a false pass, and it is the same failure this test exists
// to catch, one level up: nothing else in the suite would notice either. The
// class names here are a closed, known set (no CSS-selector metacharacters),
// so a hyphen-safe regex is enough, without needing a full CSS parser. The
// negative lookahead asserts precisely that the character immediately after
// the class name is neither an identifier character nor a hyphen. That is
// stricter than a regex word boundary (`\b`): a hyphen is already a
// non-word character, so `\b` would treat the transition from "band" into
// "--healthy" as a boundary and accept it anyway, which is exactly the false
// pass this check exists to rule out. Excluding the hyphen explicitly, not
// merely requiring a non-identifier character, is what actually stops
// `.band--healthy` from satisfying a check for `.band`.
//
// One limitation this leaves unguarded: the check searches the text of
// base.css, not its parsed rules, so a class name appearing only inside a
// CSS comment would satisfy it even though no rule declared that class. That
// does not happen today — base.css has no such comment — and a comment
// creates no styling, but the check as written cannot tell the two apart.
function definesClass(css: string, className: string): boolean {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\.${escaped}(?![\\w-])`).test(css)
}

describe('bandClassName', () => {
  const css = readFileSync(join(ROOT, 'src/styles/base.css'), 'utf8')

  // A read that silently returned '' would make every assertion below
  // vacuously fail loudly (good) or, worse under a different assertion style,
  // pass for the wrong reason. Assert the file was actually read, following
  // tests/tokens.test.ts's own "is walked, not silently skipped" pattern.
  it('actually read base.css, not an empty string', () => {
    expect(css.length).toBeGreaterThan(0)
    expect(definesClass(css, 'band')).toBe(true)
  })

  for (const band of Object.keys(ALL_BANDS) as Band[]) {
    it(`produces only classes that exist in base.css for "${band}"`, () => {
      const classNames = bandClassName(band).split(' ')
      // Exactly two: the base class and one modifier. That is the whole
      // contract of bandClassName, and asserting the count rather than
      // `length > 0` is the difference between a check and a formality —
      // String.split never returns an empty array, so the old assertion could
      // not fail. The emptiness check is not redundant with it: a blank
      // modifier would still split into two entries, and definesClass('')
      // returns true against this stylesheet, satisfied by the full stop
      // ending its opening comment.
      expect(classNames).toHaveLength(2)
      expect(classNames.filter((name) => name.length === 0)).toEqual([])
      for (const className of classNames) {
        expect(definesClass(css, className)).toBe(true)
      }
    })
  }
})
