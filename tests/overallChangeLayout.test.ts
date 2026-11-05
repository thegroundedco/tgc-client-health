import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Brief 2026-11-05 B2: the overall change sits beside the big numbers, laid out
// by flex with gap -- no absolute positioning, no pixel offsets -- and wraps on
// a narrow screen. jsdom does no layout, so the rules are pinned in source,
// comments stripped. Where it actually lands needs the owner's eyes.

const css = readFileSync(join(import.meta.dirname, '..', 'src/checkin/CheckIn.module.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

function block(selector: string): string[] {
  const match = new RegExp(`(^|\\n)\\${selector}\\s*\\{([^}]*)\\}`).exec(css)
  if (!match) throw new Error(`no block for ${selector}`)
  return match[2].split(';').map((part) => part.trim().replace(/\s+/g, ' ')).filter(Boolean)
}

describe('the overall change beside the scores', () => {
  it('lays the totals row out with wrapping flex and a gap', () => {
    const totals = block('.totals')
    expect(totals).toContain('display: flex')
    expect(totals).toContain('flex-wrap: wrap')
    expect(totals.some((d) => d.startsWith('gap:'))).toBe(true)
  })

  it('sets each score line on a shared baseline', () => {
    const line = block('.totalLine')
    expect(line).toContain('display: flex')
    expect(line).toContain('align-items: baseline')
  })

  it('positions nothing absolutely on the check-in screen', () => {
    expect(css).not.toMatch(/position\s*:\s*(absolute|fixed)/)
  })
})
