// build-collectors.js — precompute the top botany collectors and their active
// collecting periods for viz #4's range chart. Writes public/collectors-botany.json.
//
// Top 10 collectors of Plants specimens (by specimen count, excluding the
// "Unknown" aggregate), plus Sir Joseph Banks and Dr Daniel Solander (the
// collection's 1769 origin, far down the count list but historically the start).
//
// Each collector's date range is PERCENTILE-CLIPPED (2.5th–97.5th of their
// collection-event years, via sort+from), not raw min/max: historical collectors
// have a handful of misdated specimens that push the raw span 150+ years (e.g.
// Oliver 1828–1987, though he lived 1883–1957). Clipping yields the real active
// period (Oliver 1908–1955). The median year marks peak activity.
//
// Baked because it's ~60 ordered queries — too many to run live. Re-run with:
//   node build-collectors.js   (needs TEPAPA_API_KEY in .env)

const fs = require('fs');
const path = require('path');

try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* real env */ }

const { tepapaRequest } = require('./lib/tepapa');

const PLANTS = 'collection:"Plants"';
const SPECIMEN = [{ field: 'type', keyword: 'Specimen' }];
const BANKS = '5566', SOLANDER = '5567';
const EXCLUDE = /unknown|not stated|anon|^\s*$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(body, tries = 6) {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await tepapaRequest('POST', '/collection/search', body);
      if (r.status === 200 && r.json && !r.json.errorCode) return r.json;
    } catch { /* backoff */ }
    await sleep(Math.min(8000, 400 * 2 ** a));
  }
  return null;
}
const count = (j) => ((((j || {})._metadata) || {}).resultset || {}).count || 0;
const yearOf = (r) => {
  const d = r && r.evidenceFor && r.evidenceFor.atEvent && r.evidenceFor.atEvent.eventDate;
  return d ? parseInt(String(d).slice(0, 4), 10) : null;
};
function facetEntries(j, field) {
  const f = j && j.facets && j.facets[field];
  if (!f) return [];
  return Array.isArray(f) ? f.map((x) => [String(x.key || x.value), x.count != null ? x.count : x.doc_count]) : Object.entries(f).map(([k, v]) => [String(k), v]);
}

const plantsTotalBy = (id) => search({ query: `${PLANTS} AND evidenceFor.atEvent.recordedBy.id:${id}`, size: 0, filters: SPECIMEN }).then(count);

// Year at percentile `frac` of a collector's dated specimens (sort asc + from).
async function pctYear(id, frac, dated) {
  if (!dated) return null;
  const from = Math.min(dated - 1, Math.max(0, Math.floor(dated * frac)));
  const j = await search({
    query: `${PLANTS} AND evidenceFor.atEvent.recordedBy.id:${id} AND evidenceFor.atEvent.eventDate:[* TO *]`,
    size: 1, from, filters: SPECIMEN, sort: [{ field: 'evidenceFor.atEvent.eventDate', order: 'asc' }],
  });
  return j && j.results && j.results[0] ? yearOf(j.results[0]) : null;
}

async function rangeFor(id, name) {
  const total = await plantsTotalBy(id);
  const dated = await search({ query: `${PLANTS} AND evidenceFor.atEvent.recordedBy.id:${id} AND evidenceFor.atEvent.eventDate:[* TO *]`, size: 0, filters: SPECIMEN }).then(count);
  const [start, median, end] = await Promise.all([pctYear(id, 0.025, dated), pctYear(id, 0.5, dated), pctYear(id, 0.975, dated)]);
  return { id, name, count: total, dated, start, median, end };
}

(async () => {
  if (!process.env.TEPAPA_API_KEY) { console.error('No TEPAPA_API_KEY'); process.exit(1); }
  const t0 = Date.now();
  console.log('Finding top botany collectors…');

  // Top collectors by specimen count.
  const fj = await search({ query: PLANTS, size: 0, filters: SPECIMEN, facets: [{ field: 'evidenceFor.atEvent.recordedBy.id', size: 20 }] });
  const facet = facetEntries(fj, 'evidenceFor.atEvent.recordedBy.id');

  // Resolve names (Person only — orgs won't come back), then keep real people.
  const ids = [...new Set([...facet.map(([id]) => id), BANKS, SOLANDER])];
  const names = {};
  for (let i = 0; i < ids.length; i += 200) {
    const pj = await search({ query: 'id:(' + ids.slice(i, i + 200).join(' OR ') + ')', size: 200, filters: [{ field: 'type', keyword: 'Person' }] });
    (pj && (pj.results || pj.records) || []).forEach((r) => { names[String(r.id)] = r.title; });
  }

  // NB: the API returns facet buckets sorted by KEY (id), not by count — sort
  // by count ourselves before taking the top 10.
  const top = facet
    .filter(([id]) => names[id] && !EXCLUDE.test(names[id]))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);
  const chosen = [...new Set([...top, BANKS, SOLANDER])];
  console.log('Collectors:', chosen.map((id) => names[id] || id).join(' · '));

  const collectors = [];
  for (const id of chosen) {
    collectors.push(await rangeFor(id, names[id] || `agent ${id}`));
    process.stdout.write(`\r  ranged ${collectors.length}/${chosen.length}   `);
  }
  collectors.sort((a, b) => (a.start || 9999) - (b.start || 9999) || (a.median || 0) - (b.median || 0));

  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    note: 'Top 10 collectors of Plants specimens by specimen count (excluding the "Unknown" aggregate), plus Banks & Solander (1769). Each active range is the 2.5th–97.5th percentile of their collection-event years (clipping misdated outliers); median = peak year.',
    axisStart: 1760, axisEnd: 2030,
    collectors,
  };
  fs.writeFileSync(path.join(__dirname, 'public', 'collectors-botany.json'), JSON.stringify(out, null, 2));
  console.log(`\nWrote public/collectors-botany.json (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  collectors.forEach((c) => console.log(`  ${String(c.count).padStart(6)}  ${c.start}–${c.end} (peak ${c.median})  ${c.name}`));
})();
