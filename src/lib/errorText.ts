// One place that turns anything thrown, or any `{ message }` an API hands back,
// into a string that is guaranteed non-empty.
//
// Why this exists. Every failure branch in this app is guarded by a truthiness
// test — `if (loadError)`, `if (queryError)`, `profileStatus === 'error'` paired
// with an error string on screen. An empty message is falsy, so
// `setLoadError(thrown instanceof Error ? thrown.message : String(thrown))`
// could store `''`, the guard would miss it, and control would fall through to
// the "Loading…" branch and stay there. That is precisely the dead screen the
// catch was written to prevent: v1's "a broken tool looks like an empty one",
// reappearing inside the fix for it.
//
// `new Error('')` is not hypothetical: a rejected fetch, an aborted request and
// a PostgREST error with an empty `message` all produce one.

// Deliberately a sentence a non-developer can repeat down the phone, not a
// placeholder like '' or 'Error'.
const UNKNOWN = 'Unknown error (the failure gave no message)'

export function describeError(thrown: unknown): string {
  // Covers Error, PostgrestError and AuthError alike: they are not all
  // `instanceof Error` (supabase-js hands back plain objects in places), but
  // they all carry a string `message`.
  if (
    typeof thrown === 'object' &&
    thrown !== null &&
    'message' in thrown &&
    typeof (thrown as { message: unknown }).message === 'string'
  ) {
    const message = (thrown as { message: string }).message.trim()
    if (message !== '') return message
    // An object with an empty message tells us nothing further — String() on it
    // would only yield '[object Object]'. Fall through to the last resort.
    return UNKNOWN
  }

  if (typeof thrown === 'object' && thrown !== null) return UNKNOWN

  // Primitives (including a thrown string, number, null or undefined) stringify
  // usefully. `String(null)` is 'null', which is at least a fact.
  const text = String(thrown).trim()
  return text === '' ? UNKNOWN : text
}
