# Light and Dark Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a dark theme with three states — `system` / `light` / `dark` — following the OS by default, overridable by a control in the header, and persisted per browser.

**Architecture:** Dark overrides the BRAND layer of `tokens.css` only; `--brand-paper` and `--brand-ink` are roles rather than lightnesses, so the SEMANTIC layer above them needs no change. Three tokens are pinned out of the flip because measurement says inheriting would break them. The `system` state is pure CSS and needs no JavaScript at all; only the manual override does, and it is applied by a classic inline script in `<head>` so it lands before first paint rather than after a dynamically-imported React mounts.

**Tech Stack:** React 19, TypeScript, Vite, plain CSS with custom properties, CSS Modules, Vitest + Testing Library, jsdom.

**Spec:** `docs/superpowers/specs/2026-09-02-light-dark-theme-design.md`

## Global Constraints

- **Branch:** `theme-light-dark`, already created, spec committed at `f0c9e1e`. Do not commit to `main`. **Check `git rev-parse --abbrev-ref HEAD` before every commit** — this repository has had commits land on `main` unnoticed.
- **`src/styles/tokens.css` is the only file in the repository allowed to contain a colour literal or a typeface name.** Enforced by `tests/tokens.test.ts` walking `.css`, `.ts`, `.tsx`, `.html`, `.svg`. `index.html` is **not** exempt.
- **No database change, no migration, no production verification script.** This ships entirely in the bundle.
- Every colour value added must carry its measured contrast ratio in a comment beside it, computed with the WCAG 2.x relative-luminance formula. The exact values are in spec §8 — copy them; do not re-derive or round them.
- `npm test` must be green at the end of every task. Baseline before starting: **784 tests across 47 files.**
- Lint with `npm run lint` (oxlint) and typecheck via `npm run build` before the final commit of each task that touches TypeScript.
- **No transition on the theme switch.** Spec §1. Do not add one.
- The band fills — teal, amber, red, stone — are **identical in both schemes**. Do not re-tune them.

---

### Task 1: The dark palette in `tokens.css`

Delivers working OS-following dark mode on its own, with no JavaScript.

**Files:**
- Modify: `src/styles/tokens.css` (BRAND block ~lines 55-70, SEMANTIC block ~lines 86-126, and a new block after `:root` closes at line 219)
- Modify: `src/board/Matrix.module.css:317` (one word, in a comment)
- Test: `tests/themeParity.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the CSS custom properties `--brand-ink-fixed`, `--brand-stone`, `--brand-red-legible`, and the seven `--dark-*` literals. The attribute contract `data-theme="light"` / `data-theme="dark"` on `:root`, with the attribute **absent** meaning follow the OS. Tasks 2 and 3 depend on that contract.

- [ ] **Step 1: Write the failing structural test**

Create `tests/themeParity.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The two dark blocks are the cost of rejecting light-dark() (spec §4.1). They
// cannot drift in VALUE -- each contains only var(--dark-*) repointings, and the
// literals are defined once. They can still drift in MEMBERSHIP: someone adds an
// eighth token to one block and not the other, and the app is then correct on a
// dark-preferring OS and wrong for anyone who pressed the Dark button. No DOM
// test can see that; jsdom computes no cascade and vitest stubs CSS Modules.
//
// Lives outside src/ because it needs node:fs, and tsconfig.app.json gives src/
// no Node types -- the same reason tests/tokens.test.ts lives here.

const SOURCE = readFileSync(
  join(import.meta.dirname, '..', 'src', 'styles', 'tokens.css'),
  'utf8',
)

// Comments stripped before any assertion reads the file. tokens.css explains its
// own traps by naming the tokens that caused them, so a check run against the raw
// text would match the prose and pass on the explanation rather than the code.
// tokenRules.ts warns about this in its own header; matrixGrid.test.ts hit it too.
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

const MEDIA = ":root:not([data-theme='light'])"
const OVERRIDE = ":root[data-theme='dark']"

function declarations(selector: string): string[] {
  const opener = `${selector} {`
  const start = CODE.indexOf(opener)
  if (start === -1) throw new Error(`no rule for "${selector}" in tokens.css`)
  const end = CODE.indexOf('}', start)
  if (end === -1) throw new Error(`rule "${selector}" is never closed`)
  return CODE.slice(start + opener.length, end)
    .split(';')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort()
}

describe('the two dark blocks', () => {
  // A test that silently found nothing would pass forever. This project has
  // already shipped one check that reported success by finding no data.
  it('is read, not silently skipped', () => {
    expect(SOURCE.length).toBeGreaterThan(1000)
    expect(CODE).toContain(`${MEDIA} {`)
    expect(CODE).toContain(`${OVERRIDE} {`)
  })

  it('declare exactly the same properties with the same values', () => {
    expect(declarations(MEDIA)).toEqual(declarations(OVERRIDE))
  })

  it('both set color-scheme, or the platform widgets stay light', () => {
    expect(declarations(MEDIA)).toContain('color-scheme: dark')
    expect(declarations(OVERRIDE)).toContain('color-scheme: dark')
  })

  it('repoint every --dark-* literal the brand block defines, and no more', () => {
    const defined = [...CODE.matchAll(/(--dark-[a-z-]+)\s*:/g)]
      .map((match) => match[1])
      .sort()
    const used = [...declarations(OVERRIDE).join(';').matchAll(/var\((--dark-[a-z-]+)\)/g)]
      .map((match) => match[1])
      .sort()
    expect(defined.length).toBeGreaterThan(0)
    expect(used).toEqual(defined)
  })

  // Spec §3. Both of these inherit correctly in light and catastrophically in
  // dark: a flipped --brand-ink puts the health labels at 1.72:1 on teal, and a
  // flipped --brand-rule puts them at 1.71:1 on the "not scored" fill. The chips
  // stay the right colour and become unreadable, which is the encoding failing
  // without anything looking broken.
  it('never repoints the pinned tokens', () => {
    const both = [...declarations(MEDIA), ...declarations(OVERRIDE)].join(';')
    expect(both).not.toContain('--brand-ink-fixed')
    expect(both).not.toContain('--brand-stone')
  })

  it('points the band label and the not-scored fill at the pinned tokens', () => {
    expect(CODE).toContain('--text-on-band: var(--brand-ink-fixed)')
    expect(CODE).toContain('--band-none: var(--brand-stone)')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/themeParity.test.ts`
Expected: FAIL — `no rule for ":root:not([data-theme='light'])" in tokens.css`

- [ ] **Step 3: Rename `--brand-red-dark` to `--brand-red-legible`**

In `src/styles/tokens.css`, the declaration, its use in `--alert-text`, and the comment above it. The comment currently reads "`--brand-red-dark` exists because the brand red measures 3.34:1 on the brand paper". Replace that paragraph with:

```css
  /* Derived from the five above: same identity, adjusted for legibility. A
     rebrand replaces these too.
     --brand-red-legible exists because the brand red measures 3.34:1 on the
     brand paper, below the 4.5:1 needed for text. An error message set in
     #F9423A would be brand-correct and unreadable. #B82B25 measures 5.75:1.
     The name says "legible", not "dark", because its dark-theme counterpart is
     LIGHTER -- #FF6B60, 6.02:1 on the dark ground. A pleasing inversion falls
     out of that: the brand red that fails as text on paper PASSES on the dark
     ground at 4.69:1, while #B82B25 fails there at 2.73:1. The compromise and
     the true colour swap places. */
```

Then in `src/board/Matrix.module.css:317`, change `--brand-red-dark exists for text elsewhere` to `--brand-red-legible exists for text elsewhere`.

- [ ] **Step 4: Add the pinned tokens and the dark literals to the BRAND block**

After `--brand-red-legible: #B82B25;` in `:root`:

```css
  /* PINNED — the same value in both schemes, and that is the whole point.
     --brand-stone carries the same literal as --brand-rule, and that is NOT a
     duplicate to be tidied away: a hairline grey and a light band fill are two
     different jobs that happen to coincide on paper and diverge in the dark.
     Merging them back is how spec §3.2's defect returns. */
  --brand-ink-fixed: #1F1F1F;
  --brand-stone: #CFC8B6;

  /* ==========================================================================
     DARK — the same roles at night. Paper is the ground and ink is the mark;
     neither is a lightness, which is why the SEMANTIC layer below needs no
     dark variant at all and the action button inverts for free at 12.74:1.

     Measured 2026-09-02, same formula as the 2026-08-21 pass.
                              page   raised  sunken
       --dark-ink            14.22   12.74   15.27
       --dark-ink-muted       6.32    5.66    6.78
     --dark-rule is 1.74:1 on the page. That is a hairline, not text, and it is
     marginally BETTER than light's accepted 1.56:1 equivalent.
     --dark-red-legible is 6.02:1 on the page and 5.39:1 on raised.
     Bands against the dark ground, unchanged: teal 8.28, amber 7.79, red 4.69,
     stone 10.07. The ink labels on them are ground-independent and unchanged.
     ========================================================================== */
  --dark-paper: #201D18;
  --dark-paper-raised: #2A2620;
  --dark-paper-sunken: #191612;
  --dark-ink: #F2ECDA;
  --dark-ink-muted: #A69E8E;
  --dark-rule: #4A443A;
  --dark-red-legible: #FF6B60;
```

- [ ] **Step 5: Repoint the three semantic tokens and declare the base `color-scheme`**

At the very top of the `:root` block, before the BRAND banner comment:

```css
  /* Not decoration. This is what makes the month <select>, the scrollbars and
     the focus rings the PLATFORM draws follow the theme. Without it a dark app
     has a white dropdown in the middle of it. It lives here rather than in
     base.css so it sits beside the blocks it must stay in step with. */
  color-scheme: light;
```

Then in the SEMANTIC block, change exactly three lines:

```css
  --band-none: var(--brand-stone);
  --text-on-band: var(--brand-ink-fixed);
  --alert-text: var(--brand-red-legible);
```

Add to the health-bands comment, after the existing text:

```css
     --text-on-band and --band-none deliberately do NOT follow --brand-ink and
     --brand-rule into the dark theme. Spec §3, and tests/themeParity.test.ts
     fails if either is ever repointed.
```

- [ ] **Step 6: Add the two dark blocks after `:root` closes**

At the end of the file, after the closing `}` of `:root`:

```css
/* ============================================================================
   DARK, applied two ways, and both are needed.

   The media query is the `system` state and needs no JavaScript: it is in a
   stylesheet linked in <head> and is correct on the first paint. The attribute
   is the manual override, stamped by the inline script in index.html.

   The :not([data-theme='light']) guard is what makes the override win in BOTH
   directions. Without it, somebody on a dark-preferring OS who chooses Light
   gets the media query anyway and the button appears to do nothing.

   The two blocks are duplicated on purpose. light-dark() would collapse them
   into one declaration per token and was rejected on failure mode rather than
   on browser support: where it is unsupported the custom property is invalid at
   computed-value time and resolves to `unset` -- not a wrong colour, an ABSENT
   one, on every token at once. See spec §4.1. Because the literals are defined
   once above and these blocks only repoint, they cannot drift in value;
   tests/themeParity.test.ts stops them drifting in membership.
   ============================================================================ */

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --brand-paper: var(--dark-paper);
    --brand-paper-raised: var(--dark-paper-raised);
    --brand-paper-sunken: var(--dark-paper-sunken);
    --brand-ink: var(--dark-ink);
    --brand-ink-muted: var(--dark-ink-muted);
    --brand-rule: var(--dark-rule);
    --brand-red-legible: var(--dark-red-legible);
  }
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --brand-paper: var(--dark-paper);
  --brand-paper-raised: var(--dark-paper-raised);
  --brand-paper-sunken: var(--dark-paper-sunken);
  --brand-ink: var(--dark-ink);
  --brand-ink-muted: var(--dark-ink-muted);
  --brand-rule: var(--dark-rule);
  --brand-red-legible: var(--dark-red-legible);
}
```

- [ ] **Step 7: Note that the raised-surface warning survives into dark**

Spec §9. In the `surfaces` comment in the SEMANTIC block, change "measures 1.05:1 against the page" to "measures 1.05:1 against the page in light and 1.12:1 in dark".

- [ ] **Step 8: Run the tests**

Run: `npm test`
Expected: PASS. `tests/themeParity.test.ts` green (6 tests), `tests/tokens.test.ts` still green — no literal has escaped into a component — and the previous 784 all still passing.

- [ ] **Step 9: See it**

Run: `npm run dev`, open the app, and toggle the OS appearance setting (macOS: System Settings → Appearance). The whole app should follow, month `<select>` and scrollbars included. Check the matrix in dark specifically — spec §9 flags that its 1px/2px grid has never been seen on a dark ground.

- [ ] **Step 10: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print theme-light-dark
git add src/styles/tokens.css src/board/Matrix.module.css tests/themeParity.test.ts
git commit -m "theme: the dark palette, and the three tokens pinned out of it"
```

---

### Task 2: `theme.ts` — the preference module

**Files:**
- Create: `src/styles/theme.ts`
- Test: `src/styles/theme.test.ts` (create)

**Interfaces:**
- Consumes: the `data-theme` attribute contract from Task 1.
- Produces:
  - `type ThemePreference = 'system' | 'light' | 'dark'`
  - `const THEME_KEY = 'theme'`, `const THEME_ATTRIBUTE = 'data-theme'`, `const DEFAULT_PREFERENCE: ThemePreference = 'system'`
  - `const THEME_PREFERENCES: readonly ThemePreference[]` — ordered `system`, `light`, `dark`; Task 5 renders the control from it
  - `type StorageLike`, `type RootLike`
  - `isThemePreference(value: unknown): value is ThemePreference`
  - `readPreference(store?: StorageLike | null): ThemePreference`
  - `writePreference(preference: ThemePreference, store?: StorageLike | null): boolean`
  - `applyPreference(root: RootLike, preference: ThemePreference): void`

- [ ] **Step 1: Write the failing test**

Create `src/styles/theme.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  applyPreference,
  isThemePreference,
  readPreference,
  THEME_ATTRIBUTE,
  THEME_KEY,
  THEME_PREFERENCES,
  writePreference,
  type StorageLike,
} from './theme'

// A fake store rather than jsdom's localStorage: these are pure functions and
// they should be provable without an environment. draftCache.ts takes the same
// shape for the same reason.
function fakeStorage(initial: Record<string, string> = {}): StorageLike {
  const held = { ...initial }
  return {
    getItem: (key) => held[key] ?? null,
    setItem: (key, value) => {
      held[key] = value
    },
    removeItem: (key) => {
      delete held[key]
    },
  }
}

// Safari in private browsing throws on the property access, not only on quota.
// draftCache.ts already treats that as a normal outcome; so does this.
const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('denied')
  },
  setItem: () => {
    throw new Error('denied')
  },
  removeItem: () => {
    throw new Error('denied')
  },
}

describe('isThemePreference', () => {
  it('accepts exactly the three states', () => {
    expect(THEME_PREFERENCES).toEqual(['system', 'light', 'dark'])
    for (const preference of THEME_PREFERENCES) {
      expect(isThemePreference(preference)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    for (const value of ['', 'Dark', 'auto', 'SYSTEM', null, undefined, 3, {}]) {
      expect(isThemePreference(value)).toBe(false)
    }
  })
})

describe('readPreference', () => {
  it('reads a stored override', () => {
    expect(readPreference(fakeStorage({ [THEME_KEY]: 'dark' }))).toBe('dark')
    expect(readPreference(fakeStorage({ [THEME_KEY]: 'light' }))).toBe('light')
  })

  // The whole reason this needs no key version, unlike draftCache. A stale
  // draft read as current shows an old rubric's answers as this month's. A
  // stale theme string is one of three words, and anything else is simply not
  // one of them.
  it('falls back to system for an unrecognised value', () => {
    expect(readPreference(fakeStorage({ [THEME_KEY]: 'midnight' }))).toBe('system')
  })

  it('falls back to system when the key is absent', () => {
    expect(readPreference(fakeStorage())).toBe('system')
  })

  it('falls back to system when there is no storage at all', () => {
    expect(readPreference(null)).toBe('system')
  })

  it('falls back to system when reading throws', () => {
    expect(readPreference(throwingStorage)).toBe('system')
  })
})

describe('writePreference', () => {
  it('stores an override and reports that it stuck', () => {
    const store = fakeStorage()
    expect(writePreference('dark', store)).toBe(true)
    expect(store.getItem(THEME_KEY)).toBe('dark')
    expect(readPreference(store)).toBe('dark')
  })

  // Absent and 'system' mean the same thing, and one state should have one
  // representation. It also keeps index.html's script to a single comparison.
  it('clears the key for system rather than storing the word', () => {
    const store = fakeStorage({ [THEME_KEY]: 'dark' })
    expect(writePreference('system', store)).toBe(true)
    expect(store.getItem(THEME_KEY)).toBe(null)
  })

  it('reports failure rather than throwing when storage refuses', () => {
    expect(writePreference('dark', throwingStorage)).toBe(false)
    expect(writePreference('dark', null)).toBe(false)
  })
})

describe('applyPreference', () => {
  it('sets the attribute for an override', () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() }
    applyPreference(root, 'dark')
    expect(root.setAttribute).toHaveBeenCalledWith(THEME_ATTRIBUTE, 'dark')
    expect(root.removeAttribute).not.toHaveBeenCalled()
  })

  // Removing, not setting data-theme="system". With no attribute the media
  // query resumes control, which is what lets the app follow an OS that
  // changes at sunset without anybody pressing anything.
  it('removes the attribute for system', () => {
    const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() }
    applyPreference(root, 'system')
    expect(root.removeAttribute).toHaveBeenCalledWith(THEME_ATTRIBUTE)
    expect(root.setAttribute).not.toHaveBeenCalled()
  })

  it('round trips every state through storage', () => {
    const store = fakeStorage()
    for (const preference of THEME_PREFERENCES) {
      writePreference(preference, store)
      expect(readPreference(store)).toBe(preference)
    }
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/styles/theme.test.ts`
Expected: FAIL — cannot resolve `./theme`

- [ ] **Step 3: Write the module**

Create `src/styles/theme.ts`:

```ts
// The theme preference: read it, write it, apply it. Pure, with storage and the
// root element injected, so every branch below is provable without a browser --
// the same shape as checkin/draftCache.ts, and for the same reasons.
//
// Two things this file is careful about.
//
// First, storage is optional. Safari in private browsing throws on the property
// ACCESS, not only on setItem's quota, and an embedded context can throw too.
// Every entry point treats that as a normal outcome, and writePreference
// returns whether the write actually happened.
//
// Second, and unlike draftCache, the stored value needs NO version segment. The
// draft's key carries v4 because reading a stale SHAPE would present an old
// rubric's answers as this month's -- a value meaning one thing read as though
// it meant another. A stale theme string cannot do that: it is one of three
// words, and anything unrecognised falls back to system. Validation covers the
// entire risk, and a version here would be cargo.

export type ThemePreference = 'system' | 'light' | 'dark'

// Ordered, and the order is the reading order of the control in the header:
// the default first, then the two overrides. ThemeControl renders from this
// array rather than repeating the three words.
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export const DEFAULT_PREFERENCE: ThemePreference = 'system'

// Duplicated, by necessity, in the inline script in index.html -- that script
// must run before the bundle exists, so it cannot import this. It is not
// allowed to drift: tests/bootTheme.test.ts reads both files and compares them.
export const THEME_KEY = 'theme'
export const THEME_ATTRIBUTE = 'data-theme'

// Only the three methods used, so a test can supply a plain object rather than
// a whole Storage. Likewise RootLike: applyPreference needs two methods off an
// Element, not a document.
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type RootLike = Pick<Element, 'setAttribute' | 'removeAttribute'>

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === 'string' &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  )
}

export function readPreference(
  store: StorageLike | null = defaultStorage(),
): ThemePreference {
  if (!store) return DEFAULT_PREFERENCE
  try {
    const raw = store.getItem(THEME_KEY)
    return isThemePreference(raw) ? raw : DEFAULT_PREFERENCE
  } catch {
    return DEFAULT_PREFERENCE
  }
}

export function writePreference(
  preference: ThemePreference,
  store: StorageLike | null = defaultStorage(),
): boolean {
  if (!store) return false
  try {
    // Absent and 'system' mean the same thing, so system CLEARS rather than
    // storing the word. One state, one representation -- and index.html's
    // script then needs only to recognise the two overrides.
    if (preference === DEFAULT_PREFERENCE) store.removeItem(THEME_KEY)
    else store.setItem(THEME_KEY, preference)
    return true
  } catch {
    return false
  }
}

export function applyPreference(root: RootLike, preference: ThemePreference): void {
  // Removing the attribute is the point of the three states: with no attribute,
  // tokens.css's media query resumes control and the app follows an OS that
  // changes at sunset without anybody pressing anything.
  if (preference === DEFAULT_PREFERENCE) root.removeAttribute(THEME_ATTRIBUTE)
  else root.setAttribute(THEME_ATTRIBUTE, preference)
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/styles/theme.test.ts && npm run lint`
Expected: PASS, no lint findings.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print theme-light-dark
git add src/styles/theme.ts src/styles/theme.test.ts
git commit -m "theme: the preference module, storage injected and unversioned"
```

---

### Task 3: The inline boot script

**Files:**
- Modify: `index.html` (`<head>`, after the two stylesheet `<link>`s at lines 13-14)
- Test: `tests/bootTheme.test.ts` (create)

**Interfaces:**
- Consumes: `THEME_KEY` and `THEME_ATTRIBUTE` from Task 2, by value rather than by import — the script must run before any bundle exists.
- Produces: `data-theme` on `<html>` before first paint.

- [ ] **Step 1: Write the failing test**

Create `tests/bootTheme.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// index.html's inline theme script duplicates two string constants from
// src/styles/theme.ts, and it has to: it runs before the bundle exists, so it
// cannot import them. This test is the thing that stops the duplicate drifting.
//
// The failure it prevents is quiet. Change THEME_KEY in the module, forget the
// HTML, and every automated test still passes: the control still works, the
// preference is still stored, still read back, still applied -- and every page
// load flashes the wrong theme until React mounts, because the script is
// reading a key nobody writes any more.

const ROOT = join(import.meta.dirname, '..')
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8')
const MODULE = readFileSync(join(ROOT, 'src', 'styles', 'theme.ts'), 'utf8')

// The value of an exported string constant, read out of theme.ts's source. Not
// imported: importing would make this test agree with the module by
// construction, and agreeing with the module is the entire question.
function exportedString(name: string): string {
  const match = MODULE.match(new RegExp(`export const ${name}[^=]*=\\s*'([^']*)'`))
  if (!match) throw new Error(`theme.ts does not export ${name} as a string literal`)
  return match[1]
}

describe('the inline theme script', () => {
  it('is read, not silently skipped', () => {
    expect(HTML.length).toBeGreaterThan(500)
    expect(MODULE.length).toBeGreaterThan(500)
    expect(exportedString('THEME_KEY')).toBe('theme')
    expect(exportedString('THEME_ATTRIBUTE')).toBe('data-theme')
  })

  // In <head>, so it runs before the body paints. In the body it would still
  // run before React -- and still after the first paint, which is the whole
  // failure it exists to prevent.
  it('runs in the head', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'))
    expect(head).toContain(`localStorage.getItem('${exportedString('THEME_KEY')}')`)
    expect(head).toContain(`setAttribute('${exportedString('THEME_ATTRIBUTE')}'`)
  })

  it('runs before the module bundle is even requested', () => {
    expect(HTML.indexOf(exportedString('THEME_ATTRIBUTE'))).toBeLessThan(
      HTML.indexOf('src="/src/main.tsx"'),
    )
  })

  // Storage that throws must not take out the page before it has drawn
  // anything. This is the one script in the app with nothing above it to catch.
  it('is wrapped against storage that throws', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'))
    const script = head.slice(head.lastIndexOf('<script'))
    expect(script).toContain('try')
    expect(script).toContain('catch')
  })

  // It must recognise exactly the two OVERRIDES. 'system' is represented by the
  // key's absence (theme.ts's writePreference clears it), so a script that also
  // matched the word would be reading a value that is never written.
  it('recognises the two overrides and not the default', () => {
    const head = HTML.slice(0, HTML.indexOf('</head>'))
    const script = head.slice(head.lastIndexOf('<script'))
    expect(script).toContain("'light'")
    expect(script).toContain("'dark'")
    expect(script).not.toContain("'system'")
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/bootTheme.test.ts`
Expected: FAIL — the head does not contain `localStorage.getItem('theme')`

- [ ] **Step 3: Add the script to `index.html`**

Immediately after the `<link rel="stylesheet" href="/src/styles/base.css" />` line, still inside `<head>`:

```html
    <!-- Classic and inline, like the boot-slow timer below, and in <head> so it
         runs before the first paint rather than after it.

         main.tsx mounts React through a DYNAMIC import, deliberately -- that is
         what turns a missing environment variable into a message instead of a
         blank page. The cost is that the mount is late, so an attribute set by
         React would leave somebody who chose Dark looking at a light page for
         the whole bundle fetch.

         Only the OVERRIDE needs this. The `system` state is the media query in
         tokens.css, which is already correct on the first paint with no
         JavaScript at all.

         The key and the attribute are duplicated from src/styles/theme.ts,
         which this cannot import because it runs before the bundle exists.
         tests/bootTheme.test.ts fails if the two ever disagree. -->
    <script>
      try {
        var stored = localStorage.getItem('theme')
        if (stored === 'light' || stored === 'dark') {
          document.documentElement.setAttribute('data-theme', stored)
        }
      } catch (ignored) {
        // Safari in private browsing throws on the access itself. No stored
        // preference simply means follow the OS, which the media query does.
      }
    </script>
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS. `tests/bootTheme.test.ts` green (5 tests), and `tests/tokens.test.ts` still green — the script contains no colour literal, and `index.html` is not exempt from that walk.

- [ ] **Step 5: Verify by hand that the override beats the OS**

Run `npm run dev`. With the OS set to light, run `localStorage.setItem('theme', 'dark')` in the console and reload: the page must be dark from the first paint, with no light flash. Then `localStorage.setItem('theme', 'light')` with the OS set to dark, and reload: the page must be light. That second case is what the `:not([data-theme='light'])` guard exists for.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print theme-light-dark
git add index.html tests/bootTheme.test.ts
git commit -m "theme: stamp the override before the first paint"
```

---

### Task 4: The `useTheme` hook

**Files:**
- Create: `src/styles/useTheme.ts`
- Test: `src/styles/useTheme.dom.test.ts` (create)

**Interfaces:**
- Consumes: `readPreference`, `writePreference`, `applyPreference`, `ThemePreference` from Task 2.
- Produces: `useTheme(): { preference: ThemePreference; setPreference: (next: ThemePreference) => void }`

- [ ] **Step 1: Write the failing test**

Create `src/styles/useTheme.dom.test.ts`:

```ts
// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTheme } from './useTheme'
import { THEME_ATTRIBUTE, THEME_KEY } from './theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
})

describe('useTheme', () => {
  it('starts at system when nothing is stored', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('system')
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false)
  })

  it('starts from the stored override and applies it', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('dark')
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark')
  })

  it('applies and persists a change', () => {
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setPreference('light')
    })
    expect(result.current.preference).toBe('light')
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
  })

  // Going back to system must REMOVE the attribute, not set it to "system".
  // Leaving a stale data-theme="dark" behind would pin the app to dark forever
  // while the control claimed it was following the OS.
  it('removes the attribute and clears storage on the way back to system', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.setPreference('system')
    })
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false)
    expect(localStorage.getItem(THEME_KEY)).toBe(null)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/styles/useTheme.dom.test.ts`
Expected: FAIL — cannot resolve `./useTheme`

- [ ] **Step 3: Write the hook**

Create `src/styles/useTheme.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import {
  applyPreference,
  readPreference,
  writePreference,
  type ThemePreference,
} from './theme'

// The preference, held in React and mirrored to the document and to storage.
//
// The inline script in index.html has ALREADY stamped the attribute for a
// stored override by the time this runs, and that is not redundant with the
// effect below: the script covers the first paint, which React is too late for,
// and the effect covers every change after it, which the script cannot see.
export function useTheme(): {
  preference: ThemePreference
  setPreference: (next: ThemePreference) => void
} {
  // Lazy initialiser, so storage is read once on mount rather than on every
  // render of every screen in the app.
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readPreference(),
  )

  useEffect(() => {
    applyPreference(document.documentElement, preference)
  }, [preference])

  // Storage is written here rather than in the effect, deliberately. The effect
  // also runs on mount, and writing there would persist a preference nobody
  // chose -- turning "this browser has no opinion" into a stored 'system' on
  // the first load of every screen.
  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    writePreference(next)
  }, [])

  return { preference, setPreference }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/styles/useTheme.dom.test.ts && npm run lint`
Expected: PASS, no lint findings.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print theme-light-dark
git add src/styles/useTheme.ts src/styles/useTheme.dom.test.ts
git commit -m "theme: hold the preference in React, mirror it to document and storage"
```

---

### Task 5: The `ThemeControl` component

**Files:**
- Create: `src/styles/ThemeControl.tsx`
- Create: `src/styles/ThemeControl.module.css`
- Test: `src/styles/ThemeControl.dom.test.tsx` (create)

**Interfaces:**
- Consumes: `THEME_PREFERENCES`, `ThemePreference` from Task 2.
- Produces: `<ThemeControl preference={ThemePreference} onChange={(next: ThemePreference) => void} />`

- [ ] **Step 1: Write the failing test**

Create `src/styles/ThemeControl.dom.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeControl } from './ThemeControl'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ThemeControl', () => {
  it('offers all three states at once', () => {
    render(<ThemeControl preference="system" onChange={vi.fn()} />)
    const group = screen.getByRole('group', { name: 'Theme' })
    expect(group).toBeTruthy()
    expect(screen.getByRole('button', { name: 'System' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Light' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dark' })).toBeTruthy()
  })

  // The reason there are three buttons rather than one that cycles. Board.tsx's
  // view toggle makes the same argument: a control that says what it will
  // BECOME gives no indication of what is currently showing.
  it('says which one is showing, without anybody working it out', () => {
    render(<ThemeControl preference="dark" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'System' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('reports the state that was pressed', async () => {
    const onChange = vi.fn()
    render(<ThemeControl preference="system" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(onChange).toHaveBeenCalledWith('light')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('still reports a press on the state already showing', async () => {
    const onChange = vi.fn()
    render(<ThemeControl preference="dark" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(onChange).toHaveBeenCalledWith('dark')
  })

  // type="button" on every one. These sit inside a header today and could sit
  // inside a form tomorrow, where a bare <button> defaults to type="submit"
  // and would submit it.
  it('never submits a form', () => {
    render(<ThemeControl preference="system" onChange={vi.fn()} />)
    for (const name of ['System', 'Light', 'Dark']) {
      expect(screen.getByRole('button', { name }).getAttribute('type')).toBe('button')
    }
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/styles/ThemeControl.dom.test.tsx`
Expected: FAIL — cannot resolve `./ThemeControl`

- [ ] **Step 3: Write the stylesheet**

Create `src/styles/ThemeControl.module.css`:

```css
/* The three-state theme switch, in the header beside the signed-in address. A
   flex row of its own so the buttons sit together and read as one control
   rather than as three unrelated links -- the same reason Board's .viewToggle
   has a rule. */
.group {
  display: flex;
  gap: var(--space-2);
}
```

- [ ] **Step 4: Write the component**

Create `src/styles/ThemeControl.tsx`:

```tsx
import { THEME_PREFERENCES, type ThemePreference } from './theme'
import styles from './ThemeControl.module.css'

// Sentence case, matching every other button in the app.
const LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

// Three buttons rather than one that cycles, and rather than a <select>. The
// argument is Board.tsx's, made there about Cards | Matrix: a single button
// that says what it will BECOME gives no indication of what is currently
// showing, and aria-pressed on a set says which one is without a person having
// to work it out from the label. Rendered from THEME_PREFERENCES so the order
// and the membership live in one place.
export function ThemeControl({
  preference,
  onChange,
}: {
  preference: ThemePreference
  onChange: (next: ThemePreference) => void
}) {
  return (
    <div aria-label="Theme" className={styles.group} role="group">
      {THEME_PREFERENCES.map((option) => (
        <button
          aria-pressed={preference === option}
          className="button button--quiet"
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/styles/ThemeControl.dom.test.tsx && npm run lint`
Expected: PASS, no lint findings.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print theme-light-dark
git add src/styles/ThemeControl.tsx src/styles/ThemeControl.module.css src/styles/ThemeControl.dom.test.tsx
git commit -m "theme: three buttons that say which one is showing"
```

---

### Task 6: Wire it into the header

**Files:**
- Modify: `src/App.tsx` (imports; call `useTheme()` above the `switch`; render `<ThemeControl>` inside `.identity` in the `active` case, lines ~64-77)
- Test: `src/App.dom.test.tsx` (create)

**Interfaces:**
- Consumes: `useTheme` (Task 4), `ThemeControl` (Task 5).
- Produces: the finished feature. Nothing depends on this task.

- [ ] **Step 1: Write the failing test**

Create `src/App.dom.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_ATTRIBUTE, THEME_KEY } from './styles/theme'

// App reaches Supabase at module scope through useSession/useProfile, so both
// hooks are stubbed. What is under test here is one thing only: that the theme
// is applied on EVERY branch, and that the control appears on exactly one.
vi.mock('./auth/useSession', () => ({
  useSession: () => ({ session: null, status: 'ready', error: null }),
}))
vi.mock('./auth/useProfile', () => ({
  useProfile: () => ({ profile: null, status: 'ready', error: null }),
}))
vi.mock('./lib/supabase', () => ({ supabase: { auth: { signOut: vi.fn() } } }))

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
  document.body.innerHTML = ''
})

describe('the theme on the signed-out screen', () => {
  // Spec §7: the theme applies everywhere, the control appears only when
  // signed in. A light flash on the way to a dark app is exactly the defect
  // the inline script exists to prevent, and it would return here if App only
  // applied the theme on the `active` branch.
  it('is applied even though there is no control to change it', async () => {
    localStorage.setItem(THEME_KEY, 'dark')
    const { default: App } = await import('./App')
    render(<App />)
    await waitFor(() => {
      expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark')
    })
    expect(screen.queryByRole('group', { name: 'Theme' })).toBe(null)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/App.dom.test.tsx`
Expected: FAIL — `expected null to be 'dark'`, because `App` does not call `useTheme` yet.

- [ ] **Step 3: Call the hook and render the control**

In `src/App.tsx`, add the imports:

```tsx
import { useTheme } from './styles/useTheme'
import { ThemeControl } from './styles/ThemeControl'
```

Call it with the other hooks, above `deriveAppState`:

```tsx
  // Called here, above the switch, rather than inside the `active` case: the
  // theme applies to every screen -- sign-in, access-pending, the database
  // error -- and only the CONTROL is limited to the signed-in header. Hooks
  // must run unconditionally anyway, and this is the reason that constraint
  // and this requirement agree.
  const { preference, setPreference } = useTheme()
```

In the `active` case, inside `<div className={styles.identity}>`, between the "Signed in as" paragraph and the Sign out button:

```tsx
              <ThemeControl onChange={setPreference} preference={preference} />
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test && npm run lint && npm run build`
Expected: PASS. 784 baseline plus this task's 1, Task 1's 6, Task 2's 13, Task 3's 5, Task 4's 4, Task 5's 5 — **818 tests across 53 files**. Build and lint clean.

- [ ] **Step 5: See the whole thing working**

Run `npm run dev` and sign in. Confirm, in order:

1. The three buttons sit in the header beside the address, and `System` is pressed.
2. Press `Dark` — the app goes dark instantly, no transition. Press `Light` with the OS in dark mode — the app goes light, which is the `:not()` guard doing its job.
3. Reload on each of the three. No flash of the wrong theme on any of them.
4. Press `System`, reload, and change the OS appearance — the app follows without a reload.
5. In dark, look at the **matrix** specifically: the band chips must still carry readable ink labels, `None yet` must still be distinguishable from `—`, and the 1px/2px grid should be checked by eye. Spec §9 flags that grid as never having been seen on a dark ground.
6. Open the month `<select>` in dark. It must be dark. If it is white, `color-scheme` is not reaching it.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print theme-light-dark
git add src/App.tsx src/App.dom.test.tsx
git commit -m "theme: the control in the header, the theme on every screen"
```

---

## After the plan

Do not push. Josh pushes from Terminal.app, and Pages deploys on push. Report the branch and the head commit, and leave the merge to him.

Spec §9 leaves three things for a look at the deployed page, none of them blocking: the matrix grid on a dark ground, the `--surface-raised` warning now recorded for both schemes, and the Slice 5 items still carried forward.
