import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Spec 2026-11-04 §2, fix round 1. jsdom does no layout, so the layout rules
// that decide whether the notes panel gets any room are pinned here, in the
// CSS modules' own text with comments stripped (a comment naming a rule must
// not satisfy the test for it). Lives outside src/ because it needs node:fs.

const ROOT = join(import.meta.dirname, '..')
const css = (path: string) => readFileSync(join(ROOT, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// The body of the first block whose prelude is exactly `prelude`, braces
// matched, so a nested block (an @container's rules) comes back whole.
function block(source: string, prelude: string): string {
  // Anchored to the start of a line, so `.buckets` cannot match the tail of
  // `.screen > .buckets`; leading indentation allowed for nested rules.
  const pattern = new RegExp(`(^|\\n)[ \\t]*${prelude.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')}\\s*\\{`)
  const match = pattern.exec(source)
  if (!match) throw new Error(`no block for ${prelude}`)
  let depth = 0
  const open = match.index + match[0].length - 1
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i)
  }
  throw new Error(`unclosed block for ${prelude}`)
}

const declares = (body: string, property: string, value: string) =>
  new RegExp(`(^|[;{\\s])${property}\\s*:\\s*${value.replace(/[()]/g, '\\$&')}\\s*(;|$)`).test(body.trim())

describe('the check-in bucket grid', () => {
  const source = css('src/checkin/CheckIn.module.css')

  it('measures the bucket list as a container', () => {
    expect(declares(block(source, '.buckets'), 'container-type', 'inline-size')).toBe(true)
  })

  it('goes two columns, 62fr/38fr, by a container query at 40rem', () => {
    const rule = block(block(source, '@container (min-width: 40rem)'), '.bucketWithNotes')
    expect(declares(rule, 'grid-template-columns', 'minmax(0, 62fr) minmax(0, 38fr)')).toBe(true)
  })

  it('has no media query on the bucket grid (or anywhere in the screen)', () => {
    expect(source).not.toMatch(/@media/)
  })

  it('lets the bucket list, and only it, reach --measure-dashboard', () => {
    expect(declares(block(source, '.screen > .buckets'), 'max-width', 'var(--measure-dashboard)')).toBe(true)
    expect(declares(block(source, '.screen'), 'max-width', 'var(--measure-dashboard)')).toBe(true)
    // Every other child of the screen keeps the prose measure.
    expect(declares(block(source, '.screen > *'), 'max-width', 'var(--measure-prose)')).toBe(true)
  })
})

describe('the board card focus line', () => {
  it('is clamped to two lines', () => {
    const rule = block(css('src/board/ClientCard.module.css'), '.focus')
    expect(declares(rule, 'line-clamp', '2')).toBe(true)
    expect(declares(rule, '-webkit-line-clamp', '2')).toBe(true)
    expect(declares(rule, 'overflow', 'hidden')).toBe(true)
  })
})
