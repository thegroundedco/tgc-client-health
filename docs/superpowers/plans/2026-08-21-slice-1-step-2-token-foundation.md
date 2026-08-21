# Slice 1 Step 2 — Token Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app its visual identity through a two-layer token system enforced by a test, applied to every screen that already exists, and prove a self-hosted variable font loads from GitHub Pages under `/tgc-client-health/`.

**Architecture:** One file, `src/styles/tokens.css`, is the only place in the repository where a colour literal or a typeface name may appear. It declares three layers — brand (identity), functional (meaning without identity), and semantic (what components actually reference). A second global file, `src/styles/base.css`, holds the reset, element defaults and five app-wide type-role classes. Both are linked from `index.html` rather than imported from `main.tsx`, so the styling survives a JavaScript bundle failure — which is exactly when the startup-error screen needs to be legible. Per-component appearance lives in CSS modules beside each component. A Vitest test walks the repository and fails the build on any hex colour or named typeface outside `tokens.css`.

**Tech Stack:** Vite 8, React 19, TypeScript 6 (`strict`), Vitest 4, plain CSS with CSS modules (no CSS framework, no new dependency), self-hosted Archivo variable WOFF2.

**Spec:** `docs/superpowers/specs/2026-08-21-phase-1-slice-1-design.md` — §4 in particular. Parent spec: `docs/superpowers/specs/2026-08-20-tgc-client-health-design.md` §9.

---

## Global Constraints

Copied verbatim from the specs. Every task's requirements implicitly include this section.

- **Components reference the semantic layer exclusively.** Spec §4.1. A component must never name `--brand-teal`; it names `--band-healthy`.
- **Every health band carries a text label.** Parent §9.3, restated as load-bearing in §4.1, because teal against warm red measures 1.76:1. Colour is never the only signal.
- **Light theme only.** Spec §4.5. No `prefers-color-scheme` block, no `data-theme` attribute. A decision, not an oversight.
- **Every score renders with `font-variant-numeric: tabular-nums`.** Spec §4.4.
- **An incomplete check-in shows an em dash, never a number.** Parent §6.2. Incomplete must never read as "at risk".
- **No new dependencies.** Spec §4.5: "plain CSS, no dependency".
- **Nothing new is built in this step.** Spec §3 step 2: sign-in, access-pending, the four error states and the current board get styled. `Score all 3s` stays until step 4 deletes it. No check-in screen, no navigation, no per-pillar bars.
- **Type roles** (spec §4.4): display width 125 / weight 800; section headers width ~70 / weight 700 uppercase; eyebrows width ~118 / weight 300 with wide letter-spacing; body normal width; captions width ~62 / weight 700.
- **Base path is `/tgc-client-health/`** (`vite.config.ts`). No absolute asset URL may be hand-written anywhere.
- **`npm test` does not typecheck.** Run `npm run build` separately before believing anything is green.
- **Tests in `src/` cannot use Node APIs.** `tsconfig.app.json` sets `"types": ["vite/client"]` and `"lib": ["ES2023", "DOM"]` — no `@types/node`. Anything touching the filesystem lives in `tests/` under `tsconfig.node.json`.

---

## Measured contrast, and the three findings that shaped the palette

Computed with the WCAG 2.x relative-luminance formula on 2026-08-21. These are measurements, not estimates, and they are what parent §9.2 asks for.

| Pair | Ratio | Verdict |
|---|---|---|
| ink `#1F1F1F` on paper `#FBF7EB` | 15.39:1 | body text, passes AAA |
| muted ink `#6B6459` on paper | 5.46:1 | captions and secondary text, passes AA |
| ink on teal `#83C1C0` | 8.13:1 | healthy chip label, passes AAA |
| ink on amber `#E8A33D` | 7.64:1 | watch chip label, passes AAA |
| ink on brand red `#F9423A` | 4.61:1 | at-risk chip label, passes AA |
| dark red `#B82B25` on paper | 5.75:1 | error text, passes AA |
| raised paper `#FFFDF6` on ink `#1F1F1F` | 16.19:1 | button label on a filled button, passes AAA |
| hairline `#CFC8B6` on paper | 1.56:1 | decorative rule, no minimum applies |
| raised surface `#FFFDF6` on paper | 1.05:1 | **too close to define an edge on its own** |

**Finding 1 — no band colour can be text.** Teal on paper is 1.89:1, amber 2.01:1, brand red 3.34:1. All three fail as text against the brand ground. Therefore **a band is a filled chip with ink text**, never coloured type. Every ink-on-band pair above passes AA, so the fill direction works where the text direction cannot.

**Finding 2 — the brand red cannot carry an error message.** `#F9423A` on paper is 3.34:1, below the 4.5:1 minimum for body text. Error text uses `--brand-red-dark` `#B82B25` at 5.75:1; the brand red is reserved for fills, where ink sits on it legibly. This is why the brand layer carries a derived value rather than one red.

**Finding 3 — cards need a border, not a tint.** The raised surface is 1.05:1 against the page. A card defined only by its fill would be invisible; the hairline is the actual boundary. Stated so nobody later "cleans up" the border and silently deletes the card.

Independently re-derived here: teal vs red is 1.76:1, teal vs amber 1.06:1, amber vs red 1.66:1. Any two bands are indistinguishable to a colour-blind viewer and nearly indistinguishable to anyone in greyscale. The mandatory text label is the only thing carrying the meaning.

---

## Three deviations from the spec, with reasons

Recorded here rather than buried in a task, because a reviewer should be able to reject them.

**1. The font lives in `src/assets/fonts/`, not `public/fonts/`.** Spec §4.3 says `public/fonts/`. Files in `public/` are copied verbatim and referenced by a hand-written path, so a typo produces a **runtime 404 and a silent fallback to the system face** — a check that fails silently, which this project has already been burned by twice. Importing the font through CSS `url('../assets/fonts/…')` makes Vite resolve it at build time: a wrong path is a **build error**, the emitted URL carries the `/tgc-client-health/` base automatically, and the file gets a content hash for cache-busting. Every reason §4.3 gives for self-hosting is preserved; only the failure mode improves.

**2. A third token layer, `functional`, sits between brand and semantic.** Spec §4.1's snippet puts the amber literal in the semantic layer with a comment saying it is "deliberately not brand". Giving it its own layer states the same thing in structure rather than in a comment, and yields a crisper invariant: **the semantic layer contains no literals at all, only `var()` references.** That invariant is checkable by eye in one pass.

**3. The token test also rejects `rgb()`, `rgba()`, `hsl()`, `hsla()` and `oklch()`.** Spec §4.2 names hex colours and `font-family`. A rule that stops at hex is bypassed by `color: rgb(131 193 192)`, which is the same defect wearing a different hat. Cost if wrong: a component that legitimately needs a computed colour must add its literal to `tokens.css` first, which is the intended behaviour.

**Known gap, deliberately not closed:** the test does not reject CSS named colours (`color: red`). Detecting them means matching bare words, and the word "red" appears in prose comments throughout this repository, so the rule would produce more false positives than findings. Named colours remain possible; they are also conspicuous in review in a way `rgb(…)` is not.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/styles/tokens.css` | **create.** The only file allowed to contain a colour literal or a typeface name. `@font-face`, brand layer, functional layer, semantic layer, type scale, spacing scale, radii. |
| `src/styles/base.css` | **create.** Reset, element defaults, the five type-role classes, the band chip, the focus ring, the button and field primitives. App-wide vocabulary; no component-specific rules. |
| `src/styles/tokenRules.ts` | **create.** Pure violation finder. No filesystem access, no imports. |
| `src/styles/tokenRules.test.ts` | **create.** Unit tests for the finder, using inline fixture strings. |
| `src/assets/fonts/archivo-latin-wdth-wght.woff2` | **create.** 90,096 bytes, the roman latin subset of Archivo, weight 100–900, width 62–125%. |
| `src/assets/fonts/OFL.txt` | **create.** SIL Open Font License 1.1. Required by the licence when redistributing the font. |
| `tests/tokens.test.ts` | **create.** Walks the real repository and feeds it to the finder. Lives outside `src/` because it needs `node:fs`. |
| `index.html` | **modify.** Link the two global stylesheets so styling survives a bundle failure. |
| `tsconfig.node.json` | **modify.** Add `tests` to `include`. |
| `src/auth/SignIn.module.css` + `SignIn.tsx` | **create / modify.** Sign-in form and the "check your email" confirmation. |
| `src/auth/PendingAccess.module.css` + `PendingAccess.tsx` | **create / modify.** Access-pending screen. |
| `src/App.module.css` + `App.tsx` | **create / modify.** App shell, header, sign-out, the loading and db-error states. |
| `src/lib/startupError.ts` | **modify.** Add class names to the DOM it builds. Its styles live in `base.css`, not a module, because it must work when the bundle is broken. |
| `src/board/Board.module.css` + `Board.tsx` | **create / modify.** Client cards, band chips, the two error states, the empty state. No behaviour change. |

---

### Task 1: The token rule checker

The enforcement comes first. Written before there is anything to enforce, because a rule added after the styling is a rule negotiated against work already done.

**Files:**
- Create: `src/styles/tokenRules.ts`
- Test: `src/styles/tokenRules.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type SourceFile = { path: string; source: string }`
  - `export type Violation = { path: string; line: number; rule: RuleName; text: string }`
  - `export type RuleName = 'hex-colour' | 'colour-function' | 'named-face'`
  - `export const EXEMPT_PATHS: readonly string[]`
  - `export function findViolations(files: readonly SourceFile[]): Violation[]`
  - `export function formatViolations(violations: readonly Violation[]): string`

- [ ] **Step 1: Write the failing test**

Create `src/styles/tokenRules.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/styles/tokenRules.test.ts
```

Expected: FAIL — `Failed to resolve import "./tokenRules"`.

- [ ] **Step 3: Write the implementation**

Create `src/styles/tokenRules.ts`:

```ts
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
        line: lineOf(file.source, match.index),
        rule: 'hex-colour',
        text: match[0],
      })
    }

    for (const match of file.source.matchAll(COLOUR_FUNCTION)) {
      violations.push({
        path: file.path,
        line: lineOf(file.source, match.index),
        rule: 'colour-function',
        text: match[0],
      })
    }

    for (const match of file.source.matchAll(FONT_FAMILY)) {
      if (LONE_VAR_REFERENCE.test(match[1].trim())) continue
      violations.push({
        path: file.path,
        line: lineOf(file.source, match.index),
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/styles/tokenRules.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Verify it typechecks**

```bash
npm run build
```

Expected: exit 0. `match.index` is typed as `number` for `matchAll` results under `lib: ES2023`; if it reports `number | undefined`, the fix is `match.index ?? 0` — do not widen the tsconfig.

- [ ] **Step 6: Commit**

```bash
git add src/styles/tokenRules.ts src/styles/tokenRules.test.ts
git commit -m "test(styling): add the token rule checker before there is anything to enforce"
```

---

### Task 2: Walk the real repository

The checker is worthless until something feeds it every file. This is the task that turns a unit test into a gate.

**Files:**
- Create: `tests/tokens.test.ts`
- Modify: `tsconfig.node.json` (add `tests` to `include`)

**Interfaces:**
- Consumes: `findViolations`, `formatViolations`, `SourceFile` from `src/styles/tokenRules.ts` (Task 1).
- Produces: nothing importable. Produces a gate.

- [ ] **Step 1: Add `tests` to the Node tsconfig**

Tests under `src/` are compiled by `tsconfig.app.json`, which sets `"types": ["vite/client"]` and no `@types/node` — deliberately, so application code cannot reach for `process`. A filesystem walk therefore cannot live in `src/`. Edit `tsconfig.node.json` and change the last line from `"include": ["vite.config.ts"]` to:

```json
  "include": ["vite.config.ts", "tests"]
```

- [ ] **Step 2: Write the failing test**

Create `tests/tokens.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findViolations,
  formatViolations,
  type SourceFile,
} from '../src/styles/tokenRules.ts'

// Lives outside src/ because it needs node:fs, and tsconfig.app.json gives src/
// no Node types on purpose. Vitest's default include pattern picks up
// **/*.test.ts, so this runs under a plain `npm test` and inside the deploy
// workflow's test gate with no configuration change.

const ROOT = join(import.meta.dirname, '..')

// The extensions that can carry a colour or a typeface. Everything else in the
// tree — .json, .sql, .md, .svg, .woff2 — either cannot style the app or is not
// ours to police.
const EXTENSIONS = ['.css', '.ts', '.tsx', '.html']

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'supabase', 'docs'])

function collect(directory: string, found: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      collect(absolute, found)
      continue
    }
    if (!EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue
    found.push({
      // Forward slashes on every platform, so EXEMPT_PATHS can be written once.
      path: relative(ROOT, absolute).split(sep).join('/'),
      source: readFileSync(absolute, 'utf8'),
    })
  }
  return found
}

describe('the repository', () => {
  const files = collect(join(ROOT, 'src')).concat(
    collect(ROOT).filter((file) => file.path === 'index.html'),
  )

  // A walk that silently finds nothing would pass forever. This project has
  // already shipped one check that reported success by finding no data — see the
  // grep-on-a-binary-bundle note in the README. Assert the walk actually walked.
  it('is walked, not silently skipped', () => {
    expect(files.length).toBeGreaterThan(15)
    expect(files.map((f) => f.path)).toContain('index.html')
    expect(files.map((f) => f.path)).toContain('src/styles/tokens.css')
    expect(files.map((f) => f.path)).toContain('src/board/Board.tsx')
  })

  it('keeps every colour and typeface in src/styles/tokens.css', () => {
    const violations = findViolations(files)
    expect(formatViolations(violations)).toBe('')
  })
})
```

- [ ] **Step 3: Run it to verify it fails, and fails for the right reason**

```bash
npx vitest run tests/tokens.test.ts
```

Expected: the first test FAILS on `toContain('src/styles/tokens.css')` — that file does not exist yet. The second test should PASS, because the current codebase has no CSS at all. **Both outcomes matter.** A green second test here is what proves the gate starts from a clean baseline, so any violation it reports later was introduced by this plan and not inherited.

- [ ] **Step 4: Commit the failing gate**

Committing red is deliberate and it is the only red commit in this plan. The next task creates `tokens.css`; committing the assertion first means the walk cannot be quietly narrowed to whatever happens to exist.

```bash
git add tests/tokens.test.ts tsconfig.node.json
git commit -m "test(styling): walk the repository through the token checker

The first assertion fails until tokens.css exists in the next commit. It is
committed red on purpose: a walk that finds nothing passes forever, and this
project has already been misled once by a check that reported success by
finding no data."
```

---

### Task 3: The tokens, the font, and the global base

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/base.css`, `src/assets/fonts/archivo-latin-wdth-wght.woff2`, `src/assets/fonts/OFL.txt`
- Modify: `index.html`

**Interfaces:**
- Consumes: nothing.
- Produces, for every later task and every later slice:
  - Semantic colour tokens: `--surface-page`, `--surface-raised`, `--surface-sunken`, `--rule-hairline`, `--text-primary`, `--text-secondary`, `--text-on-band`, `--band-healthy`, `--band-watch`, `--band-risk`, `--band-none`, `--action-face`, `--action-text`, `--action-quiet`, `--focus-ring`, `--alert-text`, `--accent-quiet`
  - Type tokens: `--face-ui`, `--wdth-display`, `--wdth-header`, `--wdth-eyebrow`, `--wdth-body`, `--wdth-caption`, `--wght-display`, `--wght-header`, `--wght-eyebrow`, `--wght-body`, `--wght-caption`
  - Scale tokens: `--step--1` … `--step-4`, `--space-1` … `--space-7`, `--radius-sm`, `--radius-md`, `--radius-pill`, `--measure-prose`
  - Global classes from `base.css`: `.t-display`, `.t-header`, `.t-eyebrow`, `.t-body`, `.t-caption`, `.numeric`, `.band`, `.band--healthy`, `.band--watch`, `.band--risk`, `.band--none`, `.button`, `.button--quiet`, `.field`, `.alert`, `.prose`

- [ ] **Step 1: Fetch the font and its licence**

The subset is the roman latin one from Google's own `css2` response for `Archivo:ital,wdth,wght@0,62..125,100..900`. Google serves it declaring `font-weight: 100 900; font-stretch: 62% 125%`, which is the source of truth for the axes the file carries.

```bash
mkdir -p src/assets/fonts
curl -sS -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36" \
  "https://fonts.gstatic.com/s/archivo/v25/k3kQo8UDI-1M0wlSfdnoLmvDIaI.woff2" \
  -o src/assets/fonts/archivo-latin-wdth-wght.woff2
curl -sSL "https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/OFL.txt" \
  -o src/assets/fonts/OFL.txt
```

Verify — do not skip, a silent 0-byte download is exactly the failure this project keeps meeting:

```bash
shasum -a 256 src/assets/fonts/archivo-latin-wdth-wght.woff2
head -c4 src/assets/fonts/archivo-latin-wdth-wght.woff2 | xxd -p
wc -c src/assets/fonts/*.woff2 src/assets/fonts/OFL.txt
```

Expected, measured 2026-08-21:
- sha256 `4c98b9d490d1698ec95f2ff17a6c7d0e72691864c0c5d7bc2a2c161b45afe5ad`
- magic `774f4632` — that is ASCII `wOF2`, the WOFF2 signature. Anything else means an HTML error page was saved.
- 90096 bytes for the font, 4388 for the licence.

If the sha differs but the magic is `774f4632` and the size is within a few hundred bytes, Google has published a new Archivo revision — record the new sha in this plan and continue. If the magic is wrong, the download failed; do not proceed.

**Only the latin subset ships, not latin-ext.** Latin-ext costs a further 85,856 bytes — doubling the font payload — to cover accented characters that no name on the roster needs. If a client name later needs one, that glyph falls back to the system face, which is visible but not broken, and adding the second `@font-face` with its `unicode-range` is a four-line change.

- [ ] **Step 2: Write `src/styles/tokens.css`**

```css
/* ============================================================================
   The only file in this repository allowed to contain a colour literal or a
   typeface name. Enforced by tests/tokens.test.ts, not by good intentions.

   Three layers, and the order matters:

     BRAND       identity. A change of visual identity rewrites this block.
     FUNCTIONAL  meaning with no identity. Survives a rebrand untouched.
     SEMANTIC    what components reference. Contains NO literals — only var().

   The reason there are layers at all is a question the owner asked directly:
   how hard is a rebrand later? With one layer, --band-healthy IS teal, and a
   rebrand that drops teal silently breaks the health encoding. With these
   three, a rebrand rewrites the top block and the status system survives.

   Contrast measured 2026-08-21 with the WCAG 2.x relative-luminance formula.
   Every ratio below is a measurement. See the plan for the full table.
   ============================================================================ */

/* Archivo stands in for Field Gothic until the licence is settled. One variable
   file spanning width 62–125 and weight 100–900, so all five type roles come
   from a single 88 KB download. Field Gothic is a separate cut per width, so
   that swap is 5–7 files and a bigger payload — see spec §4.1.

   The url() is a build-time reference, not a runtime path: Vite resolves it,
   hashes the file, and prefixes the /tgc-client-health/ base itself. A typo
   here fails the build instead of 404ing in a browser and falling back to the
   system face without a word. */
@font-face {
  font-family: 'Archivo Variable';
  src: url('../assets/fonts/archivo-latin-wdth-wght.woff2') format('woff2');
  font-weight: 100 900;
  font-stretch: 62% 125%;
  font-style: normal;
  /* swap, not block: the first paint shows fallback type rather than nothing.
     A tool whose premise is boring reliability must never show a blank page
     while a font downloads. */
  font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
    U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
    U+2212, U+2215, U+FEFF, U+FFFD;
}

:root {
  /* ==========================================================================
     BRAND — identity, from Grounded_Styleguide_Final.ai
     ========================================================================== */
  --brand-ink: #1F1F1F;
  --brand-paper: #FBF7EB;
  --brand-teal: #83C1C0;
  --brand-blush: #FFB3AB;
  --brand-red: #F9423A;

  /* Derived from the five above: same identity, adjusted for legibility. A
     rebrand replaces these too.
     --brand-red-dark exists because the brand red measures 3.34:1 on the brand
     paper, below the 4.5:1 needed for text. An error message set in #F9423A
     would be brand-correct and unreadable. #B82B25 measures 5.75:1. */
  --brand-paper-raised: #FFFDF6;
  --brand-paper-sunken: #F2ECDA;
  --brand-rule: #CFC8B6;
  --brand-ink-muted: #6B6459;
  --brand-red-dark: #B82B25;

  /* ==========================================================================
     FUNCTIONAL — meaning without identity. Not brand, and must not move with
     one. The health scale needs three separable steps; the brand palette has
     no middle one, so amber is borrowed from outside it and stays outside it.
     ========================================================================== */
  --functional-amber: #E8A33D;

  /* ==========================================================================
     SEMANTIC — the only layer components may reference. No literals here.
     ========================================================================== */

  /* surfaces. --surface-raised measures 1.05:1 against the page, so it cannot
     define a card edge on its own: the hairline is the actual boundary. Do not
     "tidy up" a card border and expect the fill to hold the shape. */
  --surface-page: var(--brand-paper);
  --surface-raised: var(--brand-paper-raised);
  --surface-sunken: var(--brand-paper-sunken);
  --rule-hairline: var(--brand-rule);

  /* text. 15.39:1 and 5.46:1 on the page. */
  --text-primary: var(--brand-ink);
  --text-secondary: var(--brand-ink-muted);

  /* health bands. Fills, never text: teal on paper is 1.89:1, amber 2.01:1,
     brand red 3.34:1 — all three fail as type on this ground. Ink on each of
     them passes: 8.13:1, 7.64:1, 4.61:1. So a band is a filled chip with an
     ink label.
     Any two bands are also indistinguishable from one another — teal vs red
     1.76:1, teal vs amber 1.06:1, amber vs red 1.66:1 — which is why parent
     spec §9.3's rule that every band carries a TEXT label is load-bearing and
     not a nicety. */
  --band-healthy: var(--brand-teal);
  --band-watch: var(--functional-amber);
  --band-risk: var(--brand-red);
  --band-none: var(--brand-rule);
  --text-on-band: var(--brand-ink);

  /* interaction */
  --action-face: var(--brand-ink);
  --action-text: var(--brand-paper-raised);
  --action-quiet: var(--brand-rule);
  --focus-ring: var(--brand-ink);

  /* An error message on the page ground: 5.75:1. There is deliberately no
     filled-alert token — nothing in the app fills a surface with red, and an
     unused token is a colour waiting to be used without its contrast measured. */
  --alert-text: var(--brand-red-dark);

  /* The one purely decorative brand colour. Never carries meaning, so nothing
     is lost if a rebrand drops it. Unused today, and present anyway: tokens.css
     IS the palette, and the alternative to an unused token here is somebody
     typing #FFB3AB into a component the first time they want blush. */
  --accent-quiet: var(--brand-blush);

  /* ==========================================================================
     TYPE — one family, five roles, distinguished by width and weight.
     Mirrors parent spec §9.4's mapping of Field Gothic, per spec §4.4.
     ========================================================================== */
  --face-ui: 'Archivo Variable', system-ui, -apple-system, 'Segoe UI', sans-serif;

  --wdth-display: 125%;
  --wdth-header: 70%;
  --wdth-eyebrow: 118%;
  --wdth-body: 100%;
  --wdth-caption: 62%;

  --wght-display: 800;
  --wght-header: 700;
  --wght-eyebrow: 300;
  --wght-body: 400;
  --wght-caption: 700;

  /* 1.25 ratio from a 16px base. */
  --step--1: 0.8125rem;
  --step-0: 1rem;
  --step-1: 1.25rem;
  --step-2: 1.5625rem;
  --step-3: 1.9531rem;
  --step-4: 2.4414rem;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-7: 3rem;

  --radius-sm: 3px;
  --radius-md: 6px;
  --radius-pill: 999px;

  /* Running text stays near 65 characters. */
  --measure-prose: 62ch;
}
```

- [ ] **Step 3: Write `src/styles/base.css`**

```css
/* Reset, element defaults, and the app-wide vocabulary: the five type roles,
   the band chip, and the button and field primitives.
   Anything used by more than one screen belongs here; anything used by exactly
   one belongs in that component's .module.css.

   Linked from index.html rather than imported from main.tsx, on purpose. If the
   JavaScript bundle fails to load, index.html's boot fallback and — when
   main.tsx runs but App.tsx throws — the startup-error screen are all the user
   has. Those are the moments styling matters most, so the styling must not
   arrive through the thing that broke. */

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  /* Anchors and skip links land clear of any sticky header. */
  scroll-padding-top: var(--space-6);
}

body {
  margin: 0;
  background: var(--surface-page);
  color: var(--text-primary);
  font-family: var(--face-ui);
  font-size: var(--step-0);
  font-stretch: var(--wdth-body);
  font-weight: var(--wght-body);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

/* Layout does the spacing: sibling gaps come from a flex container, never from
   per-element margins that collapse or double unpredictably. */
h1,
h2,
h3,
p,
ul,
ol,
figure {
  margin: 0;
}

ul,
ol {
  padding: 0;
  list-style: none;
}

a {
  color: inherit;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.15em;
}

/* One focus treatment for everything, defined once. :focus-visible rather than
   :focus so a mouse click does not draw a ring, but a Tab always does. */
:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* ---------------------------------------------------------------------------
   Type roles. Global classes rather than per-module rules: these are app-wide
   vocabulary, and five copies of the same three declarations in five modules is
   how a scale drifts.
   --------------------------------------------------------------------------- */

.t-display {
  font-stretch: var(--wdth-display);
  font-weight: var(--wght-display);
  font-size: var(--step-4);
  line-height: 1.05;
  letter-spacing: -0.015em;
  text-wrap: balance;
}

.t-header {
  font-stretch: var(--wdth-header);
  font-weight: var(--wght-header);
  font-size: var(--step-2);
  line-height: 1.15;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  text-wrap: balance;
}

.t-eyebrow {
  font-stretch: var(--wdth-eyebrow);
  font-weight: var(--wght-eyebrow);
  font-size: var(--step--1);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--text-secondary);
}

.t-body {
  font-stretch: var(--wdth-body);
  font-weight: var(--wght-body);
  font-size: var(--step-0);
}

.t-caption {
  font-stretch: var(--wdth-caption);
  font-weight: var(--wght-caption);
  font-size: var(--step--1);
  letter-spacing: 0.01em;
  color: var(--text-secondary);
}

/* Every score, everywhere. Spec §4.4. Without this, a column of totals wobbles
   because the digits have different widths. */
.numeric {
  font-variant-numeric: tabular-nums;
}

/* ---------------------------------------------------------------------------
   The health band chip. A FILL with an ink label, because no band colour is
   legible as text on the page ground. The label is not decoration: it is the
   only channel that survives colour blindness or a greyscale print.
   --------------------------------------------------------------------------- */

.band {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--band-none);
  color: var(--text-on-band);
  font-stretch: var(--wdth-caption);
  font-weight: var(--wght-caption);
  font-size: var(--step--1);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.band--healthy {
  background: var(--band-healthy);
}

.band--watch {
  background: var(--band-watch);
}

.band--risk {
  background: var(--band-risk);
}

.band--none {
  background: var(--band-none);
}

/* ---------------------------------------------------------------------------
   Primitives
   --------------------------------------------------------------------------- */

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  border: 1px solid var(--action-face);
  border-radius: var(--radius-md);
  background: var(--action-face);
  color: var(--action-text);
  font-family: var(--face-ui);
  font-stretch: var(--wdth-header);
  font-weight: var(--wght-header);
  font-size: var(--step--1);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
}

.button:hover:not(:disabled) {
  background: var(--surface-page);
  color: var(--text-primary);
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.button--quiet {
  background: transparent;
  border-color: var(--action-quiet);
  color: var(--text-primary);
}

.button--quiet:hover:not(:disabled) {
  background: var(--surface-sunken);
  color: var(--text-primary);
}

.field {
  display: block;
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--rule-hairline);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-family: var(--face-ui);
  font-stretch: var(--wdth-body);
  font-size: var(--step-0);
}

.field:hover {
  border-color: var(--text-secondary);
}

/* An error message, on the page ground. --alert-text is a darkened brand red
   because the brand red itself is 3.34:1 here and would fail as type. */
.alert {
  color: var(--alert-text);
  font-stretch: var(--wdth-body);
  font-weight: var(--wght-header);
}

.prose {
  max-width: var(--measure-prose);
}
```

- [ ] **Step 4: Link both stylesheets from `index.html`**

Insert directly after the `<title>` line:

```html
    <!-- Linked here rather than imported from src/main.tsx, deliberately. The
         boot fallback below and the startup-error screen both exist for the
         case where the JavaScript failed; styling that arrives through the
         bundle would be missing at exactly the moment those screens are all the
         user has. Vite processes these hrefs at build time, hashes the output
         and rewrites them under the /tgc-client-health/ base. -->
    <link rel="stylesheet" href="/src/styles/tokens.css" />
    <link rel="stylesheet" href="/src/styles/base.css" />
```

Then give the two boot paragraphs the vocabulary they now have available — the first is normal prose, the second is a diagnosis:

```html
      <p class="t-body prose">Starting TGC Client Health…</p>
```

```html
      <p id="boot-slow" class="t-body prose alert" hidden>
```

Leave every existing comment in `index.html` intact; they explain a real failure mode.

- [ ] **Step 5: Run the token test — the gate that was committed red**

```bash
npx vitest run tests/tokens.test.ts
```

Expected: both tests PASS. `tokens.css` now exists so the walk assertion is satisfied, and every literal introduced in this task is inside the one exempt file.

If the second test fails, read the message: it names the file, the line and the offending text. A literal in `base.css` is a mistake in this task, not a reason to widen `EXEMPT_PATHS`.

- [ ] **Step 6: Prove the font actually ships, and under the right path**

This is the question spec §4.3 exists to settle, and a build that succeeds does not answer it.

```bash
npm run build
ls -la dist/assets/*.woff2
grep -o 'url([^)]*woff2[^)]*)' dist/assets/*.css
grep -o '/tgc-client-health/assets/[^"]*\.css' dist/index.html
```

Expected, all four:
- `npm run build` exits 0 (this runs `tsc -b` too, so it is the typecheck).
- Exactly one `.woff2` in `dist/assets/`, about 90 KB, with a content hash in its name. **If there is no woff2 in `dist/`, stop.** It means Vite did not resolve the `url()`, the deployed page will silently fall back to the system face, and nothing else in this task can be trusted.
- The emitted `url(…)` begins `/tgc-client-health/assets/` — the base is applied. A bare `/assets/` here means a 404 on Pages.
- `dist/index.html` links the hashed stylesheets under `/tgc-client-health/assets/`.

- [ ] **Step 7: Look at it**

```bash
npm run dev
```

Open `http://localhost:5173/tgc-client-health/`. The sign-in screen is still unstyled at the component level — that is Task 4 — but the page must already be cream, the text near-black, and the type unmistakably Archivo rather than the system sans. In the browser's Network tab, filter to Font: exactly one request, status 200.

**Would a person know this worked?** Yes, and specifically: the ground changed colour and the letterforms changed shape. If the page is still white with system type, the stylesheets are not linked — go back to Step 4 rather than continuing.

- [ ] **Step 8: Commit**

```bash
git add src/styles/tokens.css src/styles/base.css src/assets/fonts index.html
git commit -m "feat(styling): three-layer tokens and a self-hosted variable Archivo

Every colour and typeface in the repository now lives in one file, which is what
makes a later change of identity a one-file change rather than a search. The
contrast numbers in the comments are measurements, and two of them changed the
design: no band colour is legible as text on the brand paper, so a band is a
filled chip with an ink label; and the brand red fails as type on the brand
paper, so error text uses a darkened red.

The font is imported through CSS rather than dropped in public/, so a wrong
path fails the build instead of 404ing and silently falling back to the system
face. Both stylesheets are linked from index.html rather than imported from
main.tsx, so the boot fallback and the startup-error screen — the screens that
exist for when the bundle is broken — are not styled by the bundle."
```

---

### Task 4: Sign-in and access-pending

The app's front door, and the screen a new colleague sees first. Two components, one commit: they share a centred single-column shape and reviewing them apart would mean reviewing the same layout twice.

**Files:**
- Create: `src/auth/SignIn.module.css`, `src/auth/PendingAccess.module.css`
- Modify: `src/auth/SignIn.tsx`, `src/auth/PendingAccess.tsx`

**Interfaces:**
- Consumes: the tokens and global classes from Task 3.
- Produces: nothing importable. Both components keep their current props and behaviour exactly — `SignIn` takes none, `PendingAccess` takes `{ email: string; onSignOut: () => void }`.

- [ ] **Step 1: Write `src/auth/SignIn.module.css`**

```css
/* The front door. A narrow centred column, because the screen has exactly one
   job and nothing to put beside the form. */

.screen {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100vh;
  max-width: 27rem;
  margin: 0 auto;
  padding: var(--space-6) var(--space-5);
  gap: var(--space-6);
}

.masthead {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.label {
  font-stretch: var(--wdth-caption);
  font-weight: var(--wght-caption);
  font-size: var(--step--1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

/* The confirmation after a link is sent. A left rule rather than a filled
   panel: it reads as a continuation of the same page, not a new screen. */
.sent {
  padding-left: var(--space-4);
  border-left: 3px solid var(--band-healthy);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
```

- [ ] **Step 2: Apply it in `src/auth/SignIn.tsx`**

Add the import at the top, after the existing imports:

```tsx
import styles from './SignIn.module.css'
```

Replace the `state === 'sent'` early return with:

```tsx
  if (state === 'sent') {
    return (
      <main className={styles.screen}>
        <div className={styles.sent}>
          <h1 className="t-header">Check your email</h1>
          <p className="t-body prose">
            We sent a sign-in link to {email}. Open it on this device.
          </p>
        </div>
      </main>
    )
  }
```

Replace the main return with:

```tsx
  return (
    <main className={styles.screen}>
      <div className={styles.masthead}>
        <p className="t-eyebrow">The Grounded Company</p>
        <h1 className="t-display">Client Health</h1>
      </div>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.label} htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          className="field"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button className="button" type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
        </button>
      </form>
      {state === 'error' && (
        <p className="alert prose" role="alert">
          Could not send the link: {message}
        </p>
      )}
    </main>
  )
```

Nothing above changes behaviour: same state machine, same `role="alert"`, same `disabled` condition, same submit handler.

- [ ] **Step 3: Write `src/auth/PendingAccess.module.css`**

```css
/* Not an error, and it must not look like one. Someone signed in correctly and
   is waiting on a human. So: the same calm column as the sign-in screen, an
   explanation in prose, and a quiet way out. */

.screen {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 100vh;
  max-width: 30rem;
  margin: 0 auto;
  padding: var(--space-6) var(--space-5);
  gap: var(--space-5);
}

.actions {
  display: flex;
  gap: var(--space-3);
}
```

- [ ] **Step 4: Apply it in `src/auth/PendingAccess.tsx`**

Replace the whole component body, keeping the `Props` type above it untouched:

```tsx
export function PendingAccess({ email, onSignOut }: Props) {
  return (
    <main className={styles.screen}>
      <div>
        <p className="t-eyebrow">Client Health</p>
        <h1 className="t-header">Access pending</h1>
      </div>
      <p className="t-body prose">
        You are signed in as {email}, but your account has not been activated yet.
        An administrator needs to grant you access.
      </p>
      <div className={styles.actions}>
        <button className="button button--quiet" type="button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </main>
  )
}
```

And add the import at the top of the file:

```tsx
import styles from './PendingAccess.module.css'
```

- [ ] **Step 5: Run the tests and the typecheck**

```bash
npm test -- --exclude '**/rls.test.ts'
npm run build
```

Expected: all suites pass, including `tests/tokens.test.ts`, and the build exits 0. `npm test` alone also runs `rls.test.ts` against staging, which is fine but slower and needs `.env.local`.

- [ ] **Step 6: Look at both screens**

```bash
npm run dev
```

At `http://localhost:5173/tgc-client-health/`, signed out, check:
- The masthead eyebrow is condensed-wide and letterspaced; "Client Health" is the wide heavy display cut. If both look identical, the width axis is not being applied and the `@font-face` `font-stretch` range is wrong.
- Tab through the form: the field and the button each take a visible dark ring.
- Submit an empty form — the browser's own validation blocks it, unchanged.
- To see the pending screen without deactivating your account, temporarily return `<PendingAccess email="you@example.com" onSignOut={() => {}} />` from `App.tsx`'s `active` case, look, then revert. Do not commit that.

**Would a person know this worked?** The two screens now look like one product rather than two default forms, and every interactive element shows where the keyboard is.

- [ ] **Step 7: Commit**

```bash
git add src/auth/SignIn.tsx src/auth/SignIn.module.css src/auth/PendingAccess.tsx src/auth/PendingAccess.module.css
git commit -m "feat(styling): dress the sign-in and access-pending screens

Access-pending deliberately does not look like an error. Nothing went wrong:
someone signed in correctly and is waiting on a human, so it gets the same calm
column as the front door rather than an alert colour."
```

---

### Task 5: The app shell and the two failure surfaces

The `db-error` state and the startup-error screen are the screens most likely to be read by someone who cannot fix them, which makes them the ones most worth making legible.

**Files:**
- Create: `src/App.module.css`
- Modify: `src/App.tsx`, `src/lib/startupError.ts`

**Interfaces:**
- Consumes: the tokens and global classes from Task 3.
- Produces: nothing importable. `renderStartupError(container: Element, thrown: unknown): void` and `startupError(thrown: unknown): StartupError` keep their exact signatures — `src/lib/startupError.test.ts` and `src/main.tsx` both depend on them and neither may be touched.

- [ ] **Step 1: Write `src/App.module.css`**

```css
/* The shell every signed-in screen sits inside. */

.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--rule-hairline);
  background: var(--surface-raised);
}

.wordmark {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.identity {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
}

.content {
  flex: 1;
  padding: var(--space-6);
}

/* Loading and the failure states share a centred column: each is one short
   message, and centring it stops a single line stranding itself in a corner of
   a wide screen. */
.centred {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: var(--space-4);
  min-height: 60vh;
  max-width: var(--measure-prose);
  margin: 0 auto;
  padding: var(--space-6) var(--space-5);
}
```

- [ ] **Step 2: Apply it in `src/App.tsx`**

Add after the existing imports:

```tsx
import styles from './App.module.css'
```

Replace the three affected `case` bodies. `loading`:

```tsx
    case 'loading':
      return (
        <main className={styles.centred}>
          <p className="t-body">Loading…</p>
        </main>
      )
```

`db-error` — note it keeps all three of its existing lines, including the reassurance, which is the part a worried non-developer actually needs:

```tsx
    case 'db-error':
      return (
        <main className={styles.centred}>
          <p className="t-eyebrow">Client Health</p>
          <h1 className="t-header">Cannot reach the database</h1>
          <p className="alert prose" role="alert">
            {state.error}
          </p>
          <p className="t-body prose">Your data is safe. Try again in a moment.</p>
        </main>
      )
```

`active`:

```tsx
    case 'active':
      return (
        <div className={styles.shell}>
          <header className={styles.header}>
            <div className={styles.wordmark}>
              <p className="t-eyebrow">The Grounded Company</p>
              <h1 className="t-header">Client Health</h1>
            </div>
            <div className={styles.identity}>
              <p className="t-caption">{state.profile.email}</p>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => void supabase.auth.signOut()}
              >
                Sign out
              </button>
            </div>
          </header>
          <main className={styles.content}>
            {/* Rendered inside the existing `active` case rather than behind any
                new session/profile branching: deriveAppState stays the single
                place that decides what the app is showing. */}
            <Board profile={state.profile} />
          </main>
        </div>
      )
```

Two things deliberately unchanged: the `default` case's exhaustiveness check, and the fact that `Board` is rendered only from `active`.

- [ ] **Step 3: Add class names to the startup-error DOM**

`src/lib/startupError.ts` builds its DOM by hand with `createElement`, and it must keep doing so — the comment above `renderStartupError` explains why, and the reason still holds. It cannot import a CSS module either: modules ship in the bundle, and this function runs when the bundle is the thing that broke. It uses the global classes from `base.css`, which `index.html` links independently.

In `renderStartupError`, add a `className` to each element as it is created:

```ts
  const main = doc.createElement('main')
  // Global classes from src/styles/base.css, not a CSS module. base.css is
  // linked from index.html, so it is present even when the bundle is broken —
  // which is the only situation in which this function ever runs.
  main.className = 'startup-error'

  const heading = doc.createElement('h1')
  heading.className = 't-header'
  heading.textContent = title
  main.append(heading)

  const detailParagraph = doc.createElement('p')
  detailParagraph.className = 'alert prose'
  // role="alert" so a screen reader announces it; this is the whole content of
  // the page, so it must not be silent.
  detailParagraph.setAttribute('role', 'alert')
  detailParagraph.textContent = detail
  main.append(detailParagraph)

  const list = doc.createElement('ol')
  list.className = 'startup-error__steps'
  for (const step of steps) {
    const item = doc.createElement('li')
    item.className = 't-body prose'
    item.textContent = step
    list.append(item)
  }
  main.append(list)
```

Leave `startupError()` and the whole comment block at the top of the file untouched.

- [ ] **Step 4: Add the two startup-error rules to `src/styles/base.css`**

Append to `base.css`. They live there, not in a module, for the reason in the comment:

```css
/* ---------------------------------------------------------------------------
   The startup-error screen, rendered by src/lib/startupError.ts with
   createElement. Global rather than a CSS module because a module ships inside
   the JavaScript bundle, and this screen exists for when the bundle is what
   broke.
   --------------------------------------------------------------------------- */

.startup-error {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: var(--measure-prose);
  margin: 0 auto;
  padding: var(--space-7) var(--space-5);
}

/* Numbered because the steps are genuinely a sequence: check the secret, then
   re-run the workflow. The counter is restored by hand because base.css above
   removes list markers globally. */
.startup-error__steps {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  counter-reset: step;
}

.startup-error__steps > li {
  counter-increment: step;
  padding-left: var(--space-6);
  position: relative;
}

.startup-error__steps > li::before {
  content: counter(step);
  position: absolute;
  left: 0;
  top: 0;
  width: 1.5rem;
  height: 1.5rem;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  font-size: var(--step--1);
  font-weight: var(--wght-header);
}
```

- [ ] **Step 5: Run the tests and the typecheck**

```bash
npx vitest run --exclude '**/rls.test.ts'
npm run build
```

Expected: pass and exit 0. `src/lib/startupError.test.ts` asserts on the `StartupError` object, not the DOM, so adding class names cannot break it — if it does break, a signature changed and that was not the intent.

- [ ] **Step 6: See the startup-error screen for real**

Not by reading the code. Force the failure it exists for:

```bash
mv .env.local .env.local.off
npm run dev
```

Open `http://localhost:5173/tgc-client-health/`. Expected: the numbered-steps screen, in Archivo, on the cream ground, naming `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Then put it back — **do not skip this, the app cannot reach staging without it:**

```bash
mv .env.local.off .env.local
```

Confirm the restore before moving on:

```bash
head -1 .env.local
```

Expected: the `VITE_SUPABASE_URL` line pointing at `dexsdhtpfsswgiytxntl` — staging.

**Would a person know this worked?** This is the one screen in the app whose whole job is telling a non-developer what to do. If it now reads as a numbered set of instructions rather than an unstyled stack of paragraphs, it worked.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.module.css src/lib/startupError.ts src/styles/base.css
git commit -m "feat(styling): dress the app shell and both failure screens

The startup-error screen takes global classes from base.css rather than a CSS
module, because a module ships inside the bundle and that screen exists for when
the bundle is what broke."
```

---

### Task 6: The board, styled as it stands

No behaviour change. `Score all 3s` stays — step 4 deletes it, and deleting it here would leave the board with no way to write anything for the length of a commit.

**Files:**
- Create: `src/board/Board.module.css`
- Modify: `src/board/Board.tsx`

**Interfaces:**
- Consumes: the tokens and global classes from Task 3; `BAND_LABELS`, `bandFor`, `PILLARS` from `src/lib/score.ts`; `Band` from the same module.
- Produces: `bandClassName(band: Band): string`, exported from `src/board/Board.tsx` for the check-in screen in step 3 to reuse.

- [ ] **Step 1: Write `src/board/Board.module.css`**

```css
/* Cards on a responsive grid. auto-fill with a minimum, so eleven clients lay
   out sensibly on a laptop and on a wide monitor without a breakpoint. */

.board {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.periodBar {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
  justify-content: space-between;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: var(--space-4);
}

/* The hairline is the card's edge, not the fill: --surface-raised measures
   1.05:1 against the page. Removing this border makes the card disappear. */
.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--rule-hairline);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.cardHead {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.score {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.scoreValue {
  font-stretch: var(--wdth-display);
  font-weight: var(--wght-display);
  font-size: var(--step-3);
  line-height: 1;
}

.scoreOf {
  color: var(--text-secondary);
  font-stretch: var(--wdth-caption);
  font-weight: var(--wght-caption);
  font-size: var(--step--1);
}

.cardFoot {
  display: flex;
  justify-content: flex-start;
  padding-top: var(--space-3);
  border-top: 1px solid var(--rule-hairline);
}

.state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  max-width: var(--measure-prose);
}
```

- [ ] **Step 2: Add the band-class helper and the imports in `src/board/Board.tsx`**

Change the score import line to bring in the `Band` type, and add the module import:

```tsx
import { BAND_LABELS, PILLARS, bandFor } from '../lib/score'
import type { Band, Pillar } from '../lib/score'
import styles from './Board.module.css'
```

Then, above `export function Board`, add:

```tsx
// Exported because the check-in screen needs the identical mapping in step 3,
// and two copies of it is how a band ends up a different colour on two screens.
// A Record rather than a template string, so adding a Band to score.ts stops
// this from compiling instead of silently producing an undefined class.
const BAND_CLASSES: Record<Band, string> = {
  healthy: 'band--healthy',
  watch: 'band--watch',
  at_risk: 'band--risk',
  incomplete: 'band--none',
}

export function bandClassName(band: Band): string {
  return `band ${BAND_CLASSES[band]}`
}
```

- [ ] **Step 3: Apply the classes to the four render paths**

The `loadError` branch:

```tsx
  if (loadError) {
    return (
      <section className={styles.state}>
        <h2 className="t-header">Cannot reach the database</h2>
        <p className="alert prose" role="alert">
          {loadError}
        </p>
        <button className="button" type="button" onClick={() => void load()}>
          Try again
        </button>
      </section>
    )
  }

  if (clients === null) return <p className="t-body">Loading…</p>

  if (clients.length === 0) {
    return (
      <section className={styles.state}>
        <h2 className="t-header">No active clients yet</h2>
        <p className="t-body prose">
          Add one in the Supabase dashboard to see it here.
        </p>
      </section>
    )
  }
```

And the board itself:

```tsx
  return (
    <section className={styles.board}>
      <div className={styles.periodBar}>
        <h2 className="t-header">{formatPeriod(period)}</h2>
      </div>
      {saveError && (
        <p className="alert prose" role="alert">
          {saveError}
        </p>
      )}
      <ul className={styles.grid}>
        {clients.map((client) => {
          const checkin = checkins.find((row) => row.client_id === client.id)
          const total = checkin?.total_score ?? null
          const band = bandFor(total)
          return (
            <li className={styles.card} key={client.id}>
              <div className={styles.cardHead}>
                <h3 className="t-body">{client.name}</h3>
                {/* The band always carries its text label. Colour is never the
                    only signal: teal against warm red measures 1.76:1, so any
                    two bands are indistinguishable to a colour-blind viewer.
                    Parent spec §9.3. */}
                <span className={bandClassName(band)}>{BAND_LABELS[band]}</span>
              </div>
              <p className={styles.score}>
                {/* An incomplete check-in shows an em dash, never a number.
                    Parent spec §6.2: incomplete must not read as "at risk". */}
                <span className={`${styles.scoreValue} numeric`}>
                  {total === null ? '—' : total}
                </span>
                <span className={styles.scoreOf}>
                  {total === null ? 'not scored' : 'of 25'}
                </span>
              </p>
              <div className={styles.cardFoot}>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={saving}
                  onClick={() => void scoreAllThrees(client.id)}
                >
                  Score all 3s
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
```

The `<strong>` became an `<h3>` because a card is a section with a name, and a screen reader should be able to list the clients. Everything else — the `find`, the `?? null`, `bandFor`, the two error states, `disabled={saving}` — is unchanged.

- [ ] **Step 4: Run the tests and the typecheck**

```bash
npx vitest run --exclude '**/rls.test.ts'
npm run build
```

Expected: pass and exit 0. Watch for the token test in particular: `Board.module.css` is the largest new stylesheet in this plan and the likeliest place a stray literal landed.

- [ ] **Step 5: Look at the board against staging**

```bash
npm run dev
```

Sign in at `http://localhost:5173/tgc-client-health/`. **Staging has no active profile yet**, so the first sign-in there will land on the access-pending screen — which is itself worth seeing, and is the styled screen from Task 4. To activate yourself on staging:

```bash
npm run db:which   # must print tgc-client-health-staging
npx --yes supabase@latest db query --linked \
  "update public.profiles set role = 'admin', is_active = true where email = 'josh@thegroundedcompany.com' returning id, email, role, is_active"
```

Then reload. Expected on the board: a card per client on the grid, a hairline edge, the total in the wide heavy cut with tabular figures, a filled chip with an uppercase label. `Staging Test Client` will read `—  not scored  ·  Not scored` until something is saved.

**Would a person know this worked?** Click `Score all 3s` and the card must change: em dash to `15`, `not scored` to `of 25`, and the chip from grey to amber reading `Watch`. That transition is the whole reason this slice exists — the button that started all of this now visibly changes the thing it wrote to. If the chip colour changes but the number does not, or nothing changes at all, stop and report it.

- [ ] **Step 6: Commit**

```bash
git add src/board/Board.tsx src/board/Board.module.css
git commit -m "feat(styling): dress the board, no behaviour change

Score all 3s stays until step 4 deletes it: removing it here would leave the
board with no way to write anything for the length of a commit.

The band chip is a fill with an ink label rather than coloured text, because no
band colour is legible as type on the brand paper. bandClassName is exported for
the check-in screen to reuse — two copies of that mapping is how one band ends
up a different colour on two screens."
```

---

### Task 7: Deploy, and answer the question this step exists to answer

Everything before this proves the font loads from a dev server on `localhost`. Spec §3 step 2 says this step proves it loads **from GitHub Pages under `/tgc-client-health/`**, and only a deploy can prove that.

**Files:** none. This task ships and verifies.

**Interfaces:**
- Consumes: everything.
- Produces: the answer to §4.3's open risk.

- [ ] **Step 1: Full local check before anything ships**

```bash
npm run db:which
npx vitest run --exclude '**/rls.test.ts'
npm run build
npm run lint
```

Expected: `db:which` prints `tgc-client-health-staging` with no production banner; the suite passes; the build exits 0; the lint is clean.

- [ ] **Step 2: Confirm what is about to ship**

```bash
git log --oneline origin/main..HEAD
git status --short
```

Expected: the six commits from this plan plus the one documentation commit already waiting, and a clean working tree. **Josh pushes** — command-line git here holds no credential, GitHub Desktop holds its own and cannot share it.

- [ ] **Step 3: Watch the deploy**

Josh pushes from GitHub Desktop, then opens the repository's Actions tab. The `deploy` workflow runs `test` and then `build`; the test job runs `npx vitest run --exclude '**/rls.test.ts'`, which now includes `tests/tokens.test.ts` with no workflow change. Both jobs must be green before looking at the site.

- [ ] **Step 4: Verify the font shipped, by inspecting what was served**

Not by looking at the page and judging the letterforms — that is how a fallback face passes for the real one. Fetch the actual bytes:

```bash
cd "$(mktemp -d)"
curl -sS "https://thegroundedco.github.io/tgc-client-health/" -o index.html
grep -o '/tgc-client-health/assets/[^"]*\.css' index.html
```

Take each stylesheet URL that prints, and for each:

```bash
curl -sS "https://thegroundedco.github.io/tgc-client-health/assets/<name>.css" -o sheet.css
grep -o 'url([^)]*woff2[^)]*)' sheet.css
```

Then fetch the font URL that prints and check what came back:

```bash
curl -sS -o font.woff2 -w "http=%{http_code} bytes=%{size_download}\n" \
  "https://thegroundedco.github.io/tgc-client-health/assets/<hashed>.woff2"
head -c4 font.woff2 | xxd -p
```

Expected: `http=200`, about 90,096 bytes, magic `774f4632`.

**Write each response to a file and grep the file.** Piping a large response through a shell variable into grep is how this project produced a false negative once already: grep treated the data as binary and printed nothing, which reads exactly like "the font did not deploy". A check that fails silently is the same bug as a save that succeeds silently.

- [ ] **Step 5: Josh, on the deployed site**

Spec §8: every slice ends with the owner in front of the deployed page before anything is written up. This step is not optional and cannot be delegated to a query.

At `https://thegroundedco.github.io/tgc-client-health/`, confirm out loud:

1. The page is cream, not white, and the type is Archivo, not the system sans.
2. The sign-in masthead shows two visibly different widths — a narrow letterspaced eyebrow above a wide heavy "Client Health".
3. Signed in: the header, the client cards, the filled band chip with its uppercase label.
4. Tab through a card: the focus ring is visible on the button.
5. On a phone, the cards stack to one column and the page does not scroll sideways.
6. `Score all 3s` on production changes the card on screen. Production already holds an all-3s row from step 1, so **it will not change** — which is the original defect, reproduced deliberately, and the reason step 4 rewrites the board. Confirm you see nothing change, so the fix in step 4 has a before to be measured against.

- [ ] **Step 6: Record the result in the spec**

Spec §4.3 lists the font as a "known risk, to be discovered at step 2". Replace that paragraph with what was measured: the URL served, the status, the byte count, the date. Then commit:

```bash
git add docs/superpowers/specs/2026-08-21-phase-1-slice-1-design.md
git commit -m "docs: the self-hosted font loads from Pages under the project base path

Measured on the deployed site, not inferred from a green build. §4.3's known
risk is now a measurement."
```

---

## Self-Review

**Spec coverage — every requirement in §4, mapped to a task:**

| Spec | Task |
|---|---|
| §4.1 two token layers, brand and semantic | 3 (three layers — deviation recorded) |
| §4.1 components reference the semantic layer only | 3 produces them; 4, 5, 6 consume only semantic tokens |
| §4.1 the functional amber is not brand | 3, its own layer |
| §4.1 every band carries a text label | 6, and asserted as load-bearing with the measured 1.76:1 |
| §4.2 test fails on hex outside `tokens.css` | 1, 2 |
| §4.2 test fails on a `font-family` that is not a `var()` | 1, 2 |
| §4.2 components must be able to apply a face, never name one | 1, `LONE_VAR_REFERENCE` |
| §4.3 self-hosted variable WOFF2, `font-display: swap` | 3 (location deviates, recorded) |
| §4.3 settles the base-path question | 3 step 6 locally, 7 step 4 on Pages |
| §4.3 fallback if the binary cannot be fetched | 3 step 1 — measured fetchable 2026-08-21, so the fallback is not needed |
| §4.4 five type roles by width and weight | 3, `.t-*` classes |
| §4.4 `tabular-nums` on every score | 3 `.numeric`, applied in 6 |
| §4.5 CSS modules per component, plain CSS, no dependency | 4, 5, 6 |
| §4.5 light theme only | 3 — no `prefers-color-scheme`, no `data-theme` |
| §3 step 2: sign-in, access-pending, four error states, current board | 4 (sign-in, pending), 5 (loading, db-error, startup-error), 6 (board load error, empty, save error) |
| §8 "would a person know this worked?" per task | every task's look-at-it step |
| §8 the owner on the deployed site per slice | 7 step 5 |
| Parent §9.2 contrast measured | the measured-contrast table, computed not assumed |

The four error states of §3 step 2, named explicitly so none is missed: the **startup-error** screen (Task 5), the **`db-error`** app state (Task 5), the board's **`loadError`** with its Try again (Task 6), and the board's **`saveError`** (Task 6). The sign-in send failure and the empty-board state are covered in Tasks 4 and 6 as well.

**Placeholder scan:** no TBD, no "add appropriate error handling", no "similar to Task N", no test described without its code. Every hex value in the plan is a measured value with its contrast ratio. Every command has an expected result. The one deliberately-red commit is labelled as such with its reason.

**Type consistency:** `findViolations`, `formatViolations`, `SourceFile`, `Violation`, `RuleName`, `EXEMPT_PATHS` are named identically in Tasks 1 and 2. `bandClassName` and `BAND_CLASSES` appear only in Task 6 and are keyed by `Band` from `src/lib/score.ts`, whose four members are `healthy | watch | at_risk | incomplete` — matched exactly. Every `var(--…)` used in Tasks 4, 5 and 6 is declared in Task 3's `:root`; every `.t-*`, `.band*`, `.button*`, `.field`, `.alert`, `.prose` and `.numeric` used later is defined in Task 3's `base.css`, except `.startup-error` and `.startup-error__steps`, which Task 5 adds to `base.css` in the same task that uses them.

**One gap accepted, not fixed:** there are no component render tests, because neither `jsdom` nor a testing library is installed and adding either is a new dependency this step's constraints forbid. Verification of appearance is therefore the token test, the build, the served-bytes check, and a human looking at the screen. That is stated rather than glossed, because the project's most expensive lesson was a defect that every automated check passed.
