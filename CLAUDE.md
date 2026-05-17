# AdCalc — AI Instructions

Read this before editing. It tells AI assistants what AdCalc is, how it is
wired, and the rules to keep when changing it.

---

## What AdCalc is

AdCalc is a **zero-server, static, offline-first** ad profit simulator for
DTC / dropshipping store owners and media buyers. The user types their product
and campaign numbers; the browser computes unit economics in real time. No data
ever leaves the machine — no OAuth, no upload, no backend. It is **free**:
every feature is open to everyone, with no paywall, no accounts, no licensing.

Positioning: the private alternative to Triple Whale ($129/mo) and Northbeam
($200+/mo), which both require ad-account OAuth and cloud-store the user's data.
The one-line pitch is: **"Your numbers never leave your browser."**

## User flow

Land → enter product inputs → enter ad inputs → see live results (every
keystroke) → run 6-tier scaling scenarios → save / export. There is **no submit
button**. Everything recalculates on `input` events.

## File map

```
index.html         landing page = SITE ROOT (what AdCalc is, links into the app)
app.html           the calculator app — all screens (served at /app.html)
privacy.html       privacy/data policy (consent withdrawal, GDPR)
404.html           branded not-found page
css/style.css      all styling (clean, paid-tool polish — "an ugly calculator won't sell")
js/calc.js         PURE math engine. No DOM. Full float precision. Source of truth.
js/scenarios.js    6 spend tiers + profitCurve() sampler (CPM-creep model)
js/format.js       display formatting only (currency symbol, toFixed) — never used by calc
js/storage.js      IndexedDB wrapper: products, campaigns, scenarios, settings, snapshots
js/theme.js        theme switcher: swaps data-theme on <html>, persists to localStorage
js/app.js          wiring: read inputs → compute → paint → persist → sliders/export
```

`js/app.js` is the only module that touches the DOM and orchestrates the
others. Keep math out of it — math belongs in `calc.js`.

## The math engine (most important part)

All formulas live in `js/calc.js#compute()`. Percentages (CTR, CVR,
processing, refund) enter as typed numbers (e.g. `1.8` = 1.8%) and are
converted to fractions inside `compute`. Canonical formulas:

```
CPC            = (CPM / 1000) × (1 / CTR)         // or direct CPC in cpc mode
Daily clicks   = Ad spend / CPC
Orders/day     = Daily clicks × CVR
Gross margin   = Revenue/order − COGS − Shipping − (Revenue/order × Processing%)
Refund cost    = Gross margin × Refund rate
Net margin     = Gross margin − Refund cost − Other fees
CAC / CPO      = Ad spend / Orders/day                 // cost per order (Northbeam 3.0 renamed CAC→CPO)
Net profit/ord = Net margin − CAC
Daily profit   = Net profit/order × Orders/day
ROAS           = Daily revenue / Ad spend
Breakeven ROAS = Revenue/order / Net margin
Breakeven CVR  = Ad spend / (contribution × clicks)   // contribution = Rev − COGS − Shipping
Target CPO     = Net margin − (Revenue/order × Target profit%)   // = target CAC ceiling
Target ROAS    = Revenue/order / Target CPO            // collapses to Breakeven ROAS when target%=0
New orders     = Orders/day × New customer%
New-cust CAC   = Ad spend / New orders                 // ≥ blended CAC by construction
New-cust ROAS  = (New orders × Revenue/order) / Ad spend
MER            = (Daily revenue + Other revenue) / (Ad spend + Other spend)
Reported ROAS  = ROAS × Attribution capture%           // platform-reported vs true
Reported CAC   = CAC / Attribution capture%
CPV            = Ad spend / clicks                     // a click ≈ a visitor (prospective model)
RPV (all)      = Daily revenue / clicks
RPV (new)      = (New orders × Rev/order) / (clicks × New visitor%)
RPV (returning)= (Returning orders × Rev/order) / (clicks × (1 − New visitor%))
Customer LTV   = Gross margin/order × Orders per year                         // naive (no retention set)
12-mo LTV      = Gross margin/order × Σ retention^k for k=0..11               // cohort, when retentionM>0
CAC payback    = first month k where Σ Gross margin/order·retention^k ≥ New-cust CAC
                 (falls back to naive months when retentionM=0)
CVR headroom   = Typed CVR − Breakeven CVR                                    // %-points
Goal-seek      = cheapest spend (scanned, CPM-creep applied) hitting a target daily profit
Target daily $ = (Revenue/order × Target profit%) × Orders/day                // chart goalpost
Monthly *      = daily * 30
```

`Revenue/order` = `AOV override` if set, else `price`, plus `upsell` bump.
**Never round inside the engine.** Rounding happens only in `format.js` at
render time. If a displayed sample number in the original spec disagrees with
these formulas, the formulas win — the spec's example values were illustrative
and not internally consistent.

Health coloring (`calc.js#health`): `red` if losing money or ROAS ≤ breakeven;
`amber` if within 20% of breakeven ROAS; else `green`. The scenario table reuses
this per tier.

## Input modes

`CPM + CTR` (default) auto-derives CPC. `Direct CPC` lets paid-search buyers
enter CPC directly. The toggle in the Campaign card swaps which fields show and
sets `mode`. Both must keep working.

## Currency

The symbol is configurable from the topbar (`format.js#setCurrency`) and
persisted in IndexedDB settings. Never hardcode `$` in new display code — call
the `format.js` helpers.

## Theming

Six themes ship: **Classic** (default, `:root`), **Editorial**, **Pop**,
**Sketch**, **Riso**, **Terminal** (dark code-editor: dark field, syntax
accents, `--display:var(--mono)`). **Classic is the protected plain/neutral
default — do not restyle `:root`'s palette.** New identities ship as their own
`[data-theme]` block only. Editorial is the committed premium identity (warm
cream, deep forest-green, oxblood, serif display). A theme is nothing but a
token set: each `[data-theme="…"]` block re-points the same CSS custom
properties (`--bg`, `--card`, `--ink`, `--accent`, `--line`, semantic colors,
`--radius`, `--bg-pattern`, and `--display`). `--display` (wordmark/headings/
hero numbers) defaults to the body sans in `:root` and is repointed to
`--serif` only by Editorial — so type stays a pure token-swap with no
theme-specific component selectors. Component CSS never
changes per theme — cards, buttons, and the background share one structure
across all four, so a new theme is just a token block plus an entry in
`THEMES` in `js/theme.js`. Keep it that way: do not write theme-specific
component rules. The choice persists in `localStorage['adcalc_theme']` and
applies on both `index.html` (landing) and `app.html` (a tiny inline head script sets
the attribute pre-paint to avoid a flash).

## No paywall

AdCalc is fully free. There is no subscription gate, no accounts, no license
keys, and no `gate.js`. Every feature — scenario table, IndexedDB save/recall,
CSV/JSON export, multi-product switching, sensitivity sliders — is available to
everyone. Do **not** reintroduce gating, "Pro" tiers, lock overlays, or a
purchase flow. If a feature is built, it ships unlocked for all users.

## IndexedDB

DB `adcalc` (VERSION 2), stores: `products`, `campaigns`, `scenarios`,
`settings`, `snapshots`. `snapshots` is keyed by `date` (`YYYY-MM-DD`) so
"Log today" overwrites the same day; it powers the Monitoring trend chart.
`settings` is a single record (`id: 1`) holding currency, mode, the live input
draft, the sensitivity-slider state (`slider`, null when untouched), the
channel-mix array (`channels`) and the SKU-blend config (`skuMix`), so the
typed inputs, dragged scenario, channel mix and product blend all survive a
reload. The draft stores
only typed values (`readBase()`), never the slider override, so a refresh
restores real inputs rather than wherever the sliders were dragged. Bump
`VERSION` in `storage.js` and add a migration in `onupgradeneeded` if you
change a store's shape. (Adding a key to the single `settings` record needs no
migration.)

## Rules when editing

- Keep `calc.js` pure: no DOM, no formatting, no rounding, no `localStorage`.
- Add new metrics to `compute()` first, then surface them in `app.js#render`.
- No build step. Plain ES modules, no framework, no dependencies. Keep it that
  way — it must run by opening `index.html` (served, for module CORS).
- UI stays clean and paid-grade. No clutter; this is a tool people pay for.
- No emojis in code or content. Minimal comments; prose belongs in `.md`.
- NEVER expose the contact email (`artivicolab@gmail.com`) in static markup.
  It must always be assembled in JS at runtime from split parts
  (`'artivicolab' + '@' + 'gmail.com'`), set only as a `mailto:` href, and the
  visible link text stays generic ("Contact us" / "email us") — never render
  the address as text. No plain `mailto:` or address string anywhere in HTML
  (anti-scrape). Applies to every page (footers, privacy).
- Verify both currency formatting and both input modes after any math change.
- The profit-curve chart and health gauge are hand-rolled SVG/CSS in
  `app.js#renderCurve`/`renderGauge` — no chart library, ever. Reference colors
  come from theme CSS vars, so charts restyle with the theme automatically.
- Metric cards are grouped under `.msection` labels. EVERY metric and input
  carries an `<i class="info" tabindex="0" data-tip="…">?</i>` placed directly
  after the label text (so the tooltip engine reads the preceding text node as
  the title). Not native `title` — the custom engine in `app.js#initTooltips`
  renders a themed popover. Authoring convention for `data-tip`: paragraphs
  split on `|`; a segment may start `RULE:` (becomes the italic rule-of-thumb);
  wrap formulas in backticks for a mono chip. Keep the "What it is / How it is
  computed / Why it matters / RULE" shape. Any new metric or input MUST ship a
  full data-tip — "explain everything" is a product requirement here.
- Scrollbars are theme-driven globally (`*` rules using `--accent`/`--bg`);
  the tooltip, modal and panes inherit it. Don't hardcode scrollbar colors.
- Reset: `app.js#resetAll` restores every input to `el.defaultValue` (the HTML
  `value=` attr) and clears slider/channel/SKU/alert state, the `#s=` hash and
  the filter. It never deletes saved products/scenarios/snapshots — keep that
  boundary.
- The Live-results filter persists in `settings.tab`; `applyTab()` is the one
  place that toggles tab `.on` + `.msection[hidden]`. Don't filter sections
  anywhere else.
- Design invariants (do not regress): hero cards are near-surface with the
  number in `--ink` and a single state-colored left rail (no green-on-green
  wash); tabs are underline, never a filled pill (must not look like the
  primary button); the mode toggle is a segmented control; gauge zones are
  muted via `color-mix` toward `--card` with a real round marker.
- Typography: the **regular sans (`--font`) is used everywhere**. The only
  monospace left is `.method-pre` (the methodology formula block — it is code,
  needs column alignment). Do not reintroduce `--mono` for UI chrome, and do
  not bring back uppercase-tracked labels or `::before` marker glyphs (the
  "brutalist/terminal" pass was explicitly reverted — it fought the clean
  hero/data aesthetic).
- Buttons are clean & modern: `.btn` rounded (`8px`), 1px `--line` border,
  regular font, sentence case; hierarchy = `.btn-primary` (filled `--accent`,
  subtle `--shadow`) > `.btn`/`.btn-ghost` (soft outline) > `.btn-tertiary`
  (quiet text link). Landing uses `.btn-lg`/`.lp-nav-cta` — keep them visually
  consistent with this. All token-driven; no hardcoded button colors.
- The site wordmark `.logo` IS the home link (`<a href="index.html">`, the site root) on every
  page; there is no separate Home/About nav button. The info affordance glyph
  is `?` in the regular font (not `i`, not mono).
- Tooltips (`?`) are reserved for genuine jargon only — never on
  self-explanatory fields (price, COGS, spend, clicks, etc.). Keep the count
  low; the indicator is accent-tinted (visible, brightens on label hover).
- The `.zero` affordance is intentionally a faint whisper and is hidden by
  `syncZeroBtns()` unless the field holds a non-zero value. Don't make it loud
  or always-visible.
- Benchmark cards carry a one-line contextual story via `.m-note`
  (`renderCallouts`/`renderCvrNote`): ROAS-vs-breakeven, vs-target, LTV×CAC,
  payback-vs-rule-of-thumb. New benchmarks should get an `*Note` span + a line
  here — derive from the user's numbers, never invent external data.
- The gauge shows a "you are here" `.gauge-tag` (live ROAS) above the needle.
- Profit curve: draw-in animates once per load (`curveDrawn` flag — never
  per keystroke), and a pointer read-out (`#curveTip`) shows spend→profit on
  hover. Keep the hand-rolled SVG; no chart lib. It also annotates the
  **saturation / "scaling ceiling"** — `scenarios.js#saturationSpend` (first
  spend where `marginalRoasAt` drops below breakeven ROAS). This is the
  flagship insight; keep it on both the screen chart and the PDF chart.
- Marginal (incremental) ROAS, contribution margin, breakeven AOV and the
  scaling ceiling are all **derived from existing inputs** — never add inputs
  for them. Marginal ROAS = dRevenue/dSpend with CPM creep
  (`scenarios.js#marginalRoasAt`); contribution margin == net margin
  (pre-CAC); breakeven AOV inverts the margin chain at the current CAC. Keep
  these in `compute()`/`scenarios.js`, surfaced in Profit benchmarks + tiers
  ("marg" on each tier) + the PDF ratio cards.
- The PDF (`buildPrintDoc` → `#printDoc`, styled in `@media print` `.pd-*`)
  is an **executive deliverable, not a spreadsheet** — it is the artifact that
  leaves the browser. Required: branded cover with hero Daily/Monthly profit
  numbers up top, a one-line summary, an embedded self-contained profit-curve
  SVG (fixed hex colors — never CSS vars in SVG attrs), scaling-scenario bars,
  a "What if?" section (uses `probeScenario`/`solveSpend`), interpreted ratio
  cards (value + plain-language verdict, not bare numbers), a filled P&L (no
  sparse per-order/day/month columns), compact assumptions, a methodology
  appendix, and running header/footer that lead with the privacy story. No
  "Sr." numbering. Regenerated on every print via `beforeprint`. Keep it
  brand-consistent and reliably printable (`print-color-adjust:exact`).
- The bottom `.stickybar` is **informational only** and MUST keep
  `pointer-events:none` — `main` has its own stacking context so the fixed bar
  paints above page content and would otherwise steal clicks (this broke the
  CSV/Print menu items). Never put interactive controls in the sticky bar.
- The Sessions "More" menu opens **upward** (`bottom:100%`) because the card
  sits at the page bottom near the sticky bar; keep it dropping up.
- The "0" buttons are injected in `app.js#bindInputs` for optional adjustment
  fields only — never for core drivers (price/spend/cpm/ctr/cpc/cvr).
- Theming is pure token-swap: depth (`--shadow`/`--shadow-lg`), `--mono`, and
  all palette vars live in `:root`/`[data-theme]`. Components reference vars
  only — never hardcode a color or `#fff`. The privacy badge (`.trust`) is a
  deliberate signature element; keep it monospace + lock + accent.
- Hero numbers render via `app.js#paintHero` (currency symbol wrapped in
  `.msym`). Live-results groups are filtered by the `#resultTabs` tabs keyed
  on `.msection[data-section]`. The profit curve sits above the metric card
  (chart is the answer); do not move it back below.
- Scenario tiers are user-defined: `scenarios.js#ratiosFor` derives the three
  growth steps from `inp.tierMax`; `probeScenario`/`scenarioMaxSpend` back the
  draggable what-if slider. Keep "current" (1×) always in the tier set.
- `scenarios.js#solveSpend` is the goal-seek: profit-vs-spend is non-monotonic
  (CPM creep), so it scans then refines — never binary-search it. The UI must
  always explain *why* a target fails: "peak ≤ 0" → economics lose at every
  budget (cite CPO vs net margin, prescribe a fix); "peak > 0 but < target" →
  above the ceiling (cite the achievable peak/spend). Never show a bare
  "not reachable".
- The HTML input defaults are intentionally a *profitable* scenario
  (cpm 14 / ctr 2.2 / cvr 3.6 → ~+$149/day, ROAS 2.77) so first load shows the
  tool working green. Keep defaults profitable; a losing default makes the
  whole app look broken. The probe slider opens at the current-spend position
  (`setProbeToCurrent`), never at $0.
- Share links: `readBase()` is base64'd into `#s=` (no server). Init parses
  the hash and it overrides the saved draft. Keep payload = typed inputs only.
- Retention LTV (`calc.js`): `retentionM`% drives a geometric cohort; when 0
  the tiles fall back to the naive `ordersPerYear` LTV. The naive payback is
  intentionally kept for that fallback only.
- The `#bgfx` parallax field is presentational only: it reads `--fx`, driven
  by `html[data-health]` set in `render()`, so it recolors with the live
  health state in each theme's own green/amber/red. Keep it very low opacity;
  it must never compete with data. Disabled under reduced-motion.
- Channel mix and SKU blend do NOT touch `calc.js`. `readInputs()` folds them
  in: channels sum into `otherSpend`/`otherRevenue` (→ MER); `skuBlend` is a
  weighted average of `PRODUCT_IDS` fields applied before sliders. Engine
  stays pure and single-pass — aggregate upstream, never special-case in
  `compute()`.
- Alert rules are pure view logic in `renderAlerts(r)` (blank input = off);
  never block input or gate features on them.
```
