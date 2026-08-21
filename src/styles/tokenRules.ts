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

export type RuleName = 'hex-colour' | 'colour-function' | 'named-face'

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

// Longest alternative first: with `{3}` before `{6}`, #1F1F1F would match as
// #1F1 and the trailing F1F would be reported as a separate near-miss.
const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g

// Deliberately wider than spec §4.2's letter, which names only hex. A rule that
// stops at hex is bypassed by rgb(131 193 192), which is the identical defect.
// `transform: translate(…)` and friends are untouched because only colour
// notations are listed.
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/g

// The value of a font-family declaration, up to the end of the declaration.
const FONT_FAMILY = /font-family\s*:\s*([^;}\n]+)/g

// The one shape a component may use: a single var() reference and nothing else.
// A component must be able to APPLY a face; it must never NAME one. Spec §4.2
// is explicit that banning the property outright would make the display face
// unreachable and the rule would be deleted within a day.
const LONE_VAR_REFERENCE = /^var\(\s*--[a-zA-Z0-9-]+\s*\)$/

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

    for (const match of file.source.matchAll(FONT_FAMILY)) {
      if (LONE_VAR_REFERENCE.test(match[1].trim())) continue
      violations.push({
        path: file.path,
        line: lineOf(file.source, match.index ?? 0),
        rule: 'named-face',
        text: match[0].trim(),
      })
    }
  }

  // Stable order, so a failure message does not reshuffle between runs and make
  // a diff of two failures unreadable.
  return violations.sort(
    (a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.text.localeCompare(b.text),
  )
}

const ADVICE: Record<RuleName, string> = {
  'hex-colour':
    'move the colour into src/styles/tokens.css and reference it as var(--…)',
  'colour-function':
    'move the colour into src/styles/tokens.css and reference it as var(--…)',
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
