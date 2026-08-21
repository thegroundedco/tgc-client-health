// The rebrand answer, made mechanical.
//
// Spec §4.1 promises that changing the visual identity later is a one-file
// change. That promise is only true while every colour and every typeface in
// the repository lives in tokens.css, and intent alone does not keep it true:
// the first time somebody needs a slightly different grey at 6pm, a hex literal
// lands in a component and nobody notices for a month. A failing test notices
// immediately. Spec §4.2: "Intent decays; a failing test does not."
//
// This module is pure — strings in, findings out, no filesystem. The walk lives
// in tests/tokens.test.ts, which needs node:fs and therefore cannot live under
// tsconfig.app.json. Keeping the rules here means they are unit-testable with
// fixtures, and a rule can be proved to fire without creating a real file that
// breaks the build.

export type RuleName =
  | 'hex-colour'
  | 'colour-function'
  | 'named-colour'
  | 'font-shorthand'
  | 'named-face'

export type SourceFile = { path: string; source: string }

export type Violation = {
  path: string
  /** 1-based, so it matches what an editor shows. */
  line: number
  rule: RuleName
  /** The offending text itself. A finding nobody can locate is not a finding. */
  text: string
}

// tokens.css is the point of the exercise. This test file's fixtures contain the
// literals the rules catch, so it must be exempt or it would fail itself.
// Exported, and asserted in the unit tests, so widening this list is a visible
// change in a diff rather than a quiet one.
export const EXEMPT_PATHS: readonly string[] = [
  'src/styles/tokens.css',
  'src/styles/tokenRules.test.ts',
]

// None of the constants below may be illustrated with a real example of the
// syntax they ban: this module is walked by tests/tokens.test.ts along with
// every other file in the repository, and it is not in EXEMPT_PATHS (nor should
// it be — it has no legitimate reason to contain a colour literal or a named
// typeface, and exempting it would silently permit one forever). A comment that
// writes out the banned syntax to explain it is therefore a violation of the
// rule it is documenting, and the walk will fail the build on it. Describe the
// bypass in prose instead of demonstrating it.

// The trailing negative lookahead `(?![0-9a-zA-Z_-])` enforces the correct length
// by forcing the engine to land on a class boundary. The longest-first alternation
// is a harmless micro-optimisation that saves backtracking; the tests would not
// catch a reversal because it would not change the output.
const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g

// Deliberately wider than spec §4.2's letter, which names only hex. A rule that
// stops at hex is trivially evaded by writing the identical colour in functional
// notation instead of hex — the same defect wearing different syntax. (No example
// is written out here; see the note above this block.) `transform: translate(…)`
// and friends are untouched because only colour notations are listed.
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/gi

// CSS named colours. The same defect as a hex literal, spelled as a word: a
// rule that stops at the notations above is evaded by writing the identical
// colour as its keyword instead.
//
// Deliberately partial. There are 148 named colours and almost all of them are
// names nobody reaches for by accident; policing every one buys nothing and
// makes the list a wall of noise that the next person skims past. This is the
// set somebody actually types at 6pm when they want a slightly different
// something — the plain words, the greys, and the few that turn up in design
// tools. Adding a missing one is a one-line change, and the hex rule already
// catches the same colour written the way most people write it.
//
// The keywords that are NOT colours — transparent, currentColor, inherit and
// the CSS-wide values — are absent on purpose: they name no identity, so they
// are legitimate outside tokens.css.
const NAMED_COLOUR_WORDS = [
  'aliceblue', 'aqua', 'aquamarine', 'beige', 'black', 'blue', 'brown',
  'chocolate', 'coral', 'crimson', 'cyan', 'darkblue', 'darkgray', 'darkgreen',
  'darkgrey', 'darkred', 'dimgray', 'dimgrey', 'fuchsia', 'gold', 'gray',
  'green', 'grey', 'hotpink', 'indigo', 'ivory', 'khaki', 'lavender',
  'lightblue', 'lightgray', 'lightgreen', 'lightgrey', 'lime', 'magenta',
  'maroon', 'navy', 'olive', 'orange', 'orchid', 'pink', 'plum', 'purple',
  'rebeccapurple', 'red', 'salmon', 'silver', 'skyblue', 'slategray',
  'slategrey', 'tan', 'teal', 'tomato', 'turquoise', 'violet', 'wheat',
  'white', 'whitesmoke', 'yellow',
] as const

const NAMED_COLOUR = new RegExp(`\\b(?:${NAMED_COLOUR_WORDS.join('|')})\\b`, 'i')

// The properties whose value can be a colour, in both spellings: the hyphenated
// one CSS uses and the camelCase one a JSX inline style uses. Anchoring the
// named-colour rule to a property is what keeps it out of prose — every comment
// in this repository discussing the brand palette says teal and red in a
// sentence, and a rule matching those words anywhere would fail on the
// documentation rather than on a defect.
//
// Sorted longest-first at construction: JavaScript alternation is first-match at
// a position, and the regex advances past the whole declaration, so the long
// forms must be tried before the short ones they end with.
const COLOUR_PROPERTIES = [
  'accent-color', 'accentColor',
  'background-color', 'backgroundColor', 'background',
  'border-bottom-color', 'borderBottomColor',
  'border-left-color', 'borderLeftColor',
  'border-right-color', 'borderRightColor',
  'border-top-color', 'borderTopColor',
  'border-color', 'borderColor',
  'border-bottom', 'borderBottom',
  'border-left', 'borderLeft',
  'border-right', 'borderRight',
  'border-top', 'borderTop',
  'border',
  'box-shadow', 'boxShadow',
  'caret-color', 'caretColor',
  'column-rule-color', 'columnRuleColor', 'column-rule', 'columnRule',
  'outline-color', 'outlineColor', 'outline',
  'text-decoration-color', 'textDecorationColor',
  'text-shadow', 'textShadow',
  'color', 'fill', 'stroke',
] as const

const COLOUR_DECLARATION = new RegExp(
  `(?:^|[^\\w])(?:${[...COLOUR_PROPERTIES]
    .sort((a, b) => b.length - a.length)
    .join('|')})\\s*:\\s*([^;}\\n]*)`,
  'gi',
)

// The one-declaration shorthand that sets every font property at once. It is
// flagged unconditionally, because a family is not optional in it: every legal
// use of it names a face. The comment this replaces claimed a rule anchored
// here would also catch font-size, font-weight and font-variant-numeric — it
// does not, and cannot, because those spell a hyphen where this needs a colon.
const FONT_SHORTHAND = /\bfont\s*:\s*([^;}\n]*)/gi

// The value of a font-family declaration, up to the end of the declaration, in
// both spellings. The camelCase form is how a JSX inline style names a face,
// which the hyphenated form never sees; it stops at a comma as well, because in
// an object literal a comma ends the entry, whereas in CSS a comma separates
// the fallbacks inside one value.
const FONT_FAMILY = /font-family\s*:\s*([^;}\n]+)/gi
const FONT_FAMILY_CAMEL = /\bfontFamily\s*:\s*([^,;}\n]+)/gi

// A JSX inline style quotes its value, so the lone-var check has to see through
// one layer of quoting before it can recognise the shape it permits.
const SURROUNDING_QUOTES = /^['"`]|['"`]$/g

// The one shape a component may use: a single var() reference and nothing else.
// A component must be able to APPLY a face; it must never NAME one. Spec §4.2
// is explicit that banning the property outright would make the display face
// unreachable and the rule would be deleted within a day.
const LONE_VAR_REFERENCE = /^var\(\s*--[a-zA-Z0-9-]+\s*\)$/i

function lineOf(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') line += 1
  }
  return line
}

export function findViolations(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = []

  for (const file of files) {
    if (EXEMPT_PATHS.includes(file.path)) continue

    for (const match of file.source.matchAll(HEX_COLOUR)) {
      violations.push({
        path: file.path,
        line: lineOf(file.source, match.index ?? 0),
        rule: 'hex-colour',
        text: match[0],
      })
    }

    for (const match of file.source.matchAll(COLOUR_FUNCTION)) {
      violations.push({
        path: file.path,
        line: lineOf(file.source, match.index ?? 0),
        rule: 'colour-function',
        text: match[0],
      })
    }

    for (const match of file.source.matchAll(COLOUR_DECLARATION)) {
      if (!NAMED_COLOUR.test(match[1])) continue
      violations.push({
        path: file.path,
        line: lineOf(file.source, match.index ?? 0),
        rule: 'named-colour',
        text: match[0].trim(),
      })
    }

    for (const match of file.source.matchAll(FONT_SHORTHAND)) {
      violations.push({
        path: file.path,
        line: lineOf(file.source, match.index ?? 0),
        rule: 'font-shorthand',
        text: match[0].trim(),
      })
    }

    for (const regex of [FONT_FAMILY, FONT_FAMILY_CAMEL]) {
      for (const match of file.source.matchAll(regex)) {
        const value = match[1].trim().replace(SURROUNDING_QUOTES, '').trim()
        if (LONE_VAR_REFERENCE.test(value)) continue
        violations.push({
          path: file.path,
          line: lineOf(file.source, match.index ?? 0),
          rule: 'named-face',
          text: match[0].trim(),
        })
      }
    }
  }

  // Stable order, so a failure message does not reshuffle between runs and make
  // a diff of two failures unreadable. The sort orders by path then line.
  // Violations sharing both come back in the order the rules ran — hex colours,
  // colour functions, named colours, the font shorthand, then named faces —
  // because the rule loops above are ordered and Array.sort is stable. No
  // tie-break comparator is needed.
  return violations.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
}

const ADVICE: Record<RuleName, string> = {
  'hex-colour':
    'move the colour into src/styles/tokens.css and reference it as var(--…)',
  'colour-function':
    'move the colour into src/styles/tokens.css and reference it as var(--…)',
  'named-colour':
    'move the colour into src/styles/tokens.css and reference it as var(--…)',
  'font-shorthand':
    'use the longhand properties instead; the shorthand always names a family, and the family belongs in src/styles/tokens.css',
  'named-face':
    'set font-family to a single var(--face-…) reference; the family name and its fallbacks belong in src/styles/tokens.css',
}

export function formatViolations(violations: readonly Violation[]): string {
  if (violations.length === 0) return ''

  const lines = violations.map(
    (v) => `  ${v.path}:${v.line}  [${v.rule}]  ${v.text}\n      → ${ADVICE[v.rule]}`,
  )

  return [
    `${violations.length} styling token violation(s).`,
    '',
    'src/styles/tokens.css is the only file allowed to contain a colour literal',
    'or a typeface name. This keeps a later change of visual identity a one-file',
    'change — see docs/superpowers/specs/2026-08-21-phase-1-slice-1-design.md §4.',
    '',
    ...lines,
  ].join('\n')
}
