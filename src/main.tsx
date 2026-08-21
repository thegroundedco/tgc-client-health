import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderStartupError } from './lib/startupError'

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing <div id="root">')

// `import('./App')`, not a static `import App from './App'`, and the difference
// is the whole point of this file.
//
// App.tsx pulls in src/lib/supabase.ts, which calls readSupabaseConfig() at
// module scope and throws when VITE_SUPABASE_URL or
// VITE_SUPABASE_PUBLISHABLE_KEY is missing — the shape of a mistyped GitHub
// Actions secret, which no build step can catch. Static imports are evaluated
// BEFORE any statement in this module runs, so a try/catch written around
// createRoot() would never see that throw: the page would just stay blank. A
// dynamic import moves the evaluation inside a promise this file can catch,
// which is what turns a blank white page into a message naming the setting.
void import('./App')
  .then(({ default: App }) => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  .catch((thrown: unknown) => {
    renderStartupError(root, thrown)
    // Re-thrown on purpose. The message on screen is an ADDITION, not a
    // replacement: the console, the network tab and anything watching for
    // unhandled rejections must still see the original error, unswallowed.
    throw thrown
  })
