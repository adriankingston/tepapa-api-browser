// Zero-dependency local server for the Te Papa Collections API browser.
//
//   - Serves the static UI from ./public
//   - Proxies search requests to the Te Papa API, injecting the x-api-key
//     header server-side so the key never reaches the browser, and so we
//     dodge the API's lack of CORS support.
//
// Run with:  node server.js   (needs TEPAPA_API_KEY in .env)

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// --- Load .env (tiny parser, no dependency) ----------------------------------
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* no .env file — fall back to real environment */ }

const API_KEY = process.env.TEPAPA_API_KEY;
const PORT = process.env.PORT || 4000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEPAPA_HOST = 'data.tepapa.govt.nz';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// Forward an advanced (POST) search to the Te Papa API.
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
          'x-api-key': API_KEY,
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

// Fetch JSON from an allow-listed external host (Wikidata / Wikipedia), following
// a single redirect. Wikimedia APIs require a descriptive User-Agent.
function fetchJson(urlStr, depth = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(new Error('bad url')); }
    if (!['www.wikidata.org', 'en.wikipedia.org'].includes(u.host)) return reject(new Error('host not allowed'));
    https
      .get(
        { host: u.host, path: u.pathname + u.search, headers: { 'User-Agent': 'TePapaCollectionsBrowser/1.0 (local app; contact: n/a)', Accept: 'application/json' } },
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
    const headers = { Accept: 'application/json', 'x-api-key': API_KEY };
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

// Fields that are metadata/media/scalars rather than record-to-record links.
const SKIP_FIELDS = new Set([
  '_meta', '_api', '_metadata', 'hasRepresentation', 'representativeImage',
  'hasAgentRepresentation', 'related', 'identifiers', 'facetBirthDate',
  'facetDeathDate',
]);
const FORWARD_CAP = 12;     // max individual forward links drawn per predicate
const RESOLVE_CAP = 40;     // max neighbours auto-resolved into nodes per expand
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
// Low-degree relationships become individual nodes; high-degree ones become
// aggregate "bundles" (the careful bit — a place with 250k links stays one node).
async function buildNeighbors(href, autoThreshold) {
  if (!/^https:\/\/data\.tepapa\.govt\.nz\/collection\//.test(href)) {
    throw new Error('href must be a data.tepapa.govt.nz collection URL');
  }
  const auto = Math.max(0, Math.min(20, autoThreshold || 8));
  const [recR, relR] = await Promise.all([
    tepapaRequest('GET', href),
    tepapaRequest('GET', `${href}/related?size=0`).catch(() => ({ json: null })),
  ]);
  const rec = recR.json || {};
  const focus = { ...normNode(rec), kind: 'record' };

  const nodes = [];
  const edges = [];
  const bundles = [];
  const seen = new Set([focus.key]);
  let resolved = 0;

  const edge = (source, target, predicate, direction = 'out') => {
    if (source && target) edges.push({ source, target, predicate, direction });
  };
  // Add a record node (respecting the resolve cap) and return its key, or null.
  const ensureRecord = (ref) => {
    const n = { ...normNode(ref), kind: 'record' };
    if (seen.has(n.key)) return n.key;
    if (resolved >= RESOLVE_CAP) return null;
    seen.add(n.key); nodes.push(n); resolved++;
    return n.key;
  };

  // --- Relationships nested inside the record, linked directly to the focus ---
  (Array.isArray(rec.production) ? rec.production : []).forEach((p) => {
    if (isRef(p.contributor)) edge(focus.key, ensureRecord(p.contributor), 'production.contributor');
    if (isRef(p.spatial)) edge(focus.key, ensureRecord(p.spatial), 'production.spatial');
  });
  (Array.isArray(rec.identification) ? rec.identification : []).forEach((p) => {
    if (isRef(p.toTaxon)) edge(focus.key, ensureRecord(p.toTaxon), 'identification.toTaxon');
    if (isRef(p.identifiedBy)) edge(focus.key, ensureRecord(p.identifiedBy), 'identification.identifiedBy');
  });
  const atEvent = rec.evidenceFor && rec.evidenceFor.atEvent;
  if (isRef(atEvent)) edge(focus.key, ensureRecord(atEvent), 'evidenceFor.atEvent');

  // --- Plain forward links embedded in the record ---
  const fwdGroups = {};
  for (const [k, v] of Object.entries(rec)) {
    if (SKIP_FIELDS.has(k) || NESTED_FIELDS.has(k)) continue;
    for (const item of Array.isArray(v) ? v : [v]) {
      if (isRef(item)) (fwdGroups[k] ||= []).push(item);
    }
  }
  for (const [pred, refs] of Object.entries(fwdGroups)) {
    const uniq = [];
    const ks = new Set();
    for (const r of refs) {
      const key = `${r.type}:${r.id}`;
      if (key === focus.key || ks.has(key)) continue;
      ks.add(key); uniq.push(r);
    }
    if (!uniq.length) continue;
    if (uniq.length > FORWARD_CAP) {
      bundles.push({ predicate: pred, count: uniq.length, mode: 'inline',
        members: uniq.slice(0, INLINE_CAP).map((r) => ({ ...normNode(r), kind: 'record' })) });
      continue;
    }
    for (const r of uniq) {
      const key = ensureRecord(r);
      if (key) edge(focus.key, key, pred);
      else { bundles.push({ predicate: pred, count: uniq.length, mode: 'inline', members: uniq.slice(0, INLINE_CAP).map((x) => ({ ...normNode(x), kind: 'record' })) }); break; }
    }
  }

  // --- Association (reverse) relationships from /related facet counts ---
  const assoc = (relR.json && relR.json.facets && relR.json.facets.associationCount) || {};
  const small = [];
  const large = [];
  for (const [pred, count] of Object.entries(assoc)) {
    if (!count) continue;
    if (count <= auto && resolved < RESOLVE_CAP) small.push([pred, count]);
    else large.push([pred, count]);
  }
  const memberSets = await Promise.all(
    small.map(([pred, count]) =>
      tepapaRequest('POST', '/collection/search', {
        query: '*', size: count,
        filters: [{ field: `${pred}.id`, keyword: String(rec.id) }],
      })
        .then((r) => ({ pred, items: (r.json && r.json.results) || [], count }))
        .catch(() => ({ pred, items: [], count }))
    )
  );
  for (const { pred, items, count } of memberSets) {
    let added = 0;
    for (const it of items) {
      if (resolved >= RESOLVE_CAP) break;
      const key = ensureRecord(it);
      if (!key) break;
      edge(key, focus.key, pred, 'in');
      added++;
    }
    if (added < count) large.push([pred, count]);
  }
  for (const [pred, count] of large) {
    bundles.push({ predicate: pred, count, mode: 'reverse', focusId: String(rec.id) });
  }

  return { focus, nodes, edges, bundles };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // --- API proxy ---
  if (url.pathname === '/api/search' && req.method === 'POST') {
    if (!API_KEY) {
      return sendJson(res, 500, {
        error: 'No API key configured. Add TEPAPA_API_KEY to your .env file.',
      });
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let payload;
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }
      try {
        const result = await tepapaSearch(payload);
        res.writeHead(result.status, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(result.body);
      } catch (e) {
        sendJson(res, 502, { error: 'Upstream request failed', detail: String(e) });
      }
    });
    return;
  }

  // --- Per-type result counts for the search tabs (one parallel sweep) ---
  if (url.pathname === '/api/typecounts' && req.method === 'POST') {
    if (!API_KEY) return sendJson(res, 500, { error: 'No API key configured.' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let query;
      try { query = String(JSON.parse(body || '{}').query || ''); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
      if (!query.trim()) return sendJson(res, 200, { total: 0, counts: {} });
      const TYPES = ['Object', 'Specimen', 'Taxon', 'Person', 'Organisation', 'Place', 'Topic', 'Publication', 'Category'];
      const countOf = (filters) =>
        tepapaRequest('POST', '/collection/search', { query, size: 0, ...(filters ? { filters } : {}) })
          .then((r) => (r.json && r.json._metadata && r.json._metadata.resultset && r.json._metadata.resultset.count) || 0)
          .catch(() => 0);
      try {
        const results = await Promise.all([
          countOf(null),
          ...TYPES.map((t) => countOf([{ field: 'type', keyword: t }])),
        ]);
        const counts = {};
        TYPES.forEach((t, i) => { counts[t] = results[i + 1]; });
        sendJson(res, 200, { total: results[0], counts });
      } catch (e) {
        sendJson(res, 502, { error: 'Count failed', detail: String(e) });
      }
    });
    return;
  }

  // --- Collection breakdown (facet) for the collection filter ---
  if (url.pathname === '/api/collections' && req.method === 'POST') {
    if (!API_KEY) return sendJson(res, 500, { error: 'No API key configured.' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let p;
      try { p = JSON.parse(body || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
      if (!p.query || !p.type) return sendJson(res, 200, { collection: {} });
      try {
        const r = await tepapaRequest('POST', '/collection/search', {
          query: String(p.query),
          size: 0,
          filters: [{ field: 'type', keyword: String(p.type) }],
          facets: [{ field: 'collection', size: 50 }],
        });
        sendJson(res, 200, { collection: (r.json && r.json.facets && r.json.facets.collection) || {} });
      } catch (e) {
        sendJson(res, 502, { error: 'Collection facet failed', detail: String(e) });
      }
    });
    return;
  }

  // --- Graph: neighbourhood of a record ---
  if (url.pathname === '/api/neighbors' && req.method === 'POST') {
    if (!API_KEY) return sendJson(res, 500, { error: 'No API key configured.' });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
      try {
        const data = await buildNeighbors(payload.href, payload.autoThreshold);
        sendJson(res, 200, data);
      } catch (e) {
        sendJson(res, 502, { error: 'Could not build neighbours', detail: String(e) });
      }
    });
    return;
  }

  // --- Graph: fetch one full record by href (for the detail panel) ---
  if (url.pathname === '/api/record' && req.method === 'GET') {
    if (!API_KEY) return sendJson(res, 500, { error: 'No API key configured.' });
    const href = url.searchParams.get('href') || '';
    if (!/^https:\/\/data\.tepapa\.govt\.nz\/collection\//.test(href)) {
      return sendJson(res, 400, { error: 'Invalid href' });
    }
    tepapaRequest('GET', href)
      .then((r) => sendJson(res, r.status || 200, r.json || {}))
      .catch((e) => sendJson(res, 502, { error: 'Upstream failed', detail: String(e) }));
    return;
  }

  // --- Wikipedia preview for a person/org (by Wikidata id) or place (by name+coords) ---
  if (url.pathname === '/api/wikipedia' && req.method === 'GET') {
    wikipediaPreview({
      wikidata: url.searchParams.get('wikidata'),
      title: url.searchParams.get('title'),
      country: url.searchParams.get('country') || '',
      lat: parseFloat(url.searchParams.get('lat')),
      lon: parseFloat(url.searchParams.get('lon')),
    })
      .then((data) => sendJson(res, 200, data || {}))
      .catch((e) => sendJson(res, 502, { error: 'Wikipedia lookup failed', detail: String(e) }));
    return;
  }

  // --- Static files ---
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      // This is a local dev tool whose files change often — never let the
      // browser serve a stale UI from cache.
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Te Papa collections browser → http://localhost:${PORT}\n`);
  if (!API_KEY) {
    console.log('  ⚠  No TEPAPA_API_KEY found — add it to .env or searches will fail.\n');
  }
});
