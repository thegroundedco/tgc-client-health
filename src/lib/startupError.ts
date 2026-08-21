import { describeError } from './errorText'

// Makes a failed start visible ON THE PAGE.
//
// The failure this exists for. `readSupabaseConfig` throws when
// VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY is missing, and it is
// evaluated at module load in the BROWSER, from src/lib/supabase.ts. `vite
// build` only inlines `import.meta.env.*` — it never reads them — so a missing
// or misspelled GitHub Actions secret cannot fail the build. CI goes green, the
// deploy succeeds, and the shipped bundle throws on load. The throw kills the
// module graph before React mounts, `#root` stays empty, and the entire
// diagnosis lives in the browser console.
//
// That is the single most likely first-deploy mistake, and left alone it
// produces the least diagnosable outcome available: a blank white page. It is
// also v1's defining failure — "a broken tool looks like an empty one" — in a
// new costume. So the error gets a surface a non-developer will actually see,
// naming the setting and the two places it is configured.
//
// This does NOT soften the throw. `readSupabaseConfig` still throws, main.tsx
// still re-throws after rendering, and the console still gets the original
// error. This only adds a place for a human to read it.

export type StartupError = {
  title: string
  /** The raw failure text, for whoever can act on it. Never empty. */
  detail: string
  /** What to do, in order, written for someone who will not open a console. */
  steps: string[]
}

// The two settings `readSupabaseConfig` can complain about. Listed here rather
// than pattern-matched on /VITE_[A-Z_]+/ so the advice below can name the
// dashboard and the file that each one comes from, and so a new required
// setting has to be added deliberately.
const REQUIRED_SETTINGS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']

export function startupError(thrown: unknown): StartupError {
  const detail = describeError(thrown)
  const named = REQUIRED_SETTINGS.filter((name) => detail.includes(name))

  if (named.length === 0) {
    return {
      title: 'TGC Client Health could not start',
      detail,
      steps: [
        'Nothing has been lost: this happened before the app read or wrote anything.',
        'Reload the page once. If the same message comes back, send the line above to whoever maintains the app — it is the whole diagnosis.',
      ],
    }
  }

  return {
    title: 'A required setting is missing, so the app cannot start',
    detail,
    steps: [
      `The setting ${named.join(' and ')} did not reach the app, so it has no ` +
        'address or key for its database. Your data is untouched — the app ' +
        'never got far enough to read it.',
      'On the published page (thegroundedco.github.io/tgc-client-health): open ' +
        'the repository on GitHub → Settings → Secrets and variables → Actions, ' +
        'and check that VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY ' +
        'both exist, spelled exactly like that. Fix or add the missing one, ' +
        'then open the Actions tab and re-run the "deploy" workflow. The values ' +
        'come from Supabase → Project Settings → API.',
      'Running it on your own machine: copy .env.example to .env.local, fill in ' +
        'both values from Supabase → Project Settings → API, and restart ' +
        '`npm run dev`. Vite only reads that file at start-up.',
    ],
  }
}

// Written with createElement and textContent rather than innerHTML: the detail
// string comes from a thrown value, and this runs at a moment when nothing else
// in the app is working, which is the worst possible time to be injecting
// markup.
export function renderStartupError(container: Element, thrown: unknown): void {
  const { title, detail, steps } = startupError(thrown)
  const doc = container.ownerDocument

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

  container.replaceChildren(main)
}
