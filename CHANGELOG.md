# Changelog

All notable changes to this project are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/), and the project aims to
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

_Jot changes here as you make them. When you publish, rename this heading to the
new version (e.g. `## [1.4.0] — YYYY-MM-DD`), bump `version` in `package.json`, and
cut a matching GitHub release. Delete any subsections you don't use._

### Added
- **Side-scroll arrows on the home-page card rows.** Each home shelf now has the same
  centred horizontal scroller with clickable left/right chevrons as the detail-view image
  filmstrip: the arrows appear only when the row overflows, dim at the ends, page by ~80% of
  the visible width, recompute on viewport resize, and hide on touch (swipe instead). They're
  driven by a shared `attachScrollArrows` helper so the home rows and the filmstrip can't
  drift apart — both now also respect `prefers-reduced-motion` and carry per-row aria-labels
  and a keyboard focus ring.

### Changed
- **Content width constrained for readability.** On wide screens the content now sits in a
  centred column capped at `--content-max` (1280px) — toolbar, tabs, home page, results grid,
  pager and footer — while the top app bar stays full-bleed. Body prose (the home hero
  description) is further capped to a ~70-character reading measure. One `--content-max`
  variable tunes the whole app.

### Fixed

## [1.3.0] — 2026-06-09

### Added
- **Editable home page.** On load (and via the logo) the app opens to a curated landing
  page driven by `public/home.json` — edit that one file to set the hero text (including a
  **description with live API record counts**: drop a `{total}` / `{objects}` token into the
  text and it's filled with the formatted number) and arrange
  sections: **recently added images** (automated — newest-imaged objects & specimens),
  a **hand-picked pool** shown shuffled, a **randomised selection from any search/collection**,
  and **quick-search link chips**. Cards open straight into the detail / IIIF view; searching
  (or any link chip) leaves the home page, and the logo returns to it.

## [1.2.1] — 2026-06-09

### Fixed
- IIIF lightbox **opens instantly** instead of stalling on first view. Te Papa's IIIF
  server generates full-image overview scales on demand (~3–5s on a cold cache, then
  fast once warm), which OpenSeadragon requests for the fit-to-screen view. The lightbox
  now shows the fast pre-generated preview as a placeholder while the deep-zoom tiles load
  (region tiles are already sub-second), with `immediateRender` and a larger tile cache.
- Lightbox **zoom works on every image**, not just the first one or two. The viewer is now
  reused across images (OpenSeadragon `open()`) instead of being destroyed and recreated
  per image — the recreate raced on the shared element and broke the zoom gestures.

## [1.2.0] — 2026-06-09

### Added
- **Multi-image gallery + IIIF deep-zoom lightbox.** The detail panel shows a hero
  image plus a **scrollable thumbnail filmstrip** — centred when the images fit, with
  chevron arrows on pointer devices and native swipe on touch (records with dozens–
  hundreds of images no longer produce an endless scroll). Tapping any image opens a
  full-screen viewer with
  **deep-zoom** into the 4000px+ originals, powered by Te Papa's **IIIF Image API**
  (`iiif.tepapa.govt.nz`) through OpenSeadragon — pan/zoom, prev/next, a counter, the
  rights caption, and keyboard/swipe. Works on restricted (no-download) images (tiled
  view only) and honours the culturally-sensitive blur. OpenSeadragon (New BSD) is
  self-hosted in `public/vendor/`.

### Changed
- Detail panel is now a **centered Material dialog** (28dp corners, elevation 3, content
  scrolls inside) with a scrim (~40%) + subtle background blur so the collection stays
  visible around it, going **full-screen on phones** — replacing the right-hand side sheet.

## [1.1.0] — 2026-06-09

### Added
- **Vercel deployment support** — the backend is now structured as zero-config
  serverless functions under `api/` (`search`, `typecounts`, `collections`,
  `neighbors`, `record`, `wikipedia`), with shared logic in `lib/tepapa.js`. The app
  deploys to Vercel (or any serverless/Node host) with no `vercel.json` and no build
  step. See *Deploying to Vercel* in the README, including the shared-key caveat.
- `.vercelignore` to keep `.env`, `.git` and local cruft out of any CLI deploy.

### Changed
- **Material Design 3 applied across the whole app.** Building on the graph-view tokens:
  a top app bar with a **pill search field** + filled Search button, a **segmented**
  Grid/List toggle, an **M3 switch** for "Images only", **primary tabs**, **filter chips**
  for the collection filter, **elevated result cards**, a Material **data table** for the
  list view, and the detail panel as an **M3 side sheet** with filled/tonal/outlined
  buttons and chips. **Roboto** is now the app-wide typeface. All driven by the shared
  `--md-*` tokens; no markup or behaviour changed (every JS-coupled class kept). The
  primary teal is `#00696f`, chosen to meet **WCAG AA** contrast for both teal **text**
  and **white-on-teal filled buttons**; the bright Te Papa brand teal (`#008e96`) is kept
  on the logo and the graph-canvas nodes.
- **Knowledge-graph view restyled to Material Design 3.** A top app bar with pill
  text buttons and a round icon button; elevated cards for the node info panel and
  legend; an assist-chip hint; a Material snackbar (keeping the green-status /
  red-error semantics as a left accent); and Roboto type. The graph canvas now uses
  Material outline borders, a teal **primary state-layer** for focus and selection
  (replacing the old gold/grey), node **hover** state layers, filled-tonal **bundle
  chips**, and a harmonised type-colour palette (Object = brand teal). Driven by new
  `--md-*` design tokens bound to the app's existing accent/status colours; the rest
  of the app is unchanged. Roboto is **self-hosted** (one variable `woff2` per subset,
  latin + latin-ext so te reo Māori macrons render in Roboto, not a fallback),
  preloaded with `font-display: swap` — no third-party font request.
- `server.js` is now a thin **local-development** server: it serves `public/` and
  routes `/api/*` to the very same handler files Vercel runs, so `node server.js`
  behaves like the deployment. No change to behaviour, endpoints, or the UI.

### Fixed
- Detail panel now shows the API's **web summary** for records that have one — the
  longer interpretive write-up Te Papa publishes for some objects (the `description`
  field), shown under an *About* heading. Previously the short tombstone caption
  always took priority and the summary never appeared; the caption is now shown as
  its own line above it.
- Relationship graph: the transient status toast (e.g. *Loading relationships…*) is
  now green instead of red, so loading/status messages no longer look like errors.
  Genuine failures keep the red.

## [1.0.0] — 2026-06-08

First public release on GitHub. The items below are the notable changes since the
earlier informally‑shared version.

### Added
- **Result tabs by record type** — a tab per endpoint (Objects, Specimens, Taxa,
  People, Organisations, Places, Topics, Publications, Categories) with live counts;
  empty types are hidden.
- **Type‑aware grid & list views** — columns and card details now match the record
  type (objects: maker/date; specimens: locality/collected; taxa: scientific name,
  rank, family; people: born/died/nationality; places: type/region/coordinates; …).
  Types without a registration number (taxa, people, topics, publications) no longer
  show an empty one.
- **Multiselect collection filter** for Objects and Specimens — chips with counts
  (Photography, History, Taonga Māori, Birds, Plants, …) that narrow the results.
- **Sort options per type** — Title and Registration no. everywhere applicable;
  Specimen *collected* date (oldest/newest); Person *born*/*died* dates.
- **Wikipedia previews** for people and places in the detail panel, matched
  *explicitly* (Wikidata id for people/orgs; name + coordinate verification for
  places), with CC BY‑SA attribution and a link to the article.
- **Culturally sensitive imagery** — images that may depict or include modified human
  remains or deceased persons are blurred behind a notice and revealed only on a
  deliberate click.
- Third‑party credits (Cytoscape.js, Wikipedia/Wikidata, OpenStreetMap, Te Papa) in
  the LICENSE and README, plus in‑app attribution.

### Changed
- Switched the whole app to a **light theme** (white background).
- Relationship‑graph nodes now use **type icons** (and photos where available)
  instead of colour‑coded circles; the legend uses the icons.

### Fixed
- Collapsing the starting record in the graph now removes only its own branches and
  keeps the nodes you had opened (previously it cleared everything).
- The detail panel's "Raw API record (JSON)" link now loads through the local proxy
  (it was returning 401 when opened directly).

### Notes
- The relationship‑graph view, grid/list toggle, and detail panel existed in the
  earlier shared version; the entries above are what changed since then.

[Unreleased]: https://github.com/adriankingston/tepapa-api-browser/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/adriankingston/tepapa-api-browser/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/adriankingston/tepapa-api-browser/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/adriankingston/tepapa-api-browser/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/adriankingston/tepapa-api-browser/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/adriankingston/tepapa-api-browser/releases/tag/v1.0.0
