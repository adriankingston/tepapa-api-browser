// Shared logic for the Te Papa Collections browser.
//
// This module is transport-agnostic: it knows how to talk to the Te Papa API
// (and Wikipedia/Wikidata), but nothing about HTTP routing. It is imported by:
//   - the per-route handlers in ../api/*.js   (run as Vercel serverless functions)
//   - the local dev server ../server.js       (which routes /api/* to those same handlers)
//
// The Te Papa API key is read from process.env.TEPAPA_API_KEY *at call time*, so
// it works whether the value comes from a local .env file or Vercel's dashboard.

const https = require('https');

const TEPAPA_HOST = 'data.tepapa.govt.nz';
const apiKey = () => process.env.TEPAPA_API_KEY;

// --- HTTP glue shared by every handler ---------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// Read a JSON request body. On Vercel the body may already be parsed onto
// req.body; locally we read the raw stream. Returns null on invalid JSON.
function readJson(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') {
        try { return resolve(req.body ? JSON.parse(req.body) : {}); }
        catch { return resolve(null); }
      }
      return resolve(req.body);
    }
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

// Read the query string. Vercel populates req.query; the local server does too,
// but fall back to parsing req.url just in case.
function readQuery(req) {
  if (req.query) return req.query;
  try { return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams); }
  catch { return {}; }
}

// --- Te Papa requests --------------------------------------------------------

// Forward an advanced (POST) search to the Te Papa API. Returns the raw body so
// the proxy can stream it through verbatim.
function tepapaSearch(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        host: TEPAPA_HOST,
        path: '/collection/search',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json;profile=full',
          'x-api-key': apiKey(),
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (r) => {
        let chunks = '';
        r.on('data', (d) => (chunks += d));
        r.on('end', () => resolve({ status: r.statusCode, body: chunks }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Generic Te Papa request (GET a record/related URL, or POST a search).
// Accepts a full data.tepapa.govt.nz URL or a /collection/... path.
function tepapaRequest(method, pathOrUrl, payload) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = /^https?:\/\//.test(pathOrUrl)
        ? new URL(pathOrUrl)
        : new URL(`https://${TEPAPA_HOST}${pathOrUrl}`);
    } catch {
      return reject(new Error('bad url'));
    }
    if (u.host !== TEPAPA_HOST) return reject(new Error('host not allowed'));
    const data = payload ? JSON.stringify(payload) : null;
    const headers = { Accept: 'application/json', 'x-api-key': apiKey() };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const r = https.request(
      { host: u.host, path: u.pathname + u.search, method, headers },
      (resp) => {
        let chunks = '';
        resp.on('data', (d) => (chunks += d));
        resp.on('end', () => {
          let json = null;
          try { json = JSON.parse(chunks); } catch { /* leave null */ }
          resolve({ status: resp.statusCode, json });
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// --- Per-type counts (search tabs) -------------------------------------------

const COUNT_TYPES = ['Object', 'Specimen', 'Taxon', 'Person', 'Organisation', 'Place', 'Topic', 'Publication', 'Category'];

async function typeCounts(query) {
  query = String(query || '');
  if (!query.trim()) return { total: 0, counts: {} };
  const countOf = (filters) =>
    tepapaRequest('POST', '/collection/search', { query, size: 0, ...(filters ? { filters } : {}) })
      .then((r) => (r.json && r.json._metadata && r.json._metadata.resultset && r.json._metadata.resultset.count) || 0)
      .catch(() => 0);
  const results = await Promise.all([
    countOf(null),
    ...COUNT_TYPES.map((t) => countOf([{ field: 'type', keyword: t }])),
  ]);
  const counts = {};
  COUNT_TYPES.forEach((t, i) => { counts[t] = results[i + 1]; });
  return { total: results[0], counts };
}

// --- Collection facet (collection filter) ------------------------------------

async function collectionFacet(query, type) {
  if (!query || !type) return { collection: {} };
  const r = await tepapaRequest('POST', '/collection/search', {
    query: String(query),
    size: 0,
    filters: [{ field: 'type', keyword: String(type) }],
    facets: [{ field: 'collection', size: 50 }],
  });
  return { collection: (r.json && r.json.facets && r.json.facets.collection) || {} };
}

// --- Wikipedia / Wikidata previews -------------------------------------------

// Fetch JSON from an allow-listed external host (Wikidata / Wikipedia), following
// a single redirect. Wikimedia APIs require a descriptive User-Agent.
function fetchJson(urlStr, depth = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(new Error('bad url')); }
    if (!['www.wikidata.org', 'en.wikipedia.org'].includes(u.host)) return reject(new Error('host not allowed'));
    https
      .get(
        { host: u.host, path: u.pathname + u.search, headers: { 'User-Agent': 'TePapaCollectionsBrowser/1.0 (collections browser; contact: n/a)', Accept: 'application/json' } },
        (r) => {
          if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && depth < 2) {
            return fetchJson(new URL(r.headers.location, urlStr).toString(), depth + 1).then(resolve, reject);
          }
          let c = '';
          r.on('data', (d) => (c += d));
          r.on('end', () => { try { resolve(JSON.parse(c)); } catch { resolve(null); } });
        }
      )
      .on('error', reject);
  });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normWikiSummary(d) {
  if (!d || d.type === 'disambiguation' || d.title === 'Not found.' || d.detail) return null;
  if (!d.extract) return null;
  return {
    title: d.title,
    description: d.description || '',
    extract: d.extract,
    thumb: (d.thumbnail && d.thumbnail.source) || null,
    url: (d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page) ||
      `https://en.wikipedia.org/wiki/${encodeURIComponent(String(d.title || '').replace(/ /g, '_'))}`,
    coordinates: d.coordinates || null,
  };
}
const wikiSummary = (title) =>
  fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
    .then(normWikiSummary)
    .catch(() => null);

// Resolve a Wikipedia preview: by Wikidata id (authoritative, for people/orgs)
// or by name with a coordinate/country check (for places — no id available).
async function wikipediaPreview(params) {
  const { wikidata, title, country, lat, lon } = params;
  if (wikidata && /^Q\d+$/.test(wikidata)) {
    const wd = await fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidata}&props=sitelinks&sitefilter=enwiki&format=json`).catch(() => null);
    const t = wd && wd.entities && wd.entities[wikidata] && wd.entities[wikidata].sitelinks && wd.entities[wikidata].sitelinks.enwiki && wd.entities[wikidata].sitelinks.enwiki.title;
    return t ? await wikiSummary(t) : null;
  }
  if (title) {
    const candidates = country ? [`${title}, ${country}`, title] : [title];
    for (const c of candidates) {
      const s = await wikiSummary(c);
      if (!s) continue;
      const nearby = s.coordinates && isFinite(lat) && isFinite(lon) &&
        haversineKm(lat, lon, s.coordinates.lat, s.coordinates.lon) <= 75;
      const mentions = country && `${s.extract} ${s.description}`.toLowerCase().includes(country.toLowerCase());
      if (nearby || mentions) return s;
    }
  }
  return null;
}

// --- Relationship graph (neighbourhood of a record) --------------------------

// Fields that are metadata/media/scalars rather than record-to-record links.
const SKIP_FIELDS = new Set([
  '_meta', '_api', '_metadata', 'hasRepresentation', 'representativeImage',
  'hasAgentRepresentation', 'related', 'identifiers', 'facetBirthDate',
  'facetDeathDate',
]);
const INLINE_CAP = 200;     // max members carried inline for a forward bundle

const isRef = (v) =>
  v && typeof v === 'object' && v.id != null && v.type && (v.href || v.iri);

function thumbOf(r) {
  const reps = Array.isArray(r.hasRepresentation) ? r.hasRepresentation : [];
  const img = reps.find((x) => x && x.type === 'ImageObject' && x.thumbnailUrl);
  return img ? img.thumbnailUrl : null;
}

// Best-effort cultural-sensitivity check (mirrors isSensitive in public/app.js):
// keep potentially-sensitive imagery (human remains / deceased persons) out of
// the graph by returning no thumbnail for those records.
const SENSITIVE_TERMS = [
  'mummif', 'mummy', 'mummies', 'sarcophag', 'mokomokai', 'toi moko', 'kōiwi',
  'koiwi', 'tūpāpaku', 'tupapaku', 'human remains', 'human skull', 'human skeleton',
  'human bone', 'human hair', 'human teeth', 'human skin', 'shrunken head',
  'preserved head', 'dried head', 'trophy head', 'severed head', 'post-mortem',
  'postmortem', 'post mortem', 'deathbed', 'death bed', 'tangihanga',
];
function isSensitiveRecord(r) {
  const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const materials = [r.isMadeOfSummary, ...arr(r.isMadeOf).map((c) => c && c.title)]
    .filter(Boolean).join(' ').toLowerCase();
  if (materials.includes('human')) return true;
  const text = [r.title, r.caption, ...arr(r.isTypeOf).map((c) => c && c.title)]
    .filter(Boolean).join(' · ').toLowerCase();
  return SENSITIVE_TERMS.some((t) => text.includes(t));
}

function normNode(r) {
  const id = String(r.id);
  const type = r.type || 'Record';
  return {
    key: `${type}:${id}`,
    id,
    type,
    title: r.title || r.prefLabel || r.scientificName || '(untitled)',
    href: r.href || null,
    thumb: isSensitiveRecord(r) ? null : thumbOf(r),
  };
}

// Top-level fields whose record references are nested (extracted explicitly below).
const NESTED_FIELDS = new Set(['production', 'identification', 'evidenceFor']);

// Build the neighbourhood of one record as a small graph fragment, using the
// native Collections Online relationships:
//   - forward links embedded in the record (maker, place, materials, taxon…)
//   - reverse links from the /related endpoint's associationCount facet
// Every relationship type becomes one labelled, counted "bundle" node, whether
// it has a single member or many — forward bundles carry their members inline,
// reverse (association) bundles page theirs in lazily, so a place with 250k links
// still stays one node. Tap a bundle to expand its members.
async function buildNeighbors(href) {
  if (!/^https:\/\/data\.tepapa\.govt\.nz\/collection\//.test(href)) {
    throw new Error('href must be a data.tepapa.govt.nz collection URL');
  }
  const [recR, relR] = await Promise.all([
    tepapaRequest('GET', href),
    tepapaRequest('GET', `${href}/related?size=0`).catch(() => ({ json: null })),
  ]);
  const rec = recR.json || {};
  const focus = { ...normNode(rec), kind: 'record' };

  const bundles = [];

  // Collect every forward link embedded in the record, grouped by predicate.
  // Nested record references (maker, place, taxon, collection event) are pulled
  // out under their own predicate so they bundle like the plain top-level fields.
  const fwdGroups = {};
  const pushFwd = (pred, ref) => { if (isRef(ref)) (fwdGroups[pred] ||= []).push(ref); };

  (Array.isArray(rec.production) ? rec.production : []).forEach((p) => {
    pushFwd('production.contributor', p.contributor);
    pushFwd('production.spatial', p.spatial);
  });
  (Array.isArray(rec.identification) ? rec.identification : []).forEach((p) => {
    pushFwd('identification.toTaxon', p.toTaxon);
    pushFwd('identification.identifiedBy', p.identifiedBy);
  });
  pushFwd('evidenceFor.atEvent', rec.evidenceFor && rec.evidenceFor.atEvent);

  for (const [k, v] of Object.entries(rec)) {
    if (SKIP_FIELDS.has(k) || NESTED_FIELDS.has(k)) continue;
    for (const item of Array.isArray(v) ? v : [v]) pushFwd(k, item);
  }

  // Each forward relationship type → one labelled, counted bundle whose members
  // are carried inline (deduped, self-reference dropped, capped at INLINE_CAP).
  for (const [pred, refs] of Object.entries(fwdGroups)) {
    const uniq = [];
    const ks = new Set();
    for (const r of refs) {
      const key = `${r.type}:${r.id}`;
      if (key === focus.key || ks.has(key)) continue;
      ks.add(key); uniq.push(r);
    }
    if (!uniq.length) continue;
    bundles.push({
      predicate: pred, count: uniq.length, mode: 'inline',
      members: uniq.slice(0, INLINE_CAP).map((r) => ({ ...normNode(r), kind: 'record' })),
    });
  }

  // Each reverse (association) relationship type → a bundle too; its members are
  // paged in lazily from /search when the bundle is expanded.
  const assoc = (relR.json && relR.json.facets && relR.json.facets.associationCount) || {};
  for (const [pred, count] of Object.entries(assoc)) {
    if (count) bundles.push({ predicate: pred, count, mode: 'reverse', focusId: String(rec.id) });
  }

  return { focus, nodes: [], edges: [], bundles };
}

module.exports = {
  apiKey,
  sendJson,
  readJson,
  readQuery,
  tepapaSearch,
  tepapaRequest,
  typeCounts,
  collectionFacet,
  wikipediaPreview,
  buildNeighbors,
};
