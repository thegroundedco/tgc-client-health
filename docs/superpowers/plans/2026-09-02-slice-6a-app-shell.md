# Slice 6a — App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the board's five navigation booleans with a four-destination app shell — Overview, Clients, Revenue, Admin — carrying the theme toggle, with every existing screen relocated under it.

**Architecture:** One discriminated union owns which destination is showing, mirroring `src/appState.ts` one layer up. A new `src/shell/` directory holds the union, the menu bar, the shell container and the two honest pages. `Board.tsx` gives up navigation entirely and keeps only the scope questions asked *within* Clients — the month, the archive toggle and the Cards/Matrix view.

**Tech Stack:** React 19, TypeScript, Vite, plain CSS with custom properties, CSS Modules, Vitest + Testing Library, jsdom.

**Spec:** `docs/superpowers/specs/2026-09-02-slice-6a-app-shell-design.md`

## Global Constraints

- **Branch:** `slice-6a-app-shell`, already created; spec committed. Do not commit to `main`. **Check `git rev-parse --abbrev-ref HEAD` before every commit** — this repository has had commits land on `main` unnoticed.
- **`src/styles/tokens.css` is the only file allowed to contain a colour literal or a typeface name.** Enforced by `tests/tokens.test.ts` (walks `.css`, `.ts`, `.tsx`, `.html`, `.svg`) and by `tests/brandLayering.test.ts`, which additionally bans `var(--brand-…)` outside that file. Components reference the SEMANTIC layer only.
- **No database change, no migration.** This slice is entirely front-end.
- **No router, no URL state.** Spec §4.1. Do not add a routing dependency.
- **`deriveAppState` stays the single place that decides what the APP is showing.** `Destination` decides only what a signed-in, active person is looking at. Do not merge them.
- **Capability gating is convenience, not security** — the database refuses the writes regardless. But it must still be correct: `admin` holds all four capabilities, `account_manager` holds everything except `manage_users`, `viewer` holds only `view_scores`.
- `npm test`, `npm run lint` and `npm run build` must all be green at the end of every task. Baseline before starting: **859 tests across 56 files.**
- Comments in this repository are discursive and explain WHY, naming the defect they prevent. Match that voice.

---

### Task 1: The destination union

**Files:**
- Create: `src/shell/destination.ts`
- Test: `src/shell/destination.test.ts`

**Interfaces:**
- Consumes: `can`, `Capability` from `src/lib/capabilities.ts`.
- Produces:
  - `type AdminSection = 'people' | 'clients'`
  - `type Destination = { kind: 'overview' } | { kind: 'clients' } | { kind: 'revenue' } | { kind: 'admin'; section: AdminSection }`
  - `type DestinationKind = Destination['kind']`
  - `const DESTINATIONS: readonly { kind: DestinationKind; label: string }[]`
  - `const LANDING: Destination`
  - `adminSections(role: string): readonly AdminSection[]`
  - `canSeeAdmin(role: string): boolean`
  - `openDestination(kind: DestinationKind, role: string): Destination | null`

- [ ] **Step 1: Write the failing test**

Create `src/shell/destination.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  adminSections,
  canSeeAdmin,
  DESTINATIONS,
  LANDING,
  openDestination,
} from './destination'

describe('the destination list', () => {
  it('is the four the owner asked for, in his order', () => {
    expect(DESTINATIONS.map((entry) => entry.kind)).toEqual([
      'overview',
      'clients',
      'revenue',
      'admin',
    ])
    expect(DESTINATIONS.map((entry) => entry.label)).toEqual([
      'Overview',
      'Clients',
      'Revenue',
      'Admin',
    ])
  })

  // Spec §3.1. Overview is the homepage and WILL be the landing destination --
  // but not while it is empty, because an empty first screen on every sign-in
  // is worse than a menu whose first item is not where the app opens. This
  // assertion is the reminder to change it deliberately rather than discover it.
  it('lands on Clients, not on the still-empty Overview', () => {
    expect(LANDING).toEqual({ kind: 'clients' })
  })
})

describe('who can see Admin', () => {
  it('gives an admin both sections', () => {
    expect(adminSections('admin')).toEqual(['people', 'clients'])
    expect(canSeeAdmin('admin')).toBe(true)
  })

  // The case a single admin-versus-viewer test would miss, and the reason
  // openDestination exists at all: an account manager holds manage_clients but
  // NOT manage_users.
  it('gives an account manager only the client roster', () => {
    expect(adminSections('account_manager')).toEqual(['clients'])
    expect(canSeeAdmin('account_manager')).toBe(true)
  })

  it('gives a viewer nothing, so the tab never appears', () => {
    expect(adminSections('viewer')).toEqual([])
    expect(canSeeAdmin('viewer')).toBe(false)
  })

  // `role` arrives from a profiles row -- a text column. Closed by default.
  it('gives an unrecognised role nothing', () => {
    expect(adminSections('pirate')).toEqual([])
    expect(canSeeAdmin('pirate')).toBe(false)
  })
})

describe('openDestination', () => {
  it('opens the three simple destinations for anybody', () => {
    for (const role of ['admin', 'account_manager', 'viewer']) {
      expect(openDestination('overview', role)).toEqual({ kind: 'overview' })
      expect(openDestination('clients', role)).toEqual({ kind: 'clients' })
      expect(openDestination('revenue', role)).toEqual({ kind: 'revenue' })
    }
  })

  // The defect this prevents: opening Admin on a hardcoded 'people' would land
  // an account manager on a section that is not theirs -- an empty screen
  // reached by a button that looked like it worked.
  it('opens Admin on the first section the person can actually see', () => {
    expect(openDestination('admin', 'admin')).toEqual({ kind: 'admin', section: 'people' })
    expect(openDestination('admin', 'account_manager')).toEqual({
      kind: 'admin',
      section: 'clients',
    })
  })

  it('refuses to open Admin for somebody with neither capability', () => {
    expect(openDestination('admin', 'viewer')).toBe(null)
    expect(openDestination('admin', 'pirate')).toBe(null)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/shell/destination.test.ts`
Expected: FAIL — cannot resolve `./destination`

- [ ] **Step 3: Write the module**

Create `src/shell/destination.ts`:

```ts
import { can } from '../lib/capabilities'

// What a signed-in, ACTIVE person is looking at. Deliberately not the same
// question as src/appState.ts's AppState, which decides what the APP is showing
// -- loading, signed out, pending, a database error, or this. Merging them would
// put "cannot reach the database" and "the revenue page" in one union, and they
// are not alternatives to each other.
//
// A union rather than the booleans this replaces. Board.tsx held five useState
// values and rendered through a sequence of early returns, so the ORDER of
// those returns was what resolved a conflict: showingClients and showingUsers
// could both be true and one silently won. Three booleans represent eight
// states, most of them nonsense, and a fourth destination would have made it
// sixteen. Here each impossible combination is a compile error instead.

export type AdminSection = 'people' | 'clients'

export type Destination =
  | { kind: 'overview' }
  | { kind: 'clients' }
  | { kind: 'revenue' }
  | { kind: 'admin'; section: AdminSection }

export type DestinationKind = Destination['kind']

// Ordered, and the order is the menu bar's reading order. The bar renders from
// this array rather than repeating the four words, the same way ThemeControl
// renders from THEME_PREFERENCES.
export const DESTINATIONS: readonly { kind: DestinationKind; label: string }[] = [
  { kind: 'overview', label: 'Overview' },
  { kind: 'clients', label: 'Clients' },
  { kind: 'revenue', label: 'Revenue' },
  { kind: 'admin', label: 'Admin' },
]

// Spec §3.1. Overview is the homepage and will be this value -- but not while it
// is still empty: making an empty page the first thing every person sees on
// every sign-in is a worse tool than the one being replaced. One line to change,
// and destination.test.ts names it so it is changed deliberately.
export const LANDING: Destination = { kind: 'clients' }

// The sections a role can actually reach, in the bar's order. Admin holds all
// four capabilities; account_manager holds everything EXCEPT manage_users;
// viewer holds only view_scores. So an account manager gets one section here,
// which is the case everything below exists to handle.
export function adminSections(role: string): readonly AdminSection[] {
  const sections: AdminSection[] = []
  if (can(role, 'manage_users')) sections.push('people')
  if (can(role, 'manage_clients')) sections.push('clients')
  return sections
}

export function canSeeAdmin(role: string): boolean {
  return adminSections(role).length > 0
}

// Null means "this person cannot go there", which the caller must treat as the
// press doing nothing rather than as an error. Returning a Destination anyway
// and letting the screen render empty is the failure this exists to prevent.
export function openDestination(
  kind: DestinationKind,
  role: string,
): Destination | null {
  switch (kind) {
    case 'overview':
      return { kind: 'overview' }
    case 'clients':
      return { kind: 'clients' }
    case 'revenue':
      return { kind: 'revenue' }
    case 'admin': {
      // The FIRST section this person can see, never a hardcoded one.
      const [first] = adminSections(role)
      return first ? { kind: 'admin', section: first } : null
    }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shell/destination.test.ts && npm run lint && npm run build`
Expected: PASS, lint and build clean.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print slice-6a-app-shell
git add src/shell/destination.ts src/shell/destination.test.ts
git commit -m "shell: one destination union, replacing five booleans"
```

---

### Task 2: The menu bar

**Files:**
- Create: `src/shell/MenuBar.tsx`, `src/shell/MenuBar.module.css`
- Test: `src/shell/MenuBar.dom.test.tsx`

**Interfaces:**
- Consumes: `DESTINATIONS`, `canSeeAdmin`, `Destination`, `DestinationKind` from Task 1.
- Produces: `<MenuBar current={Destination} role={string} onNavigate={(kind: DestinationKind) => void} />`

- [ ] **Step 1: Write the failing test**

Create `src/shell/MenuBar.dom.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MenuBar } from './MenuBar'

afterEach(() => {
  document.body.innerHTML = ''
})

const CLIENTS = { kind: 'clients' } as const

describe('MenuBar', () => {
  it('is a labelled navigation landmark', () => {
    render(<MenuBar current={CLIENTS} onNavigate={vi.fn()} role="admin" />)
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()
  })

  it('shows all four destinations to an admin', () => {
    render(<MenuBar current={CLIENTS} onNavigate={vi.fn()} role="admin" />)
    for (const label of ['Overview', 'Clients', 'Revenue', 'Admin']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  // An account manager holds manage_clients but not manage_users, so Admin is
  // still theirs -- it just opens on the one section they have.
  it('still shows Admin to an account manager', () => {
    render(<MenuBar current={CLIENTS} onNavigate={vi.fn()} role="account_manager" />)
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy()
  })

  it('hides Admin from a viewer, who has neither capability', () => {
    render(<MenuBar current={CLIENTS} onNavigate={vi.fn()} role="viewer" />)
    expect(screen.queryByRole('button', { name: 'Admin' })).toBe(null)
    expect(screen.getByRole('button', { name: 'Clients' })).toBeTruthy()
  })

  // aria-current="page" rather than aria-pressed: these are navigation, not
  // toggles, and a screen reader announces the current one without a person
  // having to work it out from the label.
  it('marks the destination currently showing, and only that one', () => {
    render(<MenuBar current={CLIENTS} onNavigate={vi.fn()} role="admin" />)
    expect(screen.getByRole('button', { name: 'Clients' }).getAttribute('aria-current')).toBe(
      'page',
    )
    for (const label of ['Overview', 'Revenue', 'Admin']) {
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-current')).toBe(null)
    }
  })

  it('marks Admin as current whichever section is open', () => {
    render(
      <MenuBar
        current={{ kind: 'admin', section: 'clients' }}
        onNavigate={vi.fn()}
        role="admin"
      />,
    )
    expect(screen.getByRole('button', { name: 'Admin' }).getAttribute('aria-current')).toBe('page')
  })

  it('reports the destination that was pressed', async () => {
    const onNavigate = vi.fn()
    render(<MenuBar current={CLIENTS} onNavigate={onNavigate} role="admin" />)
    await userEvent.click(screen.getByRole('button', { name: 'Revenue' }))
    expect(onNavigate).toHaveBeenCalledWith('revenue')
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('never submits a form', () => {
    render(<MenuBar current={CLIENTS} onNavigate={vi.fn()} role="admin" />)
    for (const label of ['Overview', 'Clients', 'Revenue']) {
      expect(screen.getByRole('button', { name: label }).getAttribute('type')).toBe('button')
    }
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/shell/MenuBar.dom.test.tsx`
Expected: FAIL — cannot resolve `./MenuBar`

- [ ] **Step 3: Write the stylesheet**

Create `src/shell/MenuBar.module.css`:

```css
/* The four destinations, in the header beside the wordmark. A flex row so they
   read as one control rather than as four unrelated links -- the same reason
   Board's .viewToggle and ThemeControl's .group each have a rule. */
.bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
```

- [ ] **Step 4: Write the component**

Create `src/shell/MenuBar.tsx`:

```tsx
import { canSeeAdmin, DESTINATIONS } from './destination'
import type { Destination, DestinationKind } from './destination'
import styles from './MenuBar.module.css'

// The four destinations, rendered from DESTINATIONS so their order and
// membership live in one place.
//
// aria-current="page" rather than aria-pressed, which is what the board's
// Cards | Matrix toggle uses. The distinction is real: that toggle switches
// between two renderings of one screen, so it is a pressed state; this moves
// between places, so it is navigation, and a <nav> landmark with a current
// entry is what a screen reader expects to find.
//
// Admin is hidden from anybody who can reach neither of its sections. Gating
// the ENTRY rather than only the screen matters: a button that opens an empty
// page is worse than no button, because the person cannot tell whether they
// lack access or the tool is broken.
export function MenuBar({
  current,
  role,
  onNavigate,
}: {
  current: Destination
  role: string
  onNavigate: (kind: DestinationKind) => void
}) {
  return (
    <nav aria-label="Sections" className={styles.bar}>
      {DESTINATIONS.filter((entry) => entry.kind !== 'admin' || canSeeAdmin(role)).map(
        (entry) => (
          <button
            aria-current={current.kind === entry.kind ? 'page' : undefined}
            className="button button--quiet"
            key={entry.kind}
            onClick={() => onNavigate(entry.kind)}
            type="button"
          >
            {entry.label}
          </button>
        ),
      )}
    </nav>
  )
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/shell/MenuBar.dom.test.tsx && npm run lint && npm run build`
Expected: PASS, lint and build clean.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print slice-6a-app-shell
git add src/shell/MenuBar.tsx src/shell/MenuBar.module.css src/shell/MenuBar.dom.test.tsx
git commit -m "shell: the menu bar, with Admin gated on reaching either section"
```

---

### Task 3: Overview and Revenue, honestly

**Files:**
- Create: `src/shell/Overview.tsx`, `src/shell/Revenue.tsx`, `src/shell/Page.module.css`
- Test: `src/shell/pages.dom.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `<Overview />` and `<Revenue />`, neither taking props.

- [ ] **Step 1: Write the failing test**

Create `src/shell/pages.dom.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Overview } from './Overview'
import { Revenue } from './Revenue'

afterEach(() => {
  document.body.innerHTML = ''
})

// Spec §6. Both pages are short and honest rather than spinners or the words
// "coming soon". A page that admits what it does not have yet is better than one
// that looks broken -- the position this codebase already takes with the boot
// fallback and the startup-error screen.
describe('Overview', () => {
  it('names itself and says its contents are still being designed', () => {
    render(<Overview />)
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(document.body.textContent).toContain('snapshot')
  })

  // Spec §6.1. Six stat lines were invented for this page once, the owner did
  // not recognise them, and they were retired as never-sourced. This test is a
  // tripwire against a second guess: if a future change fills this page, it
  // should be because the owner said what goes on it, and whoever does that
  // will have to delete this assertion deliberately.
  it('does not invent any contents', () => {
    render(<Overview />)
    expect(document.body.textContent).not.toMatch(/\d+%/)
  })
})

describe('Revenue', () => {
  it('names itself and says what it will hold', () => {
    render(<Revenue />)
    expect(screen.getByRole('heading', { name: 'Revenue' })).toBeTruthy()
    expect(document.body.textContent).toContain('churn')
  })

  // Spec §6.2. The blocker is the point of the sentence, not an apology: revenue
  // retention needs a history of monthly amounts, and one editable retainer
  // field cannot produce one. The owner will want that reminder in front of him.
  it('says plainly that revenue retention is waiting on a data model', () => {
    render(<Revenue />)
    expect(document.body.textContent).toContain('data model')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/shell/pages.dom.test.tsx`
Expected: FAIL — cannot resolve `./Overview`

- [ ] **Step 3: Write the stylesheet**

Create `src/shell/Page.module.css`:

```css
/* Shared by the two pages that have no contents yet. One rule rather than two
   identical ones, and it stays shared only while they are the same shape -- the
   moment either grows real contents it takes a stylesheet of its own. */
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: var(--measure-prose);
}
```

- [ ] **Step 4: Write the two pages**

Create `src/shell/Overview.tsx`:

```tsx
import styles from './Page.module.css'

// Spec §6.1. Deliberately empty of CONTENT, not of explanation.
//
// This page has a history worth knowing before adding anything to it: six stat
// lines were once proposed for exactly this screen, the owner did not recognise
// them when asked, and they were retired as never-sourced. Its contents are a
// conversation with him, not a guess. Do not fill this in without one.
export function Overview() {
  return (
    <section className={styles.page}>
      <h2 className="t-header">Overview</h2>
      <p className="t-body prose">
        This will be the snapshot — the few things worth seeing the moment you open the tool.
        What belongs here has not been decided yet, so it is empty on purpose rather than
        filled with a guess.
      </p>
      <p className="t-body prose">
        In the meantime, Clients has this month&rsquo;s scores and the matrix.
      </p>
    </section>
  )
}
```

Create `src/shell/Revenue.tsx`:

```tsx
import styles from './Page.module.css'

// Spec §6.2. The blocker below is the reminder the owner asked for, not an
// apology for the page being empty.
export function Revenue() {
  return (
    <section className={styles.page}>
      <h2 className="t-header">Revenue</h2>
      <p className="t-body prose">
        This will hold revenue retention, churn and how long clients stay.
      </p>
      <p className="t-body prose">
        Churn and tenure are ready to build. Revenue retention is not: it needs a data model
        that does not exist yet, and the hard part is that retention needs a history of monthly
        amounts — which a single editable retainer field cannot produce.
      </p>
    </section>
  )
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/shell/pages.dom.test.tsx && npm run lint && npm run build`
Expected: PASS, lint and build clean.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print slice-6a-app-shell
git add src/shell/Overview.tsx src/shell/Revenue.tsx src/shell/Page.module.css src/shell/pages.dom.test.tsx
git commit -m "shell: two pages that say what they are for and what they wait on"
```

---

### Task 4: Navigation moves from the board to the shell

The largest task, and one idea: the shell takes ownership of navigation and the board gives it up. Both halves must land together or the app has two navigations.

**Files:**
- Create: `src/shell/Shell.tsx`, `src/shell/Shell.module.css`, `src/shell/Admin.tsx`, `src/shell/Admin.module.css`
- Modify: `src/App.tsx` (the `active` branch), `src/App.module.css` (loses all but `.centred`)
- Modify: `src/board/Board.tsx` (loses `showingClients`, `showingUsers`, `adminLink`, `usersLink` and two early returns), `src/board/Board.module.css` (loses `.adminLink`)
- Test: `src/shell/Shell.dom.test.tsx` (create); `src/board/Board.test.tsx` (delete one describe block, Step 6b); `src/App.dom.test.tsx` must still pass unchanged

**Interfaces:**
- Consumes: `Destination`, `DestinationKind`, `LANDING`, `openDestination`, `adminSections` (Task 1); `MenuBar` (Task 2); `Overview`, `Revenue` (Task 3); `Board`, `ClientsAdmin`, `UsersAdmin`, `ThemeControl`.
- Produces: `<Shell profile={Profile} preference={ThemePreference} onThemeChange={(next) => void} onSignOut={() => void} />`

- [ ] **Step 1: Write the failing test**

Create `src/shell/Shell.dom.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Shell } from './Shell'
import type { Profile } from '../auth/useProfile'

// The board reaches Supabase, and this file is about navigation rather than
// about the board. Stubbed to a fixed, harmless screen so a failed fetch cannot
// masquerade as a navigation failure.
vi.mock('../board/Board', () => ({ Board: () => <p>the board</p> }))
vi.mock('../clients/ClientsAdmin', () => ({ ClientsAdmin: () => <p>client roster</p> }))
vi.mock('../users/UsersAdmin', () => ({ UsersAdmin: () => <p>people and access</p> }))

afterEach(() => {
  document.body.innerHTML = ''
})

function profile(role: string): Profile {
  return {
    id: 'p1',
    email: 'josh@thegroundedcompany.com',
    role,
    is_active: true,
  } as Profile
}

function renderShell(role = 'admin') {
  return render(
    <Shell
      onSignOut={vi.fn()}
      onThemeChange={vi.fn()}
      preference="light"
      profile={profile(role)}
    />,
  )
}

describe('the shell', () => {
  // Spec §3.1: Clients, not Overview, while Overview is empty.
  it('lands on Clients', () => {
    renderShell()
    expect(screen.getByText('the board')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clients' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('carries the identity, the theme control and sign out', () => {
    renderShell()
    expect(document.body.textContent).toContain('josh@thegroundedcompany.com')
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('moves between destinations', async () => {
    renderShell()
    await userEvent.click(screen.getByRole('button', { name: 'Revenue' }))
    expect(document.body.textContent).toContain('data model')
    await userEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(document.body.textContent).toContain('snapshot')
    await userEvent.click(screen.getByRole('button', { name: 'Clients' }))
    expect(screen.getByText('the board')).toBeTruthy()
  })

  it('opens Admin on People for an admin, who can see both sections', async () => {
    renderShell('admin')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.getByText('people and access')).toBeTruthy()
  })

  // The case the whole of openDestination exists for.
  it('opens Admin on the client roster for an account manager', async () => {
    renderShell('account_manager')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.getByText('client roster')).toBeTruthy()
    expect(screen.queryByText('people and access')).toBe(null)
  })

  it('offers an admin both sections and lets them switch', async () => {
    renderShell('admin')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clients roster' }))
    expect(screen.getByText('client roster')).toBeTruthy()
  })

  // An account manager has one section, so a switcher would be a control with
  // nothing to control -- the same argument Board.tsx makes about not drawing
  // the view toggle on an empty roster.
  it('draws no section switcher when there is only one section', async () => {
    renderShell('account_manager')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.queryByRole('button', { name: 'Clients roster' })).toBe(null)
  })

  it('never shows Admin to a viewer', () => {
    renderShell('viewer')
    expect(screen.queryByRole('button', { name: 'Admin' })).toBe(null)
  })

  // Carried over from Board.test.tsx's `reaching the clients admin`, which this
  // slice deletes (Step 6b). Those tests encoded a real requirement in their
  // names -- "which is when it is needed most", "so the screen is not a dead
  // end" -- and the requirement outlives the four copies of adminLink that used
  // to satisfy it. The bar is drawn by the shell, ABOVE whatever the destination
  // renders, so it survives a board that is empty or broken by construction
  // rather than by repetition. Asserted here so that stays true.
  it('draws the bar above the destination, whatever the destination does', () => {
    renderShell()
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy()
  })

  // Spec §4: new behaviour, and worth pinning. The check-in screen used to
  // return before the navigation was even defined, so Back was the only way out
  // of it. Board renders inside the shell's <main>, so its early return replaces
  // only its own output and the bar stays -- which is safe specifically because
  // draftCache.ts writes every keystroke to local storage as it happens.
  it('keeps the bar reachable while the board shows a sub-screen', () => {
    renderShell()
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()
    expect(screen.getByText('the board')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/shell/Shell.dom.test.tsx`
Expected: FAIL — cannot resolve `./Shell`

- [ ] **Step 3: Write the Admin section view**

Create `src/shell/Admin.module.css`:

```css
/* The switcher between Admin's two sections. Same shape as Board's .viewToggle,
   which it is deliberately imitating. */
.sections {
  display: flex;
  gap: var(--space-2);
  padding-block-end: var(--space-4);
}
```

Create `src/shell/Admin.tsx`:

```tsx
import { ClientsAdmin } from '../clients/ClientsAdmin'
import { UsersAdmin } from '../users/UsersAdmin'
import { adminSections } from './destination'
import type { AdminSection } from './destination'
import styles from './Admin.module.css'

// Admin's two sections behind one destination. They were two independent
// booleans on the board -- showingClients and showingUsers -- which could both
// be true, with the order of two early returns silently deciding the winner.
// One section value cannot disagree with itself.
//
// The switcher is drawn only when there is something to switch BETWEEN. An
// account manager holds manage_clients and not manage_users, so they have one
// section, and a switcher offering one choice is a control with nothing to
// control -- the same argument Board.tsx makes about not drawing the view
// toggle on an empty roster.
//
// aria-pressed rather than aria-current here, unlike MenuBar: this switches
// between two renderings WITHIN one destination, which is the board's
// Cards | Matrix situation rather than a navigation one.
export function Admin({
  section,
  role,
  onSection,
  onLeave,
  currentUserId,
}: {
  section: AdminSection
  role: string
  onSection: (next: AdminSection) => void
  onLeave: () => void
  currentUserId: string
}) {
  const sections = adminSections(role)
  const LABELS: Record<AdminSection, string> = {
    people: 'People',
    clients: 'Clients roster',
  }

  return (
    <>
      {sections.length > 1 ? (
        <div aria-label="Admin section" className={styles.sections} role="group">
          {sections.map((entry) => (
            <button
              aria-pressed={section === entry}
              className="button button--quiet"
              key={entry}
              onClick={() => onSection(entry)}
              type="button"
            >
              {LABELS[entry]}
            </button>
          ))}
        </div>
      ) : null}

      {section === 'people' ? (
        <UsersAdmin currentUserId={currentUserId} onBack={onLeave} />
      ) : (
        <ClientsAdmin onBack={onLeave} />
      )}
    </>
  )
}
```

- [ ] **Step 4: Write the shell**

Create `src/shell/Shell.module.css` by MOVING these five rules out of `src/App.module.css` verbatim — `.shell`, `.header`, `.wordmark`, `.identity`, `.content` — and adding this header comment above them:

```css
/* The shell every signed-in screen sits inside. Moved here from App.module.css
   when the shell became its own component: App keeps only .centred, which is
   what its loading and failure branches use, so each file now holds the rules
   its own component draws. */
```

`.header` gains one declaration so the menu bar sits between the wordmark and the identity rather than wrapping oddly:

```css
  /* The bar sits in the middle. Without this the three groups distribute
     evenly and the menu drifts away from the wordmark it belongs to. */
  row-gap: var(--space-3);
```

Create `src/shell/Shell.tsx`:

```tsx
import { useState } from 'react'
import type { Profile } from '../auth/useProfile'
import { Board } from '../board/Board'
import { ThemeControl } from '../styles/ThemeControl'
import type { ThemePreference } from '../styles/theme'
import { Admin } from './Admin'
import { MenuBar } from './MenuBar'
import { Overview } from './Overview'
import { Revenue } from './Revenue'
import { LANDING, openDestination } from './destination'
import type { AdminSection, Destination, DestinationKind } from './destination'
import styles from './Shell.module.css'

// What a signed-in, active person is looking at, and the chrome around it.
//
// The navigation that used to live in Board.tsx lives here, and that is the
// point of the slice: the board is a view again rather than a view AND the
// application's navigation host.
//
// One consequence worth knowing. Each destination is rendered conditionally, so
// leaving Clients unmounts the board and returning remounts it -- which means
// useBoard re-fetches. That is deliberate rather than tolerated: it is why
// ClientsAdmin no longer needs to ask the board to reload on the way out, since
// coming back IS a reload. The cost is a round trip per visit, which is the same
// cost the board already pays on every page load.
export function Shell({
  profile,
  preference,
  onThemeChange,
  onSignOut,
}: {
  profile: Profile
  preference: ThemePreference
  onThemeChange: (next: ThemePreference) => void
  onSignOut: () => void
}) {
  const [destination, setDestination] = useState<Destination>(LANDING)

  // A press that cannot go anywhere does nothing, rather than navigating to a
  // screen the person cannot use. MenuBar already hides Admin from anybody in
  // that position, so this is the second of the two guards -- and the one that
  // still holds if the bar is ever changed.
  function navigate(kind: DestinationKind) {
    const next = openDestination(kind, profile.role)
    if (next) setDestination(next)
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.wordmark}>
          <p className="t-eyebrow">The Grounded Company</p>
          <h1 className="t-header">Client Health</h1>
        </div>
        <MenuBar current={destination} onNavigate={navigate} role={profile.role} />
        <div className={styles.identity}>
          {/* Labelled, not a bare address. Without the label a screen reader
              announces an email address next to a Sign out button and leaves
              the listener to guess the relationship. */}
          <p className="t-caption">Signed in as {profile.email}</p>
          <ThemeControl onChange={onThemeChange} preference={preference} />
          <button className="button button--quiet" onClick={onSignOut} type="button">
            Sign out
          </button>
        </div>
      </header>
      <main className={styles.content}>
        {destination.kind === 'overview' && <Overview />}
        {destination.kind === 'clients' && <Board profile={profile} />}
        {destination.kind === 'revenue' && <Revenue />}
        {destination.kind === 'admin' && (
          <Admin
            currentUserId={profile.id}
            onLeave={() => navigate('clients')}
            onSection={(section: AdminSection) =>
              setDestination({ kind: 'admin', section })
            }
            role={profile.role}
            section={destination.section}
          />
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 5: Point App.tsx at the shell**

In `src/App.tsx`, replace the whole `case 'active':` block with:

```tsx
    case 'active':
      return (
        <Shell
          onSignOut={() => void supabase.auth.signOut()}
          onThemeChange={setPreference}
          preference={preference}
          profile={state.profile}
        />
      )
```

Add `import { Shell } from './shell/Shell'` and remove the now-unused `Board` and `ThemeControl` imports. **Leave `useTheme()` where it is, above the switch** — the theme must apply to the signed-out and error screens too, which is what `src/App.dom.test.tsx` asserts.

Then delete `.shell`, `.header`, `.wordmark`, `.identity` and `.content` from `src/App.module.css`, keeping `.centred` and its comment.

- [ ] **Step 6: Take the navigation out of the board**

In `src/board/Board.tsx`, delete:

- the `showingClients` and `showingUsers` `useState` lines and their comments,
- the `if (showingClients)` and `if (showingUsers)` early returns,
- the `adminLink` and `usersLink` definitions and their comments,
- every `{adminLink}` and `{usersLink}` in the four render branches,
- the now-unused `can`, `ClientsAdmin` and `UsersAdmin` imports.

Keep everything else, including the `if (selected)` early return — the check-in is a sub-state of Clients (spec §4) and stays here.

Replace the deleted `adminLink` comment block with this note above the remaining state:

```tsx
  // Navigation left this file in Slice 6a. adminLink and usersLink used to be
  // defined above the early returns and repeated in all four render branches,
  // because a failed read and an empty roster are exactly when somebody needs
  // to reach the admin screens. The menu bar in the shell is always drawn, so
  // that requirement is now met by structure rather than by four copies.
```

In `src/board/Board.module.css`, delete the `.adminLink` rule and its comment.

- [ ] **Step 6b: Delete the navigation tests that no longer describe the board**

`src/board/Board.test.tsx` contains `describe('reaching the clients admin')` — **7 tests**, at
roughly lines 297-376 — which assert buttons named `Clients` and `People` inside the board, and
exercise the two early returns Step 6 deletes. **Delete that entire describe block.**

This is the one place this task deliberately changes an existing suite, and it is not a loss of
coverage: the behaviour genuinely left this file. Capability gating is covered by
`MenuBar.dom.test.tsx` (Task 2) and section selection by `Shell.dom.test.tsx` (Step 1), which is
where those questions now live.

Two of the seven encoded a requirement in their names rather than only a behaviour — *"offers the
link when the board is empty, which is when it is needed most"* and *"offers the link when the read
failed, so the screen is not a dead end"*. That requirement is real and outlives the four copies of
`adminLink` that used to satisfy it. Step 1's `draws the bar above the destination, whatever the
destination does` is its replacement. Confirm that test exists before deleting these.

Leave the other four describe blocks in the file alone. `the loaded client grid`, `the board`,
`the show-archived toggle` and `the Cards | Matrix toggle` are all about the board itself and must
still pass unchanged.

- [ ] **Step 7: Run the whole suite**

Run: `npm test && npm run lint && npm run build`
Expected: PASS. From an 859 baseline: **+9** (Task 1), **+8** (Task 2), **+4** (Task 3), **+11**
(this task's Shell tests), **−7** (the describe block deleted in Step 6b) = **884 tests**.

Every OTHER existing suite must pass untouched. `Board.test.tsx` losing exactly those 7 is expected;
any other failure means a screen was changed rather than relocated, which this task must not do.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print slice-6a-app-shell
git add src/shell/Shell.tsx src/shell/Shell.module.css src/shell/Admin.tsx src/shell/Admin.module.css src/shell/Shell.dom.test.tsx src/App.tsx src/App.module.css src/board/Board.tsx src/board/Board.module.css
git commit -m "shell: navigation moves out of the board"
```

---

### Task 5: Add client, from the Clients tab

**Files:**
- Create: `src/clients/AddClientPanel.tsx`
- Modify: `src/board/Board.tsx` (the period bar and the empty-roster branch)
- Test: `src/clients/AddClientPanel.dom.test.tsx` (create); `src/board/Board.test.tsx` (append — the existing file, no `.dom` segment)

**Interfaces:**
- Consumes: `useClients` (existing — returns `owners`, `addState`, `addClient`, `resetAdd` among others), `AddClientForm` (existing — takes `owners`, `state`, `onAdd`, `onEdited`), `can` from capabilities.
- Produces: `<AddClientPanel onClose={() => void} />`

- [ ] **Step 1: Write the failing test**

Create `src/clients/AddClientPanel.dom.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddClientPanel } from './AddClientPanel'

// useClients reaches Supabase on mount. Stubbed to the four things the form
// actually consumes, so this file tests the panel rather than the network.
vi.mock('./useClients', () => ({
  useClients: () => ({
    owners: [{ id: 'p1', label: 'Josh' }],
    addState: { kind: 'idle' },
    addClient: vi.fn(),
    resetAdd: vi.fn(),
  }),
}))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('AddClientPanel', () => {
  it('shows the same add form the admin screen uses', () => {
    render(<AddClientPanel onClose={vi.fn()} />)
    expect(screen.getByLabelText(/name/i)).toBeTruthy()
  })

  // The panel is mounted only while it is open, and that is the whole reason it
  // is a component rather than a branch inside Board: useClients fetches on
  // mount, and a hook cannot be called conditionally. Mounting on demand is what
  // keeps the Clients tab from paying for a form nobody opened.
  it('closes when asked', async () => {
    const onClose = vi.fn()
    render(<AddClientPanel onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/clients/AddClientPanel.dom.test.tsx`
Expected: FAIL — cannot resolve `./AddClientPanel`

- [ ] **Step 3: Write the panel**

Create `src/clients/AddClientPanel.tsx`:

```tsx
import { AddClientForm } from './AddClientForm'
import { useClients } from './useClients'

// The add form, on the Clients tab, so the commonest management action sits
// where the hand reaches for it -- owner, 2026-09-02. The full roster stays in
// Admin; this is the one action lifted out of it.
//
// A component rather than a branch inside Board, and that is not a style
// choice: useClients fetches on mount and a hook cannot be called
// conditionally, so putting it in Board would make every visit to the Clients
// tab pay for a form nobody opened. Mounted on demand, it costs nothing until
// somebody presses the button.
//
// It reuses AddClientForm rather than reimplementing it, so the two entry points
// cannot disagree about what adding a client means -- including the validation
// and the confirmation behaviour that form already gets right.
export function AddClientPanel({ onClose }: { onClose: () => void }) {
  const admin = useClients()
  return (
    <section>
      <AddClientForm
        onAdd={admin.addClient}
        onEdited={admin.resetAdd}
        owners={admin.owners}
        state={admin.addState}
      />
      {/* "Done" rather than "Cancel": the form may have added several clients by
          now, and calling the way out "Cancel" would suggest closing undoes
          them. Closing is also what re-reads the board -- see Board.tsx. */}
      <button className="button button--quiet" onClick={onClose} type="button">
        Done
      </button>
    </section>
  )
}
```

- [ ] **Step 4: Run the panel's tests**

Run: `npx vitest run src/clients/AddClientPanel.dom.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing test for the button on the board**

The file is **`src/board/Board.test.tsx`** — it already exists, already carries
`// @vitest-environment jsdom`, and already mocks `../lib/supabase`, `./useBoard` and
`../clients/useClients`. Do not create `Board.dom.test.tsx`; this repository named this one without
the `.dom` segment and a second file would split the board's tests across two.

It provides two things to reuse rather than rebuild:

- `PROFILE`, a complete `Profile` fixture whose role is `account_manager`
- `given(state?: Partial<UseBoard>)`, which mocks `useBoard` and renders `<Board profile={PROFILE} />`

`given()` always renders as `PROFILE`, so the two role cases below render directly instead, exactly
as the file's existing role tests do. Append:

```tsx
describe('adding a client from the Clients tab', () => {
  it('offers the button to an account manager, who can manage clients', () => {
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={PROFILE} />)

    expect(screen.getByRole('button', { name: 'Add client' })).toBeTruthy()
  })

  // Convenience, not security -- spec §7.2. A viewer who reached the form anyway
  // has the insert refused by clients_insert_manage_clients. The button is
  // hidden because a control that always fails is worse than no control.
  it('does not draw it for a viewer', () => {
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={{ ...PROFILE, role: 'viewer' }} />)

    expect(screen.queryByRole('button', { name: 'Add client' })).toBeNull()
  })

  it('reveals the form when pressed', async () => {
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={PROFILE} />)

    await userEvent.click(screen.getByRole('button', { name: 'Add client' }))
    expect(screen.getByLabelText(/name/i)).toBeTruthy()
  })

  // The empty roster is exactly when somebody needs to add a client, which is
  // why the button is defined above the early returns rather than inside the
  // populated branch. The same argument the deleted adminLink comment made.
  it('offers it when the roster is empty, which is when it is needed most', () => {
    given({ clients: [], activeTotal: 0 })

    expect(screen.getByRole('button', { name: 'Add client' })).toBeTruthy()
  })
})
```

`READY` is the ready-state fixture already declared in that file (around line 115) and used by the
role tests Step 6b deletes. Reuse it; do not declare a second one.

- [ ] **Step 6: Add the button to the board**

In `src/board/Board.tsx`, add `const [adding, setAdding] = useState(false)` beside the other view state, restore the `can` import, and define:

```tsx
  // Gated on manage_clients, like the admin screen this form also lives on.
  // Defined above the early returns and included in the empty-roster branch as
  // well as the populated one: a board with no clients is exactly when somebody
  // needs to add one.
  const addClient = can(profile.role, 'manage_clients') ? (
    adding ? (
      <AddClientPanel
        onClose={() => {
          setAdding(false)
          // Re-read on the way out, so a client added here appears on the board
          // immediately. Same reasoning as ClientsAdmin's onBack: without it the
          // board shows what it read before the add, which is the same picture
          // as an add that did nothing.
          board.reload()
        }}
      />
    ) : (
      <button className="button button--quiet" onClick={() => setAdding(true)} type="button">
        Add client
      </button>
    )
  ) : null
```

Render `{addClient}` inside `.periodBar` in the populated branch, and directly after the "Add one on the client admin screen to see it here." paragraph in the empty-roster branch. Change that sentence to read `Add one to see it here.` — it now points at a button on the same screen rather than at another one.

- [ ] **Step 7: Run the whole suite**

Run: `npm test && npm run lint && npm run build`
Expected: PASS. 884 after Task 4, plus this task's 2 panel tests and 4 board tests = **890 tests**.

- [ ] **Step 8: See it**

Run `npm run dev`, sign in, and confirm: the four destinations move; Admin opens on People as an admin; Add client reveals the form and a client added appears on the board on Done; the theme pill still works from the bar.

- [ ] **Step 9: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print slice-6a-app-shell
git add src/clients/AddClientPanel.tsx src/clients/AddClientPanel.dom.test.tsx src/board/Board.tsx src/board/Board.test.tsx
git commit -m "shell: add a client from the tab where you are looking at them"
```

---

## After the plan

Do not push. Report the branch and head commit; the owner merges and pushes, and Pages deploys on push.

Carried forward from the spec's §10, none of them this slice's work: `started_on` is optional and probably should not be; `paused` is a production status that appears in no spec; Overview's contents need the owner; the revenue data model is still owed; and the §9 grid inversion in dark is still the owner's call.
