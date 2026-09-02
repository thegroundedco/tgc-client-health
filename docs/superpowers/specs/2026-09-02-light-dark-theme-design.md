# Light and dark theme

Source: the owner, asked directly on 2026-09-01 and confirmed 2026-09-02. He asked for a dark
theme, and chose **follow the OS with a manual override** — three states, `system` / `light` /
`dark` — with the choice **persisted**.

That persistence is a deliberate exception to this screen's standing rule that no view state
survives a reload. The month, the archive toggle and the Cards/Matrix switch all reset on purpose,
because they are questions about *the data* and a stale answer to one of those is a lie about what
you are looking at. A theme is not a question about the data. It is a property of the room the
person is sitting in, and re-asking it on every load is the failure, not the fix.

This is not a numbered slice. It is a design pass over `tokens.css` plus one new control, and it
sits between Slice 5 and Slice 6.

## 1. What is in this, and what is not

**In.** A dark palette. The three-state preference, persisted per browser. One control, in the
signed-in header. `color-scheme`, so the platform's own widgets follow. The contrast measurements
for every new value, in the file, beside the value.

**Not in.** No database change, no migration, nothing that touches production data — this ships
entirely in the bundle. No per-account sync (§7). No change to the band fills themselves (§3). No
new screens, and no revisiting of Slice 5's matrix beyond the tokens it already consumes.

**Explicitly not in: a transition.** Cross-fading a whole palette costs a `transition` on
properties that are painted on every element in the app, and buys a quarter-second of prettiness on
an action taken perhaps twice a year. The switch is instant.

## 2. Paper and ink are roles, not lightnesses

The existing file is already built for this and nobody noticed, which is the happiest finding in
this document.

`tokens.css` has three layers: BRAND (identity), FUNCTIONAL (meaning without identity), SEMANTIC
(what components reference, containing no literals). The two names carrying the whole light theme
are `--brand-paper` and `--brand-ink`. Read them as *lightnesses* and a dark theme is a rewrite.
Read them as *roles* — paper is the ground, ink is the mark — and a dark theme is a change of
value with no change of meaning. The paper is dark at night. The ink is light on it. Every semantic
token above them keeps working:

- `--action-face: var(--brand-ink)` becomes a light button face,
- `--action-text: var(--brand-paper-raised)` becomes dark text on it — **12.74:1**,
- `--focus-ring: var(--brand-ink)` becomes a light ring — **14.22:1** on the page.

The button inverts correctly without one semantic token being touched. That is what the layering
was for, and this is the first time it has been asked to prove it.

So: **dark overrides the BRAND layer only.** Two alternatives were considered and rejected.
Overriding the SEMANTIC layer instead would double it and re-open the "no literals below brand"
rule that `tokenRules.ts` exists to enforce. A separate `darkTokens.css` would break the one-file
palette promise and `tokenRules.ts`'s single-exemption model, which is a real cost for no gain.

## 3. The three pins — where the inheritance is wrong

Three tokens must **not** follow their brand parent into dark. Each was found by measurement, not
by reading, and each is a latent coupling that only a second scheme exposes.

### 3.1 `--text-on-band`

It reads `var(--brand-ink)`. If ink flips light, every health chip loses its label:

| label on | flipped ink `#F2ECDA` | pinned `#1F1F1F` |
|---|---|---|
| teal | **1.72:1** | 8.13:1 |
| amber | **1.83:1** | 7.64:1 |
| red | **3.03:1** | 4.61:1 |

That is the health encoding failing silently — the chips would still be there, still the right
colour, and unreadable. Parent spec §9.3 already establishes that a band's text label is
load-bearing rather than decorative, because the fills are indistinguishable from one another
(teal vs amber 1.06:1). A theme that erases the label erases the meaning.

So the brand block gains `--brand-ink-fixed: #1F1F1F`, which never flips, and `--text-on-band`
points at it. In light this is the same value it resolves to today: **zero visual change.**

### 3.2 `--band-none`

It reads `var(--brand-rule)`. In dark, `--brand-rule` becomes `#4A443A` and ink on it measures
**1.71:1**.

This one is worth stating plainly, because it is a design defect the light theme could not reveal.
A hairline grey and a light band fill are *different jobs* that happen to be the same colour on
paper. `--band-none` belongs to the band system — light fill, dark ink label — and every other
member of that system (teal, amber, red) is a light fill that does not flip. It was borrowing the
rule colour by coincidence.

So the brand block gains `--brand-stone: #CFC8B6`, which never flips, and `--band-none` points at
it: ink on it measures **9.88:1**, and it separates from the dark page at **10.07:1**. It carries
the same literal as `--brand-rule` and that is not a duplicate to be tidied away — it is two jobs
that coincide in one scheme and diverge in the other. Merging them back is how this defect returns.

### 3.3 `--brand-red-dark` is renamed `--brand-red-legible`

The token exists because brand red measures 3.34:1 on paper and fails as text. Its dark-theme
counterpart is *lighter* — `#FF6B60`, **6.02:1** on the dark ground — so "dark" would be false in
half the file. "Legible" is what the token has always meant: adjusted until it passes. True in both
schemes.

A pleasing inversion falls out of this. Brand red `#F9423A`, which fails as text on paper and
forced this token into existence, **passes on the dark ground at 4.69:1**, while `#B82B25` fails
there at **2.73:1**. The compromise and the true colour swap places.

The rename touches `--alert-text` in `tokens.css` and two comments — `src/board/Matrix.module.css`
line 317 and the brand block's own note. No component references it; the layering held.

## 4. The mechanism

Light literals stay **byte for byte as they are.** Every one carries a measurement made on
2026-08-21 and there is no reason to disturb a measured value. The brand block gains a `--dark-*`
set beside them, and two guard blocks repoint the seven tokens that move:

```css
:root {
  color-scheme: light;
  /* existing light literals, untouched */
  /* + --dark-paper, --dark-paper-raised, --dark-paper-sunken,
       --dark-ink, --dark-ink-muted, --dark-rule, --dark-red-legible */
  /* + --brand-ink-fixed, --brand-stone — pinned, never flip */
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) { color-scheme: dark; /* seven repointings */ }
}

:root[data-theme='dark'] { color-scheme: dark; /* the same seven */ }
```

The `:not([data-theme='light'])` guard is what makes the manual override win in **both**
directions: without it, a person on a dark-preferring OS who chooses Light gets the media query
anyway.

The dark literals appear **once**; the two blocks contain only `--brand-x: var(--dark-x)`
repointings, so they cannot drift in value. They can still drift in *membership* — someone adds an
eighth token to one block and not the other — so §6 tests that.

**`color-scheme` follows the same three-block shape**, and it is not decoration. It is what makes
the month `<select>`, the scrollbars and the focus rings the platform draws follow the theme. Its
absence is why a dark theme applied only to our own CSS still has a white dropdown in the middle of
it. It lives in `tokens.css` beside the blocks it must stay in step with, not in `base.css`.

### 4.1 `light-dark()` was considered and rejected

`light-dark(#FBF7EB, #201D18)` would collapse this to one declaration per token, remove the
duplicate block entirely, and make `color-scheme` the single switch. It is well past Baseline.

It is rejected on **failure mode**. On a browser that does not support it, the custom property is
invalid at computed-value time and resolves to `unset` — not a wrong colour, an *absent* one, on
every token at once. This is the codebase whose `index.html` carries a boot fallback, a
five-second slow-load warning and a startup-error screen, on the stated principle that a tool whose
premise is boring reliability must never show a blank page. A palette that can evaporate is against
that grain. The duplicated block is uglier and cannot fail that way.

Revisit when the oldest browser in the agency is comfortably past the support line and the
`@supports` guard can simply be dropped.

## 5. The flash, and the inline script

`main.tsx` mounts React through a **dynamic** `import('./App')`, and that is deliberate — it is
what turns a missing environment variable into a message instead of a blank page. The cost here is
that the mount is late. An attribute set by React would leave someone who chose Dark looking at a
light page for the whole bundle fetch.

The `system` state needs no JavaScript at all: `@media (prefers-color-scheme: dark)` is in a
stylesheet linked in `<head>` and is correct on the first paint. Only the **override** needs help.

So `<head>` gains a small classic inline script, after the two stylesheet links, that reads the
stored preference and stamps `data-theme` on `document.documentElement` before first paint. There
is precedent in this exact file: the boot-slow timer is already a classic inline script, chosen so
it survives the bundle failing to load.

It is wrapped in `try`/`catch`. Safari in private browsing throws on the property access, not only
on quota, and `draftCache.ts` already treats that as a normal outcome rather than an error. A theme
preference that cannot be read is simply `system`.

Two constraints on that script, both real:

- `index.html` is **not** in `tokenRules.ts`'s `EXEMPT_PATHS`, and `.html` is in the walked
  extensions. The script contains no colour literal, so it passes. (`color-scheme: light dark` is
  also safe there: `COLOUR_DECLARATION` requires `color` to be followed by `:`, and in
  `color-scheme` it is followed by `-`.)
- It duplicates the storage key and the three permitted values, which is a drift risk between HTML
  and TypeScript. §6 tests that they agree.

## 6. Modules and tests

**`src/styles/theme.ts`** — pure, storage injected, modelled directly on `draftCache.ts`.

```
type ThemePreference = 'system' | 'light' | 'dark'
readPreference(storage): ThemePreference      // validates; anything else → 'system'
writePreference(storage, pref): boolean       // returns whether it actually stuck
applyPreference(root, pref): void             // 'system' REMOVES the attribute
```

`applyPreference` removing the attribute for `system` is the point of the three states: with no
attribute, the media query resumes control, and the app follows an OS that changes at sunset
without anybody pressing anything.

**No key versioning**, and the contrast with `draftCache` is the reason to say so. The draft's key
carries `v4` because reading a stale *shape* would present an old rubric's answers as this month's
— a value meaning one thing read as though it meant another. A stale theme string cannot do that:
it is one of three words, and anything unrecognised falls back to `system`. Validation covers the
entire risk, and a version segment here would be cargo.

**`src/styles/useTheme.ts`** — holds the preference, applies it, writes it. **`ThemeControl.tsx`**
plus its module CSS.

Tests:

| File | Covers |
|---|---|
| `src/styles/theme.test.ts` | round trip, each of the three, unrecognised value, absent key, storage that throws on read, on write |
| `src/styles/useTheme.dom.test.ts` | initial read, attribute applied, persisted on change |
| `src/styles/ThemeControl.dom.test.tsx` | three buttons, `aria-pressed` tracks state, click switches |
| `tests/themeParity.test.ts` | the media-query block and the `[data-theme='dark']` block declare an identical set of properties |
| `tests/bootTheme.test.ts` | `index.html`'s inline script uses the same key and the same three values `theme.ts` exports |
| `tests/tokens.test.ts` | unchanged, and must still pass — no literal escapes into a component |

The last three are structural tests in this repository's existing idiom: `tokenRules`,
`matrixGrid`, `divisorParity` and `clientFormDrift` all exist because, as `tokenRules.ts` puts it,
intent decays and a failing test does not.

## 7. Decisions, with what each costs

**Persisted in `localStorage`, per browser — not on `profiles`, per person.** A column would follow
the owner to every device, and costs: a migration to production; an RLS-checked write, with a
failure mode, on every toggle; and — the disqualifying one — the preference cannot be read until
the profile query returns, so *every load* flashes the wrong theme for as long as auth takes, and
the signed-out screens could not use it at all. Cost accepted: set it on the laptop and the phone
still follows its OS until set there too. That is arguably correct, since dark-at-night is a
property of a device in a room.

**The warm dark ground `#201D18`, not a neutral charcoal.** The brand is warm paper; the dark theme
inherits that warmth rather than dropping it. Cost: four or five new brand literals, and marginally
lower band separation than a cool near-black would give (teal 8.28:1 against 8.93:1) — a difference
with no practical consequence at those values.

**The control is three buttons in the header, not a cycling button or a `<select>`.** It reuses the
Cards/Matrix pattern exactly: `role="group"`, an `aria-label`, and `aria-pressed` on each button.
Board.tsx's own comment gives the reason — a control that says what it will *become* gives no
indication of what is currently showing. Cost: three buttons of header width rather than one.

**The theme applies everywhere; the control appears only when signed in.** Sign-in, access-pending,
the database-error screen and the startup-error screen all take the theme, because they are painted
with the same tokens and a light flash on the way to a dark app is exactly the defect §5 exists to
prevent. But none of them gets the control: a signed-out visitor's OS preference is already
honoured, and a persisted setting has nowhere sensible to live on a sign-in form.

**The band fills do not change.** Teal, amber, red and the pinned stone are identical in both
schemes. They were chosen as a three-step health scale with measured separation, and re-tuning them
per theme would mean two scales to keep in step for no gain — they already measure 8.28, 7.79 and
4.69 against the dark ground.

**No transition on the switch.** §1.

## 8. The measurements

All computed with the WCAG 2.x relative-luminance formula, 2026-09-02, the same method as the
2026-08-21 pass. Every one of these goes into the file beside its value.

**Dark — text on surfaces** (4.5:1 needed for body text):

| | on page `#201D18` | on raised `#2A2620` | on sunken `#191612` |
|---|---|---|---|
| `--dark-ink` `#F2ECDA` | 14.22 | 12.74 | 15.27 |
| `--dark-ink-muted` `#A69E8E` | 6.32 | 5.66 | 6.78 |

**Dark — the rest:** action text on action face 12.74 · focus ring on page 14.22 · alert
`#FF6B60` on page 6.02, on raised 5.39 · accent blush on page 9.83 · hairline `#4A443A` on page
1.74 (light's accepted equivalent is 1.56, so this is marginally *better*) · raised vs page 1.12 ·
sunken vs page 1.07.

**Bands, unchanged, against the dark ground:** teal 8.28 · amber 7.79 · red 4.69 · stone 10.07.
Ink labels on them are ground-independent and unchanged: 8.13 · 7.64 · 4.61 · 9.88.

**Light, recomputed as a regression check, all unchanged:** ink on paper 15.39 · ink-muted on paper
5.46 · red-legible on paper 5.75 · raised vs page 1.05.

## 9. Open items

- The **`--surface-raised` warning survives into dark.** It measures 1.12:1 against the page there,
  as it does 1.05:1 in light: it cannot define a card edge on its own, and the hairline remains the
  actual boundary. The existing comment in `tokens.css` applies to both schemes and should say so.
- **Not yet looked at on a real device**, and worth checking once this is deployed: whether the
  matrix's 1px/2px grid reads at the same weight on a dark ground as on paper. Hairline ratios say
  it should (1.74 against 1.56), but a grid is judged by eye, not by ratio.
- Carried forward from Slice 5, untouched here: horizontal scroll inside `.scroller` on a phone;
  the bare `*` against a band fill; where the Cards/Matrix toggle lands when `.periodBar` wraps;
  and the owner's open suggestion that the matrix's "Average" label be right-aligned.
