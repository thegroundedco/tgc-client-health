import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bandClassName } from '../src/styles/bandClass.ts'
import type { Band } from '../src/lib/score.ts'

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
// so that adding a Band to src/lib/score.ts is a compile error here too and
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
// so a hyphen-safe regex with a negative lookahead for a following identifier
// character or hyphen is enough to require a real word boundary after the
// name, without needing a full CSS parser.
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
      expect(classNames.length).toBeGreaterThan(0)
      for (const className of classNames) {
        expect(definesClass(css, className)).toBe(true)
      }
    })
  }
})
