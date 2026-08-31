import type { Band } from '../lib/scoreMath.ts'

// This mapping used to live in Board.tsx, exported alongside the Board
// component. oxlint's only-export-components rule flagged that: React Fast
// Refresh only preserves component state across an edit when a file exports
// nothing but components, so exporting BAND_CLASSES/bandClassName next to
// Board meant editing Board.tsx during development would full-reload instead
// of hot-swapping. The rule's own message says the fix is a new file — this
// is that file.
//
// It also fixes a second problem: the brief that first wrote this had the
// check-in screen (next slice) import bandClassName from Board.tsx, which
// makes one screen depend on another. Every future reuse would have made
// that dependency worse.
//
// Lives in src/styles/, not src/lib/scoreMath.ts, even though BAND_LABELS in
// scoreMath.ts is a structurally identical Record<Band, string> and the
// parallel is tempting. scoreMath.ts is domain logic — what a band IS. This is
// presentation vocabulary — which CSS class a band renders as — and the
// classes it names are declared in src/styles/base.css, its neighbour here.
// Renaming a band class in base.css means changing this file, not scoreMath.
// Do not "tidy" this into scoreMath.ts: that would couple scoring to the
// stylesheet.
//
// BAND_CLASSES is deliberately not exported: nothing outside this module
// needs the raw mapping, only the string bandClassName produces. Keeping it
// private is what makes the Record<Band, string> below a compile error the
// moment a Band is added to scoreMath.ts without a matching entry here, rather
// than a mapping something else could reach around and use incorrectly.
const BAND_CLASSES: Record<Band, string> = {
  healthy: 'band--healthy',
  watch: 'band--watch',
  at_risk: 'band--risk',
  incomplete: 'band--none',
}

export function bandClassName(band: Band): string {
  return `band ${BAND_CLASSES[band]}`
}
