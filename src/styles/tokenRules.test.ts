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

  it('flags the font shorthand, which cannot be written without naming a family', () => {
    const found = findViolations([
      { path: 'src/a.css', source: '.t { font: 700 1rem Helvetica; }' },
    ])
    expect(found).toEqual([
      {
        path: 'src/a.css',
        line: 1,
        rule: 'font-shorthand',
        text: 'font: 700 1rem Helvetica',
      },
    ])
  })

  it('leaves font-size, font-weight and font-variant-numeric alone', () => {
    // The shorthand rule is anchored on a colon immediately after `font`, and a
    // hyphen is not a colon, so none of the longhand properties can match it.
    // The comment this replaces claimed the opposite, which is why this test
    // now carries a fixture for the shorthand as well as for the longhands: the
    // old one asserted the shorthand was ignored without containing one.
    const found = findViolations([
      {
        path: 'src/a.css',
        source: '.t{font-size:1rem;font-weight:700;font-variant-numeric:tabular-nums}',
      },
    ])
    expect(found).toEqual([])
  })
})

describe('findViolations — named colours', () => {
  it('flags a colour written as its keyword', () => {
    const found = findViolations([
      { path: 'src/a.css', source: '.x { color: white; }' },
    ])
    expect(found).toEqual([
      {
        path: 'src/a.css',
        line: 1,
        rule: 'named-colour',
        text: 'color: white',
      },
    ])
  })

  it('flags a keyword on the shorthand properties and in either case', () => {
    const found = findViolations([
      {
        path: 'src/a.css',
        source: [
          '.a{background:Teal}',
          '.b{border:1px solid red}',
          '.c{BACKGROUND-COLOR:GREY}',
          '.d{outline:2px dotted rebeccapurple}',
        ].join('\n'),
      },
    ])
    expect(found.map((v) => v.rule)).toEqual(Array(4).fill('named-colour'))
    expect(found.map((v) => v.line)).toEqual([1, 2, 3, 4])
  })

  it('does not flag the keywords that name no colour', () => {
    const found = findViolations([
      {
        path: 'src/a.css',
        source: [
          '.a{background:transparent}',
          '.b{color:inherit}',
          '.c{fill:currentColor}',
          '.d{background:var(--surface-page)}',
          '.e{border:1px solid var(--rule-hairline)}',
        ].join('\n'),
      },
    ])
    expect(found).toEqual([])
  })

  // The rule is anchored to a colour property on purpose. Comments all over
  // this repository discuss the palette in words — the band contrast notes name
  // teal and red in a sentence — and a rule matching those words anywhere would
  // fail on the documentation instead of on a defect.
  it('does not flag colour words in prose', () => {
    const found = findViolations([
      {
        path: 'src/board/Board.tsx',
        source: '// teal against warm red measures 1.76:1, so the label is not\n// decoration: it is the only signal that survives greyscale.\n',
      },
    ])
    expect(found).toEqual([])
  })
})

describe('findViolations — JSX inline styles', () => {
  it('flags a face named in a camelCase inline style', () => {
    const found = findViolations([
      { path: 'src/a.tsx', source: "<p style={{ fontFamily: 'Helvetica' }} />" },
    ])
    expect(found).toEqual([
      {
        path: 'src/a.tsx',
        line: 1,
        rule: 'named-face',
        text: "fontFamily: 'Helvetica'",
      },
    ])
  })

  it('allows a quoted lone var() reference in an inline style', () => {
    const found = findViolations([
      { path: 'src/a.tsx', source: "<p style={{ fontFamily: 'var(--face-body)' }} />" },
    ])
    expect(found).toEqual([])
  })

  // The reported text runs to the end of the object rather than to the end of
  // the offending entry, and that is a deliberate trade. A comma cannot end the
  // value the colour rule searches, because a comma is legal INSIDE a CSS colour
  // value — a gradient's stops are comma-separated — and stopping there would
  // let a keyword hide behind the first comma of a shorthand. The finding is
  // still locatable: it carries the file, the line and the property.
  it('flags a colour named in an inline style', () => {
    const found = findViolations([
      {
        path: 'src/a.tsx',
        source: "<p style={{ color: 'red', fontFamily: 'var(--face-body)' }} />",
      },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].rule).toBe('named-colour')
    expect(found[0].text).toContain("color: 'red'")
  })

  it('flags a colour named after another entry in the same object', () => {
    const found = findViolations([
      {
        path: 'src/a.tsx',
        source: "<p style={{ fontFamily: 'var(--face-body)', backgroundColor: 'teal' }} />",
      },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].rule).toBe('named-colour')
    expect(found[0].text).toContain("backgroundColor: 'teal'")
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
    // hex-colour, colour-function, named-colour, font-shorthand, named-face.
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
