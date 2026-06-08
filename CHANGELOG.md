# Changelog

All notable changes to this project are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/), and the project aims to
follow [Semantic Versioning](https://semver.org/).

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

[1.0.0]: https://github.com/adriankingston/tepapa-api-browser/releases/tag/v1.0.0
