# Te Papa Collections Browser

A simple web browser for the [Museum of New Zealand Te Papa Tongarewa Collections API](https://data.tepapa.govt.nz/docs/).
Search the national collection, filter by record type, and browse objects, specimens, taxa,
people and places with images and full metadata.

![Search → grid of cards → detail panel]

## How it works

- **`public/`** — the front-end (plain HTML/CSS/JS, no build step).
- **`api/`** — the backend, as small serverless functions (`search`, `typecounts`,
  `collections`, `neighbors`, `record`, `wikipedia`). Each proxies requests to the
  Te Papa API, adding your `x-api-key` header **server-side** — so the key never
  reaches the browser and the API's lack of CORS support is sidestepped.
- **`lib/tepapa.js`** — the shared logic those functions call (Te Papa requests, the
  relationship-graph builder, the Wikipedia/Wikidata matcher).
- **`server.js`** — a tiny zero-dependency Node server for **local development**. It
  serves `public/` and routes `/api/*` to the *same* handler files, so `node server.js`
  behaves just like the deployment.

The browser only ever talks to the local `/api/*` proxy. Images load directly from
`media.tepapa.govt.nz`. The same code runs locally (`node server.js`) and on a serverless
host like Vercel — see **[Deploying to Vercel](#deploying-to-vercel)**.

## Running it

You need [Node.js](https://nodejs.org/) (v18+).

1. Get a free API key — register (name + organisation + email) at
   <https://data.tepapa.govt.nz/docs/register.html>.

2. Add your key: copy `.env.example` to `.env` and paste it in.

   ```bash
   cp .env.example .env
   # then edit .env and set TEPAPA_API_KEY=your-key-here
   ```

3. Start the server:

   ```bash
   npm start        # or: node server.js
   ```

4. Open <http://localhost:4000>.

There's nothing to install — the server has no dependencies and the one
front-end library (Cytoscape) is bundled in `public/vendor/`.

## Sharing it

This app is built to run locally, one copy per person, each with their **own**
free API key (the key stays server-side and never reaches the browser):

- **Send the code** as a git repo (recommended) or a zip. Recipients just need
  [Node.js](https://nodejs.org) 18+, then follow *Running it* above.
- **`.env` is git-ignored**, so your key won't go out through git. If you instead
  zip the folder, **delete `.env` first** (or it will include your key) — they'll
  make their own from `.env.example`.
- Don't share your API key; each person should register their own (Te Papa issues
  keys per user, with their own rate limits).
- Want a public URL instead of local installs? See **[Deploying to Vercel](#deploying-to-vercel)**
  below (it also runs on any Node/serverless host — Render, Railway, Fly, a VPS…).
  Note that a single hosted instance serves everyone from *one* key, so read the
  caveat there and check the [API terms of use](https://www.tepapa.govt.nz/api-terms-of-use) first.

## Deploying to Vercel

The repo is laid out for **zero-config** Vercel deploys: static files in `public/`,
serverless functions in `api/`. There's no `vercel.json` and no build step.

1. Make sure this repo is on GitHub (it already is if you cloned it from there).
2. In the [Vercel dashboard](https://vercel.com/new): **Add New… → Project**, then
   **Import** this GitHub repo (authorise the Vercel GitHub app if prompted). Leave
   the **Framework Preset** as **Other**; don't set a Build Command or Output Directory.
3. Before the first deploy, expand **Environment Variables** and add your key:
   - **Name** `TEPAPA_API_KEY`  ·  **Value** your key
   - Apply it to **Production**, **Preview** *and* **Development**.
4. Click **Deploy**. You get a `https://<project>.vercel.app` URL, and every push to
   `main` redeploys automatically.

Changing the key later goes through **Settings → Environment Variables → edit → Save**,
then **redeploy** (Vercel only applies env-var changes to *new* deployments).

> **CLI alternative:** `npm i -g vercel` → `vercel login` → `vercel` (preview deploy
> + links the folder) → `vercel env add TEPAPA_API_KEY` → `vercel --prod`.

### ⚠ Before you make it public

A hosted instance serves **everyone from your one API key**, and the `/api/*` proxy is
open to anyone who finds the URL:

- All traffic counts against **your** personal Te Papa rate limit.
- The [Te Papa API terms of use](https://www.tepapa.govt.nz/api-terms-of-use) are
  written around per-user keys — a public proxy may need their OK first.
- Anyone could script against your deployment and burn your quota.

For a small personal or demo deploy this is usually fine. To harden it you can add a
shared-secret/Basic-Auth gate or an origin allowlist in the `api/` functions, or turn on
Vercel's Deployment Protection. (Happy to wire up a lightweight guard if you want one.)

## Features

- Full-text search across the whole collection
- **Collection filter (multiselect)** — on the Objects and Specimens tabs, a bar of
  collection chips with counts (Photography, History, Taonga Māori, Birds, Plants…).
  Select any combination to narrow the results (OR within the field); the chip counts
  stay stable so you always see the full breakdown. Applies to both grid and list and
  resets when you change type tab. Counts come from `POST /api/collections` (a
  `collection` facet); the selection is folded into the query as
  `(query) AND collection:("A" OR "B")`.
- **Result tabs by record type** — a search shows a tab per endpoint with live counts
  (All · Objects · Specimens · Taxa · People · Organisations · Places · Topics ·
  Publications · Categories); empty types are hidden. Switching tabs shows that
  endpoint's results with its own type-appropriate columns. Counts come from one
  `POST /api/typecounts` call (a parallel per-type count sweep).
- "Images only" toggle
- **Grid / List views** — switch between a thumbnail grid and a table. Both are
  **type-aware**: the columns/details match the record type, since the fields that
  matter differ (objects have a registration no., maker and date; taxa show
  scientific/common name, rank and family; people show born/died/nationality;
  places show type, region and coordinates; topics and publications have no
  registration number). Your view choice is remembered.
- **Type-aware detail panel** — surfaces the fields that matter for each record
  type: objects (maker, materials, techniques, dimensions), people/orgs (birth/death
  dates and places, nationality, external IDs), places (coordinates, scope note,
  hierarchy), taxa (scientific name, full taxonomy, vernacular names), specimens
  (identification, collection event, measurements), and topics/publications
  (narrative, authors, related objects). Related records show as **clickable chips**
  you can follow without leaving the panel.
- **Culturally sensitive imagery** — images that may depict or include modified human
  remains or deceased persons are shown blurred behind a "Potentially sensitive image"
  notice, revealed only on a deliberate click. The API exposes no sensitivity flag, so
  this is a deliberately cautious heuristic over each record's materials (e.g. *human
  hair/bone*), classification (*mummies*, *sarcophagi*, *mokomokai*) and title/caption
  (*mummified*, *kōiwi*, *tūpāpaku*, *post-mortem*, *tangihanga*…). It errs toward
  over-blurring; in the graph, sensitive records show their type icon instead of a photo.
  See `isSensitive` in [public/app.js](public/app.js) to tune the terms.
- **Wikipedia preview for people & places** — when a record can be matched
  *explicitly*, the detail panel shows a Wikipedia summary (thumbnail, extract, and a
  link). People/organisations are matched by the **Wikidata ID** Te Papa stores on the
  record; places (which have no ID) are matched by name and **verified by coordinates**
  (within 75 km) or country, so look-alikes are rejected. No confident match → nothing
  shown (no guessing). Proxied via `GET /api/wikipedia`.
- **Knowledge-graph view** — from any record, "Explore relationship graph" opens an
  interactive graph of how records connect (see below)
- Links out to Te Papa Collections Online and the raw API record

## Knowledge-graph view

Open any record's details and click **🕸 Explore relationship graph**. The focus
record sits at the centre; tap any node to expand *its* relationships, building the
graph outward.

The graph uses the **native Collections Online relationships** — each edge is a real
relationship the API returns, labelled by its field (`made`, `made in`, `made of`,
`depicts`, `identified as`, `collected`…). Relationships come from two places:

- **Forward links** embedded in the record (maker, place, materials, techniques,
  classification, parent taxon, a specimen's taxon and collection event…).
- **Reverse / association links** from the API's `…/related` endpoint, whose
  `associationCount` facet gives a per-relationship count (e.g. an artist's 53 made
  works, a place's 230k production links).

**Handling high-degree nodes.** Many records have thousands of relationships, so the
graph never tries to draw them all:

- Low-degree relationships (≤ 8) are drawn as individual nodes.
- High-degree ones become a single **bundle** node labelled `made (53)`. Tapping it
  pages members in 10 at a time, so even a place with 250k relationships only ever
  adds a handful of nodes per tap.
- A global cap (300 nodes) stops runaway graphs; from there you keep exploring by
  opening a node's full details.

**Collapsing nodes.** Because expansion grows the graph fast, you can prune it back:
right-click a node (or use its info panel's **Collapse branches** button) to remove the
branches that node introduced, and **Collapse all** in the header resets to the focus
and its first ring. Collapse is share-safe — a node that's also reached from another
branch survives (each edge records which expansion created it, and only nodes left
disconnected from the focus are removed).

Server endpoints powering it ([server.js](server.js)):

- `POST /api/neighbors` — given a record `href`, returns its individual edges and
  aggregate bundles (auto-expanding only the small relationships).
- `GET /api/record?href=…` — fetch one full record (for "Open full details").
- Bundle paging reuses `POST /api/search` with a `{field: "<predicate>.id"}` filter.

## Notes

- Metadata is licensed **CC BY 4.0**. Images carry their **own** licences — the rights
  statement is shown on each image; check it before reuse.
- `.env` is git-ignored so your key isn't committed.

## Acknowledgements

This tool stands on data and software from others (see [LICENSE](LICENSE) for full terms):

- **Museum of New Zealand Te Papa Tongarewa** — collection data & images, via the
  [Collections API](https://www.tepapa.govt.nz/api-terms-of-use) (metadata CC BY 4.0).
- **Cytoscape.js** (© The Cytoscape Consortium, MIT) — the relationship-graph view,
  bundled in `public/vendor/`.
- **Wikipedia / Wikimedia Foundation** — person & place previews (article text CC BY-SA,
  with a link back to the source; thumbnails from Wikimedia Commons).
- **Wikidata** (CC0) — matching people/organisations to their Wikipedia article.
- **OpenStreetMap** — map links for places (map data © OpenStreetMap contributors, ODbL).

Independent, non-commercial tool; not affiliated with or endorsed by any of the above.
