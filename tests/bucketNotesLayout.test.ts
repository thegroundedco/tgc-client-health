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
  new RegExp(`(^|[;{\\s])${property}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(;|$)`).test(body.trim())

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

  it('lets the bucket list reach --measure-dashboard', () => {
    expect(declares(block(source, '.screen > .buckets'), 'max-width', 'var(--measure-dashboard)')).toBe(true)
    expect(declares(block(source, '.screen'), 'max-width', 'var(--measure-dashboard)')).toBe(true)
    // Every other child of the screen keeps the prose measure (the summary
    // box is the one other exception, pinned below).
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

// Brief 2026-11-04 (mom-and-layout), part A. The owner's screenshots on a wide
// desktop: "Last month" stranded at the far edge, three boxes with three
// different right edges, and a notes panel heavier than the questions.

describe('the last-month value on a question row', () => {
  for (const path of ['src/checkin/QuestionRow.module.css', 'src/checkin/ChoiceRow.module.css']) {
    const source = css(path)

    it(`${path}: sits after the scale and Clear, not pushed to the far edge`, () => {
      // No auto margin anywhere in the row: an auto inline margin on .last is
      // what threw it to the edge of a 1500px column.
      expect(source).not.toMatch(/margin[a-z-]*\s*:[^;}]*\bauto\b/)
      expect(source).not.toMatch(/justify-content\s*:\s*space-(between|around|evenly)/)
      expect(declares(block(source, '.scale'), 'justify-content', 'flex-end')).toBe(false)
    })

    it(`${path}: still wraps below the buttons on a narrow width, with the row's own gap`, () => {
      const scale = block(source, '.scale')
      expect(declares(scale, 'flex-wrap', 'wrap')).toBe(true)
      expect(declares(scale, 'gap', 'var(--space-3)')).toBe(true)
    })
  }
})

describe('the check-in screen edges', () => {
  const source = css('src/checkin/CheckIn.module.css')

  it('gives the summary box the same measure as the bucket list', () => {
    expect(declares(block(source, '.screen > .totals'), 'max-width', 'var(--measure-dashboard)')).toBe(true)
  })

  it('lets exactly the summary box and the bucket list out of the prose measure', () => {
    const widened = [...source.matchAll(/(^|\n)[ \t]*(\.screen > \.[A-Za-z]+)\s*\{([^}]*)\}/g)]
      .filter((match) => declares(match[3], 'max-width', 'var(--measure-dashboard)'))
      .map((match) => match[2])
      .sort()
    expect(widened).toEqual(['.screen > .buckets', '.screen > .totals'])
  })

  it('puts no width cap of its own on the focus box or a bucket section', () => {
    // Both fill the bucket list, so all three share its edges.
    expect(block(css('src/checkin/FocusBox.module.css'), '.box')).not.toMatch(/max-(width|inline-size)/)
    expect(block(source, '.bucket')).not.toMatch(/max-(width|inline-size)/)
    // Every block whose prelude is exactly .totals, not only the first.
    const totals = [...source.matchAll(/(^|\n)[ \t]*\.totals\s*\{([^}]*)\}/g)].map((match) => match[2])
    expect(totals.length).toBeGreaterThan(0)
    for (const body of totals) expect(body).not.toMatch(/max-(width|inline-size)/)
  })
})

describe('the bucket notes panel weight', () => {
  const source = css('src/checkin/BucketNotesPanel.module.css')
  const tsx = readFileSync(join(ROOT, 'src/checkin/BucketNotesPanel.tsx'), 'utf8')

  it('draws each box about three rows tall, still resizable', () => {
    const box = block(source, '.box')
    expect(declares(box, 'block-size', 'calc(3lh + 2 * var(--space-3) + 2px)')).toBe(true)
    expect(declares(box, 'resize', 'vertical')).toBe(true)
    // Both textareas, three rows each, and no other row count.
    expect(tsx.match(/rows=\{(\d+)\}/g)).toEqual(['rows={3}', 'rows={3}'])
  })

  it('keeps the panel top level with the bucket heading', () => {
    expect(declares(block(source, '.panel'), 'align-content', 'start')).toBe(true)
    expect(block(source, '.panel')).not.toMatch(/align-self|margin|padding-(top|block)/)
    // The grid row is not centring or bottom-aligning its two columns.
    const checkin = css('src/checkin/CheckIn.module.css')
    expect(block(checkin, '.bucket')).not.toMatch(/align-items|place-items/)
  })
})

describe('the bucket heading line', () => {
  const source = css('src/checkin/CheckIn.module.css')

  it('puts the score beside the heading, wrapping under it when there is no room', () => {
    const head = block(source, '.bucketHead')
    expect(declares(head, 'display', 'flex')).toBe(true)
    expect(declares(head, 'flex-wrap', 'wrap')).toBe(true)
    expect(declares(head, 'align-items', 'baseline')).toBe(true)
    expect(head).not.toMatch(/justify-content|margin/)
  })
})
