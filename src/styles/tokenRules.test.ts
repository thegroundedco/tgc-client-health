import { describe, expect, it } from 'vitest'
import { EXEMPT_PATHS, findViolations, formatViolations } from './tokenRules'

// Fixture strings in this file contain the literals the rule exists to catch,
// so this file is itself exempt. That exemption is the reason EXEMPT_PATHS is an
// exported constant rather than a private detail: the test below asserts the
// exemption list is exactly what it is meant to be, so widening it later is a
// visible, deliberate change rather than a quiet one.
describe('EXEMPT_PATHS', () => {
  it('is exactly the two files that must contain literals', () => {
    expect([...EXEMPT_PATHS]).toEqual([
      'src/styles/tokens.css',
      'src/styles/tokenRules.test.ts',
    ])
  })
})

describe('findViolations — hex colours', () => {
  it('flags a six-digit hex in a stylesheet', () => {
    const found = findViolations([
      { path: 'src/board/Board.module.css', source: '.card { color: #1F1F1F; }' },
    ])
    expect(found).toEqual([
      {
        path: 'src/board/Board.module.css',
        line: 1,
        rule: 'hex-colour',
        text: '#1F1F1F',
      },
    ])
  })

  it('flags three-, four- and eight-digit hex', () => {
    const found = findViolations([
      { path: 'src/a.css', source: 'a{color:#fff}\nb{color:#fff8}\nc{color:#1F1F1F80}' },
    ])
    expect(found.map((v) => v.text)).toEqual(['#fff', '#fff8', '#1F1F1F80'])
    expect(found.map((v) => v.line)).toEqual([1, 2, 3])
  })

  it('flags hex in TypeScript too, including inside a comment', () => {
    const found = findViolations([
      { path: 'src/board/Board.tsx', source: '// brand teal is #83C1C0\n' },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].rule).toBe('hex-colour')
  })

  it('does not flag a CSS id selector or a URL fragment', () => {
    const found = findViolations([
      { path: 'src/a.css', source: '#root { margin: 0 }\n#boot-slow { display: none }' },
      { path: 'src/b.ts', source: "const url = 'https://example.com/page#section'" },
    ])
    expect(found).toEqual([])
  })

  it('flags hex colours regardless of surrounding CSS property case', () => {
    const found = findViolations([
      { path: 'src/a.css', source: '.x { COLOR: #fff; }' },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].text).toBe('#fff')
  })

  it('reports nothing for the exempt files', () => {
    const found = findViolations([
      { path: 'src/styles/tokens.css', source: '--brand-ink: #1F1F1F;' },
      { path: 'src/styles/tokenRules.test.ts', source: 'const x = "#83C1C0"' },
    ])
    expect(found).toEqual([])
  })
})

describe('findViolations — colour functions', () => {
  it('flags rgb, rgba, hsl, hsla and oklch', () => {
    const found = findViolations([
      {
        path: 'src/a.css',
        source: [
          'a{color:rgb(131 193 192)}',
          'b{color:rgba(0,0,0,.5)}',
          'c{color:hsl(180 30% 64%)}',
          'd{color:hsla(180,30%,64%,.5)}',
          'e{color:oklch(75% 0.06 195)}',
        ].join('\n'),
      },
    ])
    expect(found.map((v) => v.rule)).toEqual(Array(5).fill('colour-function'))
    expect(found.map((v) => v.text)).toEqual([
      'rgb(',
      'rgba(',
      'hsl(',
      'hsla(',
      'oklch(',
    ])
  })

  it('does not flag a var() reference or a transform function', () => {
    const found = findViolations([
      { path: 'src/a.css', source: '.x{color:var(--text-primary);transform:translate(1px,2px)}' },
    ])
    expect(found).toEqual([])
  })

  it('flags colour functions regardless of case', () => {
    const found = findViolations([
      { path: 'src/a.css', source: '.x{color:RGB(131 193 192)} .y{color:RGBA(0,0,0,.5)}' },
    ])
    expect(found.map((v) => v.text)).toEqual(['RGB(', 'RGBA('])
  })
})

describe('findViolations — named typefaces', () => {
  it('flags a font-family that names a face', () => {
    const found = findViolations([
      { path: 'src/a.css', source: ".t{font-family:'Archivo',sans-serif}" },
    ])
    expect(found).toEqual([
      {
        path: 'src/a.css',
        line: 1,
        rule: 'named-face',
        text: "font-family:'Archivo',sans-serif",
      },
    ])
  })

  it('flags a bare generic family, which is still naming a face', () => {
    const found = findViolations([
      { path: 'src/a.css', source: '.t { font-family: sans-serif; }' },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].rule).toBe('named-face')
  })

  it('allows a lone var() reference, which is how a component applies a face', () => {
    const found = findViolations([
      { path: 'src/a.css', source: '.t { font-family: var(--face-ui); }' },
    ])
    expect(found).toEqual([])
  })

  it('flags a capitalised Font-Family naming a face', () => {
    const found = findViolations([
      { path: 'src/a.css', source: '.t { Font-Family: Georgia; }' },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].rule).toBe('named-face')
  })

  it('allows a capitalised VAR() reference as a lone value', () => {
    const found = findViolations([
      { path: 'src/a.css', source: '.t { font-family: VAR(--face-ui); }' },
    ])
    expect(found).toEqual([])
  })

  it('flags a var() reference with a literal fallback appended', () => {
    const found = findViolations([
      { path: 'src/a.css', source: '.t { font-family: var(--face-ui), Helvetica; }' },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].rule).toBe('named-face')
  })

  it('ignores the font shorthand and font-feature properties', () => {
    // `font-family` is the property under rule. Matching a bare `font:` would
    // catch font-size, font-weight and font-variant-numeric, all of which
    // components set freely.
    const found = findViolations([
      {
        path: 'src/a.css',
        source: '.t{font-size:1rem;font-weight:700;font-variant-numeric:tabular-nums}',
      },
    ])
    expect(found).toEqual([])
  })
})

describe('findViolations — sorting', () => {
  it('returns same-line violations in rule execution order, so two failure runs are diffable', () => {
    const found = findViolations([
      {
        path: 'src/a.css',
        source: ".t { font-family: Helvetica; color: #fff; }",
      },
    ])
    expect(found).toHaveLength(2)
    // Both on same path and line, but come back in rule execution order:
    // hex-colour loop runs first, then colour-function, then named-face.
    expect(found[0].rule).toBe('hex-colour')
    expect(found[1].rule).toBe('named-face')
  })
})

describe('formatViolations', () => {
  it('names every file, line and rule, so a failure is actionable without a debugger', () => {
    const message = formatViolations([
      { path: 'src/a.css', line: 4, rule: 'hex-colour', text: '#fff' },
      { path: 'src/b.tsx', line: 9, rule: 'named-face', text: 'font-family: Helvetica' },
    ])
    expect(message).toContain('src/a.css:4')
    expect(message).toContain('#fff')
    expect(message).toContain('src/b.tsx:9')
    expect(message).toContain('src/styles/tokens.css')
  })

  it('returns an empty string for no violations', () => {
    expect(formatViolations([])).toBe('')
  })
})
