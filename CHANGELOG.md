# Changelog

All notable changes to this project are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/), and the project aims to
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

_Jot changes here as you make them. When you publish, rename this heading to the
new version (e.g. `## [1.1.0] — YYYY-MM-DD`), bump `version` in `package.json`, and
cut a matching GitHub release. Delete any subsections you don't use._

### Added
- **Vercel deployment support** — the backend is now structured as zero-config
  serverless functions under `api/` (`search`, `typecounts`, `collections`,
  `neighbors`, `record`, `wikipedia`), with shared logic in `lib/tepapa.js`. The app
  deploys to Vercel (or any serverless/Node host) with no `vercel.json` and no build
  step. See *Deploying to Vercel* in the README, including the shared-key caveat.
- `.vercelignore` to keep `.env`, `.git` and local cruft out of any CLI deploy.

### Changed
- **Knowledge-graph view restyled to Material Design 3.** A top app bar with pill
  text buttons and a round icon button; elevated cards for the node info panel and
  legend; an assist-chip hint; a Material snackbar (keeping the green-status /
  red-error semantics as a left accent); and Roboto type. The graph canvas now uses
  Material outline borders, a teal **primary state-layer** for focus and selection
  (replacing the old gold/grey), node **hover** state layers, filled-tonal **bundle
  chips**, and a harmonised type-colour palette (Object = brand teal). Driven by new
  `--md-*` design tokens bound to the app's existing accent/status colours; the rest
  of the app is unchanged. Roboto loads from Google Fonts (system-ui fallback).
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

[Unreleased]: https://github.com/adriankingston/tepapa-api-browser/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/adriankingston/tepapa-api-browser/releases/tag/v1.0.0
